"use server";

import { db } from "@/lib/db";
import { MovementType } from "@prisma/client";
import { requireTenant } from "@/lib/tenant";
import { getDefaultWarehouseIdFor, logActivity } from "@/lib/actions/helpers";
import { guarded, UserError } from "@/lib/actions/result";
import { syncStockTotal } from "@/lib/variants";
import { WEBSITE_ORDER_DELETED } from "@/lib/websiteOrders";
import { revalidatePath } from "next/cache";

// "Recently deleted": every deleted order is kept for 30 days (see deleteSales),
// so a mistake can be undone. Restoring puts the order back as it was, under its
// own id, and can take its items out of stock again if deleting put them back.

const KEEP_DAYS = 30;

type SnapshotItem = {
  id: string; productId: string; name: string; quantity: number; returnedQty: number;
  unitPrice: number; variant: string | null; variantId: string | null; createdAt: string;
};
type Snapshot = {
  sale: Record<string, unknown> & { id: string; invoiceNumber: string; externalOrderId: string | null; customerId: string | null; warehouseId: string };
  items: SnapshotItem[];
  putBack: { product: { productId: string; quantity: number }[]; variants: { productId: string; variantId: string; quantity: number }[] };
};

const DATE_FIELDS = ["createdAt", "updatedAt", "courierCheckedAt"] as const;

/** Deleted orders from the last 30 days, newest first (older copies are cleared out). */
export async function listDeletedSales() {
  return guarded("Could not load recently deleted orders.", async () => {
    const tenant = await requireTenant();
    await db.deletedSale.deleteMany({
      where: { storeId: tenant.storeId, deletedAt: { lt: new Date(Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000) } },
    });
    const rows = await db.deletedSale.findMany({ where: { storeId: tenant.storeId }, orderBy: { deletedAt: "desc" }, take: 300 });
    return rows.map(row => {
      const data = row.data as unknown as Snapshot;
      return {
        id: row.id,
        invoiceNumber: row.invoiceNumber,
        customerName: row.customerName,
        customerPhone: (data.sale.customerPhone as string | null) ?? null,
        totalAmount: row.totalAmount,
        itemCount: row.itemCount,
        restocked: row.restocked,
        deletedAt: row.deletedAt,
        orderedAt: (data.sale.createdAt as string) ?? null,
        website: data.sale.source === "website",
        items: data.items.map(i => ({ name: i.name, quantity: i.quantity, variant: i.variant })),
      };
    });
  });
}

/**
 * Puts a deleted order back. With `takeStock`, items that deleting put back in
 * stock are taken out again (refused if there isn't enough left).
 */
