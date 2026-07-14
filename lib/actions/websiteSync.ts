"use server";

import { db } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { logActivity, getDefaultWarehouseIdFor } from "@/lib/actions/helpers";
import { revalidatePath } from "next/cache";

// The karmalu website lives in its OWN Supabase project (not this app's DB),
// and its `public.orders` table has RLS locked down to the service role — so
// we read it over the Supabase REST API with a service-role key, not Prisma.
const KARMALU_SUPABASE_URL = process.env.KARMALU_SUPABASE_URL;
const KARMALU_SUPABASE_SERVICE_ROLE_KEY = process.env.KARMALU_SUPABASE_SERVICE_ROLE_KEY;

async function fetchKarmaluOrders(): Promise<WebsiteOrderRow[]> {
  if (!KARMALU_SUPABASE_URL || !KARMALU_SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("KARMALU_SUPABASE_URL / KARMALU_SUPABASE_SERVICE_ROLE_KEY are not configured.");
  }
  const res = await fetch(
    `${KARMALU_SUPABASE_URL}/rest/v1/orders?select=*&order=created_at.asc`,
    {
      headers: {
        apikey: KARMALU_SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${KARMALU_SUPABASE_SERVICE_ROLE_KEY}`,
      },
      cache: "no-store",
    }
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch karmalu orders: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

type WebsiteOrderItem = {
  name: string;
  quantity: number;
  price: number;
  size?: string;
  color?: string;
};

type WebsiteOrderRow = {
  order_id: string;
  brand: string;
  customer_name: string;
  whatsapp_number: string;
  email: string | null;
  address: { street?: string; city?: string; state?: string; zip?: string; country?: string } | null;
  notes: string | null;
  items: WebsiteOrderItem[];
  subtotal: number;
  delivery_charge: number;
  total: number;
  delivery_method: string | null;
  payment_method: string | null;
  status: string;
  created_at: string;
};

const BRAND_LABELS: Record<string, string> = {
  activewear: "Activewear",
  decor: "Living & Decor",
};

function formatAddress(row: WebsiteOrderRow) {
  const parts = [row.address?.street, row.address?.city, row.address?.state, row.address?.zip, row.address?.country].filter(Boolean);
  const brandLabel = BRAND_LABELS[row.brand] ?? row.brand;
  const addressStr = parts.length ? parts.join(", ") : null;
  return [`[${brandLabel}]`, addressStr].filter(Boolean).join(" ");
}

// Website orders only carry PAYMENT/DELIVERY info as a single free-form
// status; approximate the closest Sale enums rather than inventing new ones.
function mapDeliveryStatus(status: string): "IN_PROCESS" | "DELIVERED" | "RETURN_PROCESS" | "RETURNED" {
  if (status === "Delivered") return "DELIVERED";
  if (status === "Cancelled") return "RETURNED";
  return "IN_PROCESS";
}

async function getUnimportedOrders(storeId: string) {
  const [allOrders, importedSales] = await Promise.all([
    fetchKarmaluOrders(),
    db.sale.findMany({
      where: { storeId, externalOrderId: { not: null } },
      select: { externalOrderId: true },
    }),
  ]);
  const importedIds = new Set(importedSales.map(s => s.externalOrderId));
  return allOrders.filter(row => !importedIds.has(row.order_id));
}

export async function getWebsiteOrdersPreview() {
  const tenant = await requireTenant();
  const rows = await getUnimportedOrders(tenant.storeId);
  return rows.length;
}

export async function syncWebsiteOrders() {
  const tenant = await requireTenant();
  const storeId = tenant.storeId;
  const warehouseId = await getDefaultWarehouseIdFor(storeId);

  const rows = await getUnimportedOrders(storeId);

  let imported = 0;
  let unmatchedItems = 0;
  const errors: { orderId: string; message: string }[] = [];

  for (const row of rows) {
    try {
      await db.$transaction(async (tx) => {
        // Re-check inside the transaction in case two syncs race.
        const already = await tx.sale.findFirst({
          where: { storeId, externalOrderId: row.order_id },
          select: { id: true },
        });
        if (already) return;

        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        const count = await tx.sale.count({
          where: { storeId, invoiceNumber: { startsWith: `INV-${dateStr}` } },
        });
        const invoiceNumber = `INV-${dateStr}-${String(count + 1).padStart(3, "0")}`;

        const itemsData: { productId: string; quantity: number; unitPrice: number }[] = [];
        for (const item of row.items) {
          const product = await tx.product.findFirst({
            where: { storeId, name: { equals: item.name, mode: "insensitive" } },
            select: { id: true },
          });

          let productId = product?.id;
          if (!productId) {
            unmatchedItems += 1;
            productId = await getOrCreatePlaceholderProduct(tx, storeId, item);
          }

          itemsData.push({ productId, quantity: item.quantity, unitPrice: item.price });
        }

        await tx.sale.create({
          data: {
            storeId,
            invoiceNumber,
            customerName: row.customer_name,
            customerPhone: row.whatsapp_number,
            customerEmail: row.email ?? undefined,
            customerAddress: formatAddress(row) || undefined,
            warehouseId,
            deliveryAmount: Number(row.delivery_charge) || 0,
            totalAmount: Number(row.total) || 0,
            paymentStatus: row.status === "Cancelled" ? "UNPAID" : "PAID",
            deliveryStatus: mapDeliveryStatus(row.status),
            source: "website",
            externalOrderId: row.order_id,
            createdAt: new Date(row.created_at),
            items: { create: itemsData },
          },
        });
      });
      imported += 1;
    } catch (err) {
      errors.push({ orderId: row.order_id, message: err instanceof Error ? err.message : String(err) });
    }
  }

  if (imported > 0) {
    await logActivity(tenant, "Website Orders Synced", `Imported ${imported} website order(s)${unmatchedItems ? `, ${unmatchedItems} item(s) unmatched to a product` : ""}.`);
  }

  revalidatePath("/sales");
  revalidatePath("/customers");
  revalidatePath("/inventory");
  revalidatePath("/dashboard");

  return { imported, unmatchedItems, errors, total: rows.length };
}

// Unmatched website line items still need a real Product row (SaleItem.productId
// is required), so we park them under one placeholder product per store rather
// than failing the whole order.
async function getOrCreatePlaceholderProduct(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  storeId: string,
  item: WebsiteOrderItem
) {
  // One placeholder Product per distinct unmatched name (+ size/color), keyed
  // by a stable SKU derived from it, so repeat unmatched items reuse the same
  // row instead of colliding on the unique (storeId, sku) constraint.
  const variantLabel = [item.name, item.size, item.color].filter(Boolean).join(" / ");
  const sku = `WEBSITE-UNMATCHED-${variantLabel}`
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .slice(0, 190);

  const existing = await tx.product.findFirst({ where: { storeId, sku }, select: { id: true } });
  if (existing) return existing.id;

  const category = await tx.category.findFirst({ where: { storeId }, select: { id: true } })
    ?? await tx.category.create({ data: { storeId, name: "Uncategorized" }, select: { id: true } });
  const supplier = await tx.supplier.findFirst({ where: { storeId }, select: { id: true } })
    ?? await tx.supplier.create({
      data: { storeId, companyName: "Website", contactPerson: "N/A", phone: "N/A", email: "N/A", address: "N/A" },
      select: { id: true },
    });

  const created = await tx.product.create({
    data: {
      storeId,
      name: `Unmatched Website Item (${variantLabel})`,
      sku,
      categoryId: category.id,
      supplierId: supplier.id,
      costPrice: 0,
      sellingPrice: item.price,
      status: "inactive",
      description: "Auto-created placeholder for website order items that couldn't be matched to an existing product by name.",
    },
    select: { id: true },
  });
  return created.id;
}
