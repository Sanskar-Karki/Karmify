"use server";

import { db } from "@/lib/db";
import { MovementType } from "@prisma/client";
import { requireTenant } from "@/lib/tenant";
import { getDefaultWarehouseIdFor, logActivity, notify } from "@/lib/actions/helpers";
import { guarded, UserError } from "@/lib/actions/result";
import { isIgnored } from "@/lib/lowStock";
import { syncStockTotal } from "@/lib/variants";
import { revalidatePath } from "next/cache";

export async function adjustStock(data: {
  productId: string;
  quantity: number; // The new quantity target
  notes?: string;
}) {
  return guarded("Could not adjust this stock level.", async () => {
    if (!Number.isInteger(data.quantity) || data.quantity < 0) {
      throw new UserError("Stock must be a whole number of 0 or more.");
    }

    const tenant = await requireTenant();
    const storeId = tenant.storeId;
    const warehouseId = await getDefaultWarehouseIdFor(storeId);

    const product = await db.product.findFirst({
      where: { id: data.productId, storeId },
      select: { name: true, minStockLevel: true, lowStockIgnoredQty: true, _count: { select: { variants: true } } },
    });
    if (!product) throw new UserError("That product no longer exists. Refresh and try again.");
    if (product._count.variants > 0) throw new UserError("This product has sizes. Open it in Products and use Edit stock (or Restock) on its size table.");

    const change = await db.$transaction(async (tx) => {
      const current = await tx.stock.findUnique({
        where: { productId_warehouseId: { productId: data.productId, warehouseId } },
        select: { quantity: true },
      });
      const oldQty = current?.quantity ?? 0;
      const difference = data.quantity - oldQty;
      if (difference === 0) return 0;

      await tx.stock.upsert({
        where: { productId_warehouseId: { productId: data.productId, warehouseId } },
        update: { quantity: data.quantity },
        create: { storeId, productId: data.productId, warehouseId, quantity: data.quantity },
      });
      await tx.stockMovement.create({
        data: {
          storeId,
          productId: data.productId,
          quantity: Math.abs(difference),
          type: MovementType.ADJUSTMENT,
          sourceWhId: difference < 0 ? warehouseId : null,
          destWhId: difference > 0 ? warehouseId : null,
          notes: data.notes || `Stock adjustment from ${oldQty} to ${data.quantity}`,
          userId: tenant.userId,
        },
      });
      return difference;
    });

    if (change === 0) return { change };

    await logActivity(tenant, "Stock Adjusted", `Adjusted stock of "${product.name}" to ${data.quantity} (change of ${change > 0 ? "+" : ""}${change}).`);

    if (data.quantity < product.minStockLevel && !isIgnored(data.quantity, product.lowStockIgnoredQty)) {
      await notify(storeId, "Low Stock Alert", `Stock of "${product.name}" is low (${data.quantity} units left).`, "warning");
    }

    revalidatePath("/inventory");
    revalidatePath("/dashboard");
    return { change };
  });
}

