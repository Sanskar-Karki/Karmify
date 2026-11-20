import "server-only";

import { MovementType, type Prisma } from "@prisma/client";
import { UserError } from "@/lib/actions/result";
import { isIgnored } from "@/lib/lowStock";
import { syncStockTotal } from "@/lib/variants";
import { unitsInOpenExchanges } from "@/lib/exchange";

// Taking items out of stock for an order, and putting set-aside items back.
// Used by the POS sale (createSale) and by future orders that set their stock
// aside until the customer's date. Server only: it runs inside a transaction.

type Tx = Prisma.TransactionClient;
export type StockLine = { productId: string; quantity: number; variantId?: string | null };

/**
 * The movements that say what an order still has out of stock: STOCK_OUT adds,
 * the rest take away. ADJUSTMENT counts only with the order as its reference,
 * which only an item edit writes, for removed units not put back in stock.
 */
export const ORDER_LEDGER_TYPES = [MovementType.STOCK_OUT, MovementType.RETURNED, MovementType.ADJUSTMENT];

type OrderForReturn = {
  id: string;
  invoiceNumber: string;
  warehouseId: string;
  items: { id: string; productId: string; variantId: string | null; quantity: number; returnedQty: number; variant: string | null; product: { name: string } }[];
};

/**
 * Units of each line of an order that are on their way back in an exchange not
 * yet received (keyed by line id). They're held like returned units: they can't
 * be returned, exchanged again, or edited off the order meanwhile.
 */
export async function openExchangeUnits(tx: Tx, storeId: string, saleId: string) {
  const exchanges = await tx.sale.findMany({
    where: { storeId, exchange: { path: ["ofSaleId"], equals: saleId } },
    select: { id: true, exchange: true, deliveryStatus: true },
  });
  return unitsInOpenExchanges(exchanges, saleId);
}

/**
 * Units of an order that came back from the customer: counts them on the order's
 * lines (so they can't come back twice) and puts them back in stock, to the exact
 * size/colour, never more than the order actually took (a website import may have
 * taken less). Writes a RETURNED movement under the order. Doesn't change the
 * order's status: the caller decides that. Throws (rolling back) on a bad line.
 */
export async function returnOrderLines(tx: Tx, args: {
  storeId: string;
  userId: string;
  sale: OrderForReturn;
  lines: { itemId: string; quantity: number }[];
  /** The stock history note, e.g. "Returned from order INV-…". */
  notes: string;
  /** Units of each line held by open exchanges (see openExchangeUnits), which can't come back this way. */
  held?: Map<string, number>;
}) {
  const { storeId, userId, sale, lines, notes, held } = args;
  // What the order took from stock per product, less what has come back already.
  const ledger = await tx.stockMovement.groupBy({
    by: ["productId", "type"],
    where: { storeId, referenceId: sale.id, type: { in: ORDER_LEDGER_TYPES } },
    _sum: { quantity: true },
  });
  const stillOut = new Map<string, number>();
  for (const row of ledger) {
    const sign = row.type === MovementType.STOCK_OUT ? 1 : -1;
    stillOut.set(row.productId, (stillOut.get(row.productId) ?? 0) + sign * (row._sum.quantity ?? 0));
  }

  const parts: string[] = [];
  let units = 0;
  let restocked = 0;
  for (const line of lines) {
    const item = sale.items.find(i => i.id === line.itemId);
    if (!item) throw new UserError("One of the items is no longer on this order. Refresh and try again.");
    const exchanging = held?.get(item.id) ?? 0;
    const left = Math.max(0, item.quantity - item.returnedQty - exchanging);
    if (line.quantity > left) {
      throw new UserError(`Only ${left} of "${item.product.name}" can still be returned${exchanging > 0 ? ` (${exchanging} ${exchanging === 1 ? "is" : "are"} coming back in an exchange)` : ""}.`);
    }

    // Claim the units on the line first, so two people returning at once can't both succeed.
    const claimed = await tx.saleItem.updateMany({
      where: { id: item.id, returnedQty: item.returnedQty },
      data: { returnedQty: { increment: line.quantity } },
    });
    if (claimed.count === 0) throw new UserError("This order was just changed by someone else. Refresh and try again.");
    units += line.quantity;

    const back = Math.min(line.quantity, Math.max(0, stillOut.get(item.productId) ?? 0));
    const label = item.variant ? `${item.product.name} (${item.variant})` : item.product.name;
    parts.push(`${line.quantity} × ${label}${back < line.quantity ? ` (${back} restocked)` : ""}`);
    if (back <= 0) continue;
    stillOut.set(item.productId, (stillOut.get(item.productId) ?? 0) - back);

    if (item.variantId) {
      const toSize = await tx.productVariant.updateMany({ where: { id: item.variantId, storeId }, data: { quantity: { increment: back } } });
      if (toSize.count > 0) await syncStockTotal(tx, storeId, item.productId, sale.warehouseId);
      else {
        // The size was deleted since: the units still go back to the product's total.
        await tx.stock.updateMany({ where: { storeId, productId: item.productId, warehouseId: sale.warehouseId }, data: { quantity: { increment: back } } });
      }
    } else {
      await tx.stock.upsert({
        where: { productId_warehouseId: { productId: item.productId, warehouseId: sale.warehouseId } },
        update: { quantity: { increment: back } },
        create: { storeId, productId: item.productId, warehouseId: sale.warehouseId, quantity: back },
      });
    }
    await tx.stockMovement.create({
      data: {
        storeId,
        productId: item.productId,
        quantity: back,
        type: MovementType.RETURNED,
        destWhId: sale.warehouseId,
        referenceId: sale.id,
        notes: `${notes}${item.variant ? ` · ${item.variant}` : ""}`,
        userId,
      },
    });
    restocked += back;
  }
  return { units, restocked, parts };
}

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
