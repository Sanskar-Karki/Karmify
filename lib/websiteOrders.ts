import "server-only";

import { MovementType, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { documentStem, lockDocumentNumbering, nextDocumentNumber } from "@/lib/actions/helpers";
import { customerIdentityKey, findOrCreateCustomerId } from "@/lib/customerIdentity";
import { findVariant, syncStockTotal } from "@/lib/variants";
import { optionsText } from "@/lib/orders";

// Turns a Karmalu website order into a Karmify Sale. Used by the Sync Website
// button and by the endpoint the website calls when an order is placed.

export type WebsiteOrderItem = {
  name: string;
  quantity: number;
  price: number;
  size?: string;
  color?: string;
  /** The product's URL name on the website, e.g. "dual-tone-hoodie". */
  productSlug?: string;
};

/** Letters and digits only, lower-cased: "Quarter Zip-Up  Sweatshirt" and "quarter zipup sweatshirt" match. */
const matchKey = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** "L · Navy": the size and colour picked on the website, stored on the sale item. */
export function variantOf(item: Pick<WebsiteOrderItem, "size" | "color">) {
  const parts = [item.size, item.color].map(part => part?.trim()).filter(Boolean);
  return parts.length ? parts.join(" · ").slice(0, 100) : null;
}

/** "2 × Dual Tone Hoodie (Colour: Navy, Size: L)", for notifications and the activity log. */
export function describeItems(items: WebsiteOrderItem[]) {
  return items
    .map(item => {
      const options = optionsText(item.size, item.color, ", ");
      return `${item.quantity} × ${item.name}${options ? ` (${options})` : ""}`;
    })
    .join("; ");
}

type WebsiteAddress = {
  street?: string;
  ward?: string;
  municipality?: string;
  district?: string;
  province?: string;
  // Older website orders used these instead.
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  // The Upaya delivery area the customer chose at checkout.
  upayaAreaId?: number;
  upayaLocationId?: number;
  upayaAreaTitle?: string;
  upayaHub?: string;
};

export type WebsiteOrderRow = {
  order_id: string;
  brand: string;
  customer_name: string;
  whatsapp_number: string;
  email: string | null;
  address: WebsiteAddress | null;
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

/** Whether a request body has what an import needs. */
export function isWebsiteOrder(value: unknown): value is WebsiteOrderRow {
  const order = value as Partial<WebsiteOrderRow> | null;
  return Boolean(
    order &&
      typeof order.order_id === "string" && order.order_id.length > 0 && order.order_id.length <= 100 &&
      typeof order.customer_name === "string" &&
      typeof order.whatsapp_number === "string" &&
      typeof order.status === "string" &&
      typeof order.created_at === "string" && !Number.isNaN(Date.parse(order.created_at)) &&
      Number.isFinite(order.total) &&
      Array.isArray(order.items) && order.items.length > 0 && order.items.length <= 100 &&
      order.items.every(item =>
        typeof item?.name === "string" && Number.isInteger(item.quantity) && item.quantity > 0 &&
        Number.isFinite(item.price) && item.price >= 0
      )
  );
}

const BRAND_LABELS: Record<string, string> = {
  originals: "Originals",
  activewear: "Activewear",
  decor: "Living & Decor",
};

function formatAddress(row: WebsiteOrderRow) {
  const address = row.address;
  const parts = [
    address?.street,
    address?.ward ? `Ward ${address.ward}` : null,
    address?.municipality,
    address?.district,
    address?.province,
    address?.city,
    address?.state,
    address?.zip,
    address?.country === "Nepal" ? null : address?.country,
  ].filter(Boolean);
  const brandLabel = BRAND_LABELS[row.brand] ?? row.brand;
  const addressStr = parts.length ? parts.join(", ") : null;
  return [`[${brandLabel}]`, addressStr].filter(Boolean).join(" ");
}

function courierArea(address: WebsiteAddress | null) {
  const areaId = Number(address?.upayaAreaId);
  const locationId = Number(address?.upayaLocationId);
  if (!Number.isInteger(areaId) || areaId <= 0 || !Number.isInteger(locationId) || locationId <= 0) return {};
  const title = [address?.upayaAreaTitle, address?.upayaHub].filter(Boolean).join(" · ");
  return { courierAreaId: areaId, courierLocationId: locationId, courierAreaTitle: title || null };
}

// Website orders only carry PAYMENT/DELIVERY info as a single free-form
// status; approximate the closest Sale enums rather than inventing new ones.
function mapDeliveryStatus(status: string): "IN_PROCESS" | "DELIVERED" | "RETURN_PROCESS" | "RETURNED" | "CANCELLED" {
  if (status === "Delivered") return "DELIVERED";
  if (status === "Cancelled") return "CANCELLED";
  return "IN_PROCESS";
}

// Unmatched website line items still need a real Product row (SaleItem.productId
// is required), so we park them under one placeholder product per store rather
// than failing the whole order.
async function getOrCreatePlaceholderProduct(tx: Prisma.TransactionClient, storeId: string, item: WebsiteOrderItem) {
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

/**
 * Logged when a website order is deleted in Karmify. Its details start with the
 * website's order number, and that order is never imported again: the website
 * keeps its own copy, which Sync Website would otherwise bring back.
 */
export const WEBSITE_ORDER_DELETED = "Website Order Deleted";

export const deletedOrderDetails = (orderId: string, invoiceNumber: string) =>
  `${orderId} (${invoiceNumber}) was deleted in Karmify, so it won't be imported again.`;

/** Website order numbers deleted in Karmify. */
export async function deletedWebsiteOrderIds(storeId: string) {
  const logs = await db.activityLog.findMany({ where: { storeId, action: WEBSITE_ORDER_DELETED }, select: { details: true } });
  return new Set(logs.map((log) => log.details.split(" ")[0]));
}

/** Saves one website order, returning null if it was already imported or was deleted in Karmify. */
export function importWebsiteOrder(storeId: string, warehouseId: string, row: WebsiteOrderRow) {
  return db.$transaction(async (tx) => {
    await lockDocumentNumbering(tx, storeId);

    // Re-check inside the lock: the website and a manual sync can overlap.
    const already = await tx.sale.findFirst({
      where: { storeId, externalOrderId: row.order_id },
      select: { id: true },
    });
    if (already) return null;

    // Deleted in Karmify on purpose (a cancelled or test order): leave it deleted.
    const deleted = await tx.activityLog.findFirst({
      where: { storeId, action: WEBSITE_ORDER_DELETED, details: { startsWith: `${row.order_id} ` } },
      select: { id: true },
    });
    if (deleted) return null;

    const stem = documentStem("INV");
    const todays = await tx.sale.findMany({
      where: { storeId, invoiceNumber: { startsWith: stem } },
      select: { invoiceNumber: true },
    });
    const invoiceNumber = nextDocumentNumber(stem, todays.map(s => s.invoiceNumber));

    // Match each line to a real product: first a SKU equal to the website's URL
    // name (e.g. "dual-tone-hoodie"), then the product name, ignoring case,
    // spaces and punctuation. Active products win over inactive ones.
    const products = await tx.product.findMany({
      where: { storeId, NOT: { sku: { startsWith: "WEBSITE-UNMATCHED-" } } },
      select: { id: true, name: true, sku: true, status: true },
      orderBy: { status: "desc" }, // "inactive" first, so "active" overwrites below
    });
    const bySku = new Map(products.map(p => [matchKey(p.sku), p.id]));
    const byName = new Map(products.map(p => [matchKey(p.name), p.id]));

    let unmatchedItems = 0;
    const unmatchedNames: string[] = [];
    const itemsData: {
      productId: string; quantity: number; unitPrice: number; variant: string | null; matched: boolean;
      /** The size/colour stock row this line takes from, when the product has one. */
      variantId: string | null;
      /** The product has sizes, but none named like this line's size/colour. */
      sizeMissing: boolean;
    }[] = [];
    const missingSizes: string[] = [];
    for (const item of row.items) {
      const matchedId =
        (item.productSlug ? bySku.get(matchKey(item.productSlug)) : undefined) ?? byName.get(matchKey(item.name));

      let productId = matchedId;
      if (!productId) {
        unmatchedItems += 1;
        unmatchedNames.push(item.name);
        productId = await getOrCreatePlaceholderProduct(tx, storeId, item);
      }

      const sized = matchedId ? await findVariant(tx, matchedId, item.size, item.color) : null;
      const sizeMissing = Boolean(matchedId && !sized && (await tx.productVariant.count({ where: { productId: matchedId } })) > 0);
      const options = optionsText(item.size, item.color, ", ");
      if (sizeMissing) missingSizes.push(`${item.name}${options ? ` (${options})` : ""}`);
      itemsData.push({
        productId, quantity: item.quantity, unitPrice: item.price, variant: variantOf(item), matched: Boolean(matchedId),
        variantId: sized?.id ?? null, sizeMissing,
      });
    }

    const customerId = await findOrCreateCustomerId(
      tx, storeId, customerIdentityKey({ name: row.customer_name, phone: row.whatsapp_number, email: row.email })
    );

    const sale = await tx.sale.create({
      data: {
        storeId,
        invoiceNumber,
        customerId,
        customerName: row.customer_name,
        customerPhone: row.whatsapp_number,
        customerEmail: row.email ?? undefined,
        customerAddress: formatAddress(row) || undefined,
        ...courierArea(row.address),
        warehouseId,
        deliveryAmount: Number(row.delivery_charge) || 0,
        totalAmount: Number(row.total) || 0,
        // Website orders are COD/arranged over WhatsApp — nothing is paid
        // until the order is actually delivered.
        paymentStatus: row.status === "Delivered" ? "PAID" : "UNPAID",
        deliveryStatus: mapDeliveryStatus(row.status),
        source: "website",
        brand: row.brand === "decor" ? "decor" : row.brand === "originals" || row.brand === "activewear" ? "originals" : null,
        externalOrderId: row.order_id,
        notes: row.notes?.trim().slice(0, 1000) || null,
        createdAt: new Date(row.created_at),
        items: { create: itemsData.map(({ productId, quantity, unitPrice, variant, variantId }) => ({ productId, quantity, unitPrice, variant, variantId })) },
      },
    });

    // Keep inventory honest: deduct stock for matched products, mirroring
    // POS sales. Lenient on purpose — a missing/short stock row must not
    // block the import, since the sale already happened on the website.
    for (const item of itemsData) {
      if (!item.matched) continue;

      // A size Karmify doesn't have: taking from the total alone would make it
      // disagree with the sizes, so nothing is taken and staff are told instead.
      if (item.sizeMissing) continue;

      let deduct: number;
      if (item.variantId) {
        // Sized product: take from that size/colour, then the total follows.
        // Read again: an earlier line of this same order may have taken from it.
        const current = await tx.productVariant.findUnique({ where: { id: item.variantId }, select: { quantity: true } });
        deduct = Math.min(current?.quantity ?? 0, item.quantity);
        if (deduct <= 0) continue;
        await tx.productVariant.update({ where: { id: item.variantId }, data: { quantity: { decrement: deduct } } });
        await syncStockTotal(tx, storeId, item.productId, warehouseId);
      } else {
        const stock = await tx.stock.findUnique({
          where: { productId_warehouseId: { productId: item.productId, warehouseId } },
        });
        if (!stock || stock.quantity <= 0) continue;
        deduct = Math.min(stock.quantity, item.quantity);
        await tx.stock.update({
          where: { id: stock.id },
          data: { quantity: { decrement: deduct } },
        });
      }
      await tx.stockMovement.create({
        data: {
          storeId,
          productId: item.productId,
          quantity: deduct,
          type: MovementType.STOCK_OUT,
          sourceWhId: warehouseId,
          referenceId: sale.id,
          notes: `Website order ${row.order_id} (invoice ${invoiceNumber})`,
        },
      });
    }

    return { invoiceNumber, unmatchedItems, unmatchedNames: [...new Set(unmatchedNames)], missingSizes: [...new Set(missingSizes)] };
  }, { timeout: 20_000, maxWait: 10_000 });
}