// Record a stock movement of any type (Stock In/Out, Damaged, Returned, Adjustment)
export async function recordStockMovement(data: {
  productId: string;
  type: "STOCK_IN" | "STOCK_OUT" | "DAMAGED" | "RETURNED" | "ADJUSTMENT";
  quantity: number;
  notes?: string;
}) {
  return guarded("Could not record this stock movement.", async () => {
    if (!Number.isInteger(data.quantity) || data.quantity <= 0) {
      throw new UserError("Quantity must be a whole number greater than 0.");
    }

    const tenant = await requireTenant();
    const storeId = tenant.storeId;

    const product = await db.product.findFirst({
      where: { id: data.productId, storeId },
      select: { name: true, minStockLevel: true, lowStockIgnoredQty: true, _count: { select: { variants: true } } },
    });
    if (!product) throw new UserError("That product no longer exists. Refresh and try again.");
    if (product._count.variants > 0) throw new UserError("This product has sizes. Open it in Products and use Edit stock (or Restock) on its size table.");

    const warehouseId = await getDefaultWarehouseIdFor(storeId);
    const outgoing = data.type === MovementType.STOCK_OUT || data.type === MovementType.DAMAGED;

    await db.$transaction(async (tx) => {
      if (outgoing) {
        // Checking availability in the same statement keeps stock from going
        // negative when two people record a removal at the same time.
        const deducted = await tx.stock.updateMany({
          where: { storeId, productId: data.productId, warehouseId, quantity: { gte: data.quantity } },
          data: { quantity: { decrement: data.quantity } },
        });
        if (deducted.count === 0) throw new UserError(`Not enough stock of "${product.name}" for this movement.`);
      } else {
        await tx.stock.upsert({
          where: { productId_warehouseId: { productId: data.productId, warehouseId } },
          update: { quantity: { increment: data.quantity } },
          create: { storeId, productId: data.productId, warehouseId, quantity: data.quantity },
        });
      }

      const { quantity } = await tx.stock.findUniqueOrThrow({
        where: { productId_warehouseId: { productId: data.productId, warehouseId } },
        select: { quantity: true },
      });
      if (quantity < product.minStockLevel && !isIgnored(quantity, product.lowStockIgnoredQty)) {
        await tx.notification.create({
          data: {
            storeId,
            title: "Low Stock Alert",
            message: `Stock of "${product.name}" is low (${quantity} units left).`,
            type: "warning",
          },
        });
      }

      await tx.stockMovement.create({
        data: {
          storeId,
          productId: data.productId,
          quantity: data.quantity,
          type: data.type,
          sourceWhId: outgoing ? warehouseId : null,
          destWhId: outgoing ? null : warehouseId,
          notes: data.notes || null,
          userId: tenant.userId,
        },
      });
    });

    await logActivity(tenant, "Stock Movement Recorded", `${data.type.replace("_", " ")} — ${data.quantity}x "${product.name}" logged.`);

    revalidatePath("/inventory");
    revalidatePath("/dashboard");
  });
}

/**
 * Hides a low-stock alert until the item is restocked. Stores the quantity it
 * has now; the alert comes back once stock rises above that and drops below the
 * minimum again. `ignore: false` brings it back straight away.
 */
export async function setLowStockIgnored(data: { productId: string; variantId?: string | null; ignore: boolean }) {
  return guarded("Could not update this low-stock alert.", async () => {
    const tenant = await requireTenant();
    const storeId = tenant.storeId;

    const product = await db.product.findFirst({
      where: { id: data.productId, storeId },
      select: { name: true, stocks: { select: { quantity: true } } },
    });
    if (!product) throw new UserError("That product no longer exists. Refresh and try again.");

    let label = product.name;
    if (data.variantId) {
      const variant = await db.productVariant.findFirst({
        where: { id: data.variantId, productId: data.productId, storeId },
        select: { quantity: true, size: true, color: true },
      });
      if (!variant) throw new UserError("That size or colour no longer exists. Refresh and try again.");
      await db.productVariant.update({
        where: { id: data.variantId },
        data: { lowStockIgnoredQty: data.ignore ? variant.quantity : null },
      });
      const part = [variant.size, variant.color].filter(Boolean).join(" · ");
      if (part) label = `${product.name} (${part})`;
    } else {
      const total = product.stocks.reduce((sum, s) => sum + s.quantity, 0);
      await db.product.update({
        where: { id: data.productId },
        data: { lowStockIgnoredQty: data.ignore ? total : null },
      });
    }

    await logActivity(
      tenant,
      data.ignore ? "Low Stock Ignored" : "Low Stock Alert Restored",
      data.ignore ? `Ignored the low-stock alert for "${label}" until it is restocked.` : `Turned the low-stock alert for "${label}" back on.`
    );

    revalidatePath("/inventory");
    revalidatePath("/dashboard");
    return { label };
  });
}