export async function restoreDeletedSale(id: string, options: { takeStock?: boolean } = {}) {
  return guarded("Could not restore this order.", async () => {
    const tenant = await requireTenant();
    const storeId = tenant.storeId;

    const result = await db.$transaction(async (tx) => {
      const row = await tx.deletedSale.findFirst({ where: { id, storeId } });
      if (!row) throw new UserError("That order is no longer in Recently deleted. Refresh and try again.");
      const data = row.data as unknown as Snapshot;
      const original = data.sale;

      if (await tx.sale.findUnique({ where: { id: original.id }, select: { id: true } })) {
        await tx.deletedSale.delete({ where: { id: row.id } });
        throw new UserError(`${original.invoiceNumber} is already back in your orders.`);
      }
      if (original.externalOrderId) {
        const twin = await tx.sale.findFirst({ where: { storeId, externalOrderId: original.externalOrderId }, select: { invoiceNumber: true } });
        if (twin) throw new UserError(`Website order ${original.externalOrderId} is already in your orders as ${twin.invoiceNumber}.`);
      }

      // Everything the order points at must still exist.
      const productIds = [...new Set(data.items.map(i => i.productId))];
      const products = await tx.product.findMany({ where: { id: { in: productIds }, storeId }, select: { id: true } });
      const missing = data.items.find(i => !products.some(p => p.id === i.productId));
      if (missing) throw new UserError(`"${missing.name}" has been deleted since, so this order can't be restored.`);
      const variantIds = data.items.map(i => i.variantId).filter((v): v is string => Boolean(v));
      const liveVariants = new Set((await tx.productVariant.findMany({ where: { id: { in: variantIds } }, select: { id: true } })).map(v => v.id));
      const customerId = original.customerId && (await tx.customer.findFirst({ where: { id: original.customerId, storeId }, select: { id: true } })) ? original.customerId : null;
      const warehouseId = (await tx.warehouse.findFirst({ where: { id: original.warehouseId, storeId }, select: { id: true } }))?.id ?? await getDefaultWarehouseIdFor(storeId);

      // Its invoice number may have been given to a newer order since.
      let invoiceNumber = original.invoiceNumber;
      for (let n = 1; await tx.sale.findFirst({ where: { storeId, invoiceNumber }, select: { id: true } }); n++) {
        invoiceNumber = `${original.invoiceNumber}-R${n > 1 ? n : ""}`;
      }

      const sale: Record<string, unknown> = { ...original };
      for (const key of DATE_FIELDS) if (typeof sale[key] === "string") sale[key] = new Date(sale[key] as string);
      delete sale.courierSubmittingAt; // a booking claim from before the delete means nothing now

      await tx.sale.create({
        data: {
          ...(sale as object),
          id: original.id,
          storeId,
          customerId,
          warehouseId,
          invoiceNumber,
          items: {
            create: data.items.map(i => ({
              id: i.id,
              productId: i.productId,
              quantity: i.quantity,
              returnedQty: i.returnedQty,
              unitPrice: i.unitPrice,
              variant: i.variant,
              variantId: i.variantId && liveVariants.has(i.variantId) ? i.variantId : null,
              createdAt: new Date(i.createdAt),
            })),
          },
        } as never,
      });

      // Take back out of stock what deleting put back in.
      let unitsTaken = 0;
      if (options.takeStock && row.restocked) {
        const sized = new Set<string>();
        for (const v of data.putBack.variants) {
          if (!liveVariants.has(v.variantId)) continue;
          const taken = await tx.productVariant.updateMany({ where: { id: v.variantId, storeId, quantity: { gte: v.quantity } }, data: { quantity: { decrement: v.quantity } } });
          if (taken.count === 0) {
            const item = data.items.find(i => i.variantId === v.variantId);
            throw new UserError(`Not enough "${item?.name ?? "stock"}"${item?.variant ? ` (${item.variant})` : ""} left to take ${v.quantity} out again. Restore it without taking stock, or restock first.`);
          }
          sized.add(v.productId);
        }
        for (const productId of sized) await syncStockTotal(tx, storeId, productId, warehouseId);
        for (const p of data.putBack.product) {
          if (!sized.has(p.productId)) {
            const taken = await tx.stock.updateMany({ where: { storeId, productId: p.productId, warehouseId, quantity: { gte: p.quantity } }, data: { quantity: { decrement: p.quantity } } });
            if (taken.count === 0) {
              const name = data.items.find(i => i.productId === p.productId)?.name ?? "a product";
              throw new UserError(`Not enough "${name}" left to take ${p.quantity} out again. Restore it without taking stock, or restock first.`);
            }
          }
          await tx.stockMovement.create({
            data: {
              storeId, productId: p.productId, quantity: p.quantity, type: MovementType.STOCK_OUT, sourceWhId: warehouseId,
              referenceId: original.id, notes: `Restored deleted order ${invoiceNumber}`, userId: tenant.userId,
            },
          });
          unitsTaken += p.quantity;
        }
      }

      // A website order deleted here was marked "don't import again"; it's back, so that note goes.
      if (original.externalOrderId) {
        await tx.activityLog.deleteMany({ where: { storeId, action: WEBSITE_ORDER_DELETED, details: { startsWith: `${original.externalOrderId} ` } } });
      }
      await tx.deletedSale.delete({ where: { id: row.id } });
      return { invoiceNumber, renumbered: invoiceNumber !== original.invoiceNumber, unitsTaken };
    }, { timeout: 20_000, maxWait: 10_000 });

    await logActivity(tenant, "Order Restored", `Restored deleted order ${result.invoiceNumber}${result.unitsTaken ? `, took ${result.unitsTaken} unit(s) out of stock again` : ""}.`);
    revalidatePath("/customers");
    revalidatePath("/dashboard");
    revalidatePath("/inventory");
    return result;
  });
}

/** Removes a deleted order for good. */
export async function purgeDeletedSale(id: string) {
  return guarded("Could not delete this order for good.", async () => {
    const tenant = await requireTenant();
    const row = await db.deletedSale.findFirst({ where: { id, storeId: tenant.storeId }, select: { id: true, invoiceNumber: true } });
    if (!row) throw new UserError("That order is no longer in Recently deleted.");
    await db.deletedSale.delete({ where: { id: row.id } });
    await logActivity(tenant, "Order Deleted Forever", `Deleted ${row.invoiceNumber} for good (it can't be restored now).`);
    return { invoiceNumber: row.invoiceNumber };
  });
}
