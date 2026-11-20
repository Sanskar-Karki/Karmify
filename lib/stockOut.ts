import "server-only";

import { MovementType, type Prisma } from "@prisma/client";
import { UserError } from "@/lib/actions/result";
import { isIgnored } from "@/lib/lowStock";
import { syncStockTotal } from "@/lib/variants";

// Taking items out of stock for an order, and putting set-aside items back.
// Used by the POS sale (createSale) and by future orders that set their stock
// aside until the customer's date. Server only: it runs inside a transaction.

type Tx = Prisma.TransactionClient;
export type StockLine = { productId: string; quantity: number; variantId?: string | null };

/**
 * Takes each line out of stock: a sized product's size/colour and the product's
 * total must both have enough. Each check and decrement is one statement, so two
 * tills can't both take the last unit. Writes a STOCK_OUT movement per line under
 * `referenceId`, and a low-stock alert where an item runs low. Throws (rolling the
 * transaction back) when something isn't in stock.
 */
export async function takeStock(tx: Tx, args: {
  storeId: string;
  warehouseId: string;
  userId: string;
  referenceId: string;
  notes: string;
  items: StockLine[];
  /** The product's name, for the "not enough stock" message. */
  nameOf: (productId: string) => string | undefined;
}) {
  const { storeId, warehouseId, userId, referenceId, notes, items, nameOf } = args;
  for (const item of items) {
    if (item.variantId) {
      // Sized product: that size/colour must have enough, checked and taken in one statement.
      const took = await tx.productVariant.updateMany({
        where: { id: item.variantId, productId: item.productId, storeId, quantity: { gte: item.quantity } },
        data: { quantity: { decrement: item.quantity } },
      });
      if (took.count === 0) {
        throw new UserError(`Not enough stock of that size/colour for "${nameOf(item.productId) ?? "a product in the cart"}". Refresh and adjust the cart.`);
      }
    }
    // The stock check and the decrement are one statement, so two
    // simultaneous checkouts can't both take the last unit.
    const deducted = await tx.stock.updateMany({
      where: { storeId, productId: item.productId, warehouseId, quantity: { gte: item.quantity } },
      data: { quantity: { decrement: item.quantity } },
    });
    if (deducted.count === 0) {
      throw new UserError(`Not enough stock for "${nameOf(item.productId) ?? "a product in the cart"}". Refresh and adjust the cart.`);
    }

    await tx.stockMovement.create({
      data: {
        storeId,
        productId: item.productId,
        quantity: item.quantity,
        type: MovementType.STOCK_OUT,
        sourceWhId: warehouseId,
        referenceId,
        notes,
        userId,
      },
    });

    // Low stock is judged per size/colour for sized products, on the total otherwise.
    // An alert that was ignored stays quiet until the item is restocked.
    const stock = await tx.stock.findUniqueOrThrow({
      where: { productId_warehouseId: { productId: item.productId, warehouseId } },
      select: { quantity: true, product: { select: { name: true, minStockLevel: true, lowStockIgnoredQty: true } } },
    });
    const variant = item.variantId
      ? await tx.productVariant.findUnique({ where: { id: item.variantId }, select: { size: true, color: true, quantity: true, lowStockIgnoredQty: true } })
      : null;
    const left = variant ? variant.quantity : stock.quantity;
    const ignoredAt = variant ? variant.lowStockIgnoredQty : stock.product.lowStockIgnoredQty;
    if (left < stock.product.minStockLevel && !isIgnored(left, ignoredAt)) {
      const part = variant ? [variant.size, variant.color].filter(Boolean).join(" · ") : "";
      await tx.notification.create({
        data: {
          storeId,
          title: "Low Stock Alert",
          message: `Stock of "${stock.product.name}"${part ? ` (${part})` : ""} is low (${left} units left).`,
          type: "warning",
        },
      });
    }
  }
}

/**
 * Puts lines back in stock (to the exact size/colour, like a return), writing a
 * RETURNED movement under `referenceId`. A product deleted since is skipped; a
 * size deleted since goes back to the product's total. Returns the units put back.
 */
export async function putBackStock(tx: Tx, args: {
  storeId: string;
  warehouseId: string;
  userId: string;
  referenceId: string;
  notes: string;
  items: StockLine[];
}) {
  const { storeId, warehouseId, userId, referenceId, notes, items } = args;
  let units = 0;
  for (const item of items) {
    const product = await tx.product.findFirst({ where: { id: item.productId, storeId }, select: { id: true } });
    if (!product || item.quantity <= 0) continue;
    if (item.variantId) {
      const toSize = await tx.productVariant.updateMany({ where: { id: item.variantId, storeId }, data: { quantity: { increment: item.quantity } } });
      if (toSize.count > 0) await syncStockTotal(tx, storeId, item.productId, warehouseId);
      else {
        await tx.stock.upsert({
          where: { productId_warehouseId: { productId: item.productId, warehouseId } },
          update: { quantity: { increment: item.quantity } },
          create: { storeId, productId: item.productId, warehouseId, quantity: item.quantity },
        });
      }
    } else {
      await tx.stock.upsert({
        where: { productId_warehouseId: { productId: item.productId, warehouseId } },
        update: { quantity: { increment: item.quantity } },
        create: { storeId, productId: item.productId, warehouseId, quantity: item.quantity },
      });
    }
    await tx.stockMovement.create({
      data: { storeId, productId: item.productId, quantity: item.quantity, type: MovementType.RETURNED, destWhId: warehouseId, referenceId, notes, userId },
    });
    units += item.quantity;
  }
  return units;
}