/**
 * Adds new stock to a product. Sized products take a quantity per size/colour
 * (`rows`); others a single `quantity`. Recorded as one Stock In movement that
 * says which sizes got how many.
 */
export async function restockProduct(data: {
  productId: string;
  quantity?: number;
  rows?: { variantId: string; quantity: number }[];
  notes?: string;
  /** "return": units brought back without an order; recorded as Returned, not Stock In. */
  kind?: "restock" | "return";
  /** A return only: who brought it back, as "Name (CUS-000042)" or a typed name. Kept in the history note. */
  customer?: string;
}) {
  const isReturn = data.kind === "return";
  return guarded(isReturn ? "Could not record this return." : "Could not restock this product.", async () => {
    const tenant = await requireTenant();
    const storeId = tenant.storeId;
    const notes = data.notes?.trim().slice(0, 300) || "";
    const customer = isReturn ? (data.customer ?? "").replace(/\s+/g, " ").trim().slice(0, 120) : "";

    const product = await db.product.findFirst({
      where: { id: data.productId, storeId },
      select: { name: true, variants: { select: { id: true, size: true, color: true } } },
    });
    if (!product) throw new UserError("That product no longer exists. Refresh and try again.");
    const warehouseId = await getDefaultWarehouseIdFor(storeId);

    let added = 0;
    let detail = "";
    await db.$transaction(async (tx) => {
      if (product.variants.length > 0) {
        const rows = (data.rows ?? []).filter(r => r.quantity !== 0);
        if (rows.some(r => !Number.isInteger(r.quantity) || r.quantity < 0)) throw new UserError("Quantities must be whole numbers of 0 or more.");
        if (rows.length === 0) throw new UserError(`Enter how many ${isReturn ? "came back" : "came in"} for at least one size or colour.`);
        const parts: string[] = [];
        for (const row of rows) {
          const variant = product.variants.find(v => v.id === row.variantId);
          if (!variant) throw new UserError("One of the sizes no longer exists. Refresh and try again.");
          await tx.productVariant.update({ where: { id: variant.id }, data: { quantity: { increment: row.quantity } } });
          parts.push(`${[variant.size, variant.color].filter(Boolean).join(" · ")} +${row.quantity}`);
          added += row.quantity;
        }
        await syncStockTotal(tx, storeId, data.productId, warehouseId);
        detail = parts.join(", ");
      } else {
        const quantity = data.quantity ?? 0;
        if (!Number.isInteger(quantity) || quantity <= 0) throw new UserError(`Enter how many ${isReturn ? "came back" : "came in"}: a whole number above 0.`);
        await tx.stock.upsert({
          where: { productId_warehouseId: { productId: data.productId, warehouseId } },
          update: { quantity: { increment: quantity } },
          create: { storeId, productId: data.productId, warehouseId, quantity },
        });
        added = quantity;
      }

      await tx.stockMovement.create({
        data: {
          storeId,
          productId: data.productId,
          quantity: added,
          type: isReturn ? MovementType.RETURNED : MovementType.STOCK_IN,
          destWhId: warehouseId,
          notes: [isReturn ? "Return (no order)" : "Restock", detail, customer && `Customer: ${customer}`, notes].filter(Boolean).join(" · ").slice(0, 500),
          userId: tenant.userId,
        },
      });
    }, { timeout: 15_000, maxWait: 10_000 });

    await logActivity(
      tenant,
      isReturn ? "Product Returned" : "Product Restocked",
      isReturn
        ? `${added} unit(s) of "${product.name}" returned without an order${customer ? ` by ${customer}` : ""}${detail ? ` (${detail})` : ""}${notes ? `: ${notes}` : ""}.`
        : `Restocked "${product.name}" with ${added} unit(s)${detail ? ` (${detail})` : ""}.`
    );
    revalidatePath("/products");
    revalidatePath("/inventory");
    revalidatePath("/dashboard");
    return { added };
  });
}

/** Everything that happened to one product's stock, and the orders it was in, newest first. */
export async function getProductHistory(productId: string) {
  return guarded("Could not load this product's history.", async () => {
    const tenant = await requireTenant();
    const storeId = tenant.storeId;
    const exists = await db.product.findFirst({ where: { id: productId, storeId }, select: { id: true } });
    if (!exists) throw new UserError("That product no longer exists.");

    const [movements, lines] = await Promise.all([
      db.stockMovement.findMany({
        where: { storeId, productId },
        orderBy: { createdAt: "desc" },
        take: 300,
        select: { id: true, type: true, quantity: true, notes: true, referenceId: true, createdAt: true },
      }),
      db.saleItem.findMany({
        where: { productId, sale: { storeId } },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: {
          id: true, quantity: true, returnedQty: true, unitPrice: true, variant: true,
          sale: {
            select: {
              id: true, invoiceNumber: true, customerName: true, customerPhone: true, customerEmail: true, createdAt: true,
              deliveryStatus: true, kind: true, source: true, customer: { select: { code: true } },
            },
          },
        },
      }),
    ]);
    return { movements, lines };
  });
}

/**
 * Sets a sized product's stock per size/colour to the numbers typed in (a stock
 * count), from the size × colour table on the product's page. Recorded as one
 * adjustment that lists each change, e.g. "M · Navy 3 → 5, L 2 → 1".
 */
export async function setVariantStock(data: { productId: string; rows: { variantId: string; quantity: number }[] }) {
  return guarded("Could not save the new stock.", async () => {
    if (data.rows.some(r => !Number.isInteger(r.quantity) || r.quantity < 0)) {
      throw new UserError("Stock must be a whole number of 0 or more.");
    }
    const tenant = await requireTenant();
    const storeId = tenant.storeId;
    const product = await db.product.findFirst({
      where: { id: data.productId, storeId },
      select: { name: true, variants: { select: { id: true, size: true, color: true, quantity: true } } },
    });
    if (!product) throw new UserError("That product no longer exists. Refresh and try again.");
    const warehouseId = await getDefaultWarehouseIdFor(storeId);

    const changes: string[] = [];
    let net = 0;
    await db.$transaction(async (tx) => {
      for (const row of data.rows) {
        const variant = product.variants.find(v => v.id === row.variantId);
        if (!variant) throw new UserError("One of the sizes no longer exists. Refresh and try again.");
        if (variant.quantity === row.quantity) continue;
        // Only if nobody changed it meanwhile (a sale, say), so a count can't wipe out a sale.
        const set = await tx.productVariant.updateMany({
          where: { id: variant.id, quantity: variant.quantity },
          data: { quantity: row.quantity },
        });
        if (set.count === 0) throw new UserError("Stock changed while you were editing (maybe a sale). Refresh and enter it again.");
        changes.push(`${[variant.size, variant.color].filter(Boolean).join(" · ")} ${variant.quantity} → ${row.quantity}`);
        net += row.quantity - variant.quantity;
      }
      if (changes.length === 0) return;
      await syncStockTotal(tx, storeId, data.productId, warehouseId);
      await tx.stockMovement.create({
        data: {
          storeId,
          productId: data.productId,
          quantity: Math.abs(net),
          type: MovementType.ADJUSTMENT,
          sourceWhId: net < 0 ? warehouseId : null,
          destWhId: net > 0 ? warehouseId : null,
          notes: `Stock edited: ${changes.join(", ")}`.slice(0, 500),
          userId: tenant.userId,
        },
      });
    }, { timeout: 15_000, maxWait: 10_000 });

    if (changes.length > 0) {
      await logActivity(tenant, "Stock Adjusted", `Edited stock of "${product.name}": ${changes.join(", ")}.`.slice(0, 1000));
      revalidatePath("/products");
      revalidatePath("/inventory");
      revalidatePath("/dashboard");
    }
    return { changed: changes.length, net };
  });
}
