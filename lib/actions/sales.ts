"use server";

import { db } from "@/lib/db";
import { MovementType, PaymentMethod, PaymentStatus, DeliveryStatus } from "@prisma/client";
import { requireTenant } from "@/lib/tenant";
import { documentStem, getDefaultWarehouseIdFor, lockDocumentNumbering, logActivity, nextDocumentNumber } from "@/lib/actions/helpers";
import { guarded, retryOnUniqueConflict, UserError } from "@/lib/actions/result";
import { customerIdentityKey, findOrCreateCustomerId, nameProblem, phoneProblem } from "@/lib/customerIdentity";
import { syncStockTotal } from "@/lib/variants";
import { courierStillOpen, isCourierService } from "@/lib/courier";
import { deletedOrderDetails, WEBSITE_ORDER_DELETED } from "@/lib/websiteOrders";
import { formatNPR } from "@/lib/utils";
import { courierEnabledFor } from "@/lib/courierSync";
import { instantCourierLabel, isInstantCourier } from "@/lib/orders";
import { sameLines, setAsideByLine, type FutureOrderData } from "@/lib/futureOrders";
import { openExchangeUnits, ORDER_LEDGER_TYPES, returnOrderLines, takeStock, type StockLine } from "@/lib/stockOut";
import { creditFor, exchangeableUnits, exchangeLineName, exchangeOf, unitCredits, type SaleExchange } from "@/lib/exchange";
import { revalidatePath } from "next/cache";

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/** The order an exchange swaps items from, with what its lines cost and how many came back. */
async function exchangeOriginal(tx: Tx, storeId: string, saleId: string) {
  return tx.sale.findFirst({
    where: { id: saleId, storeId },
    select: {
      id: true, invoiceNumber: true, warehouseId: true, deliveryStatus: true, kind: true, discount: true,
      items: { select: { id: true, productId: true, variantId: true, quantity: true, returnedQty: true, unitPrice: true, variant: true, product: { select: { name: true } } } },
    },
  });
}

/** Points an existing customer at new contact details, keeping their ID. */
async function changeCustomerIdentity(tx: Tx, storeId: string, customerId: string, identityKey: string) {
  const owner = await tx.customer.findUnique({
    where: { storeId_identityKey: { storeId, identityKey } },
    select: { id: true, code: true },
  });
  if (owner && owner.id !== customerId) {
    throw new UserError(`These contact details already belong to customer ${owner.code}.`);
  }
  if (!owner) await tx.customer.update({ where: { id: customerId }, data: { identityKey } });
}

export async function updateCustomerInfo(saleIds: string[], data: { name?: string; phone?: string; address?: string }) {
  return guarded("Could not update this customer.", async () => {
    const tenant = await requireTenant();
    const storeId = tenant.storeId;
    const name = data.name?.trim() || null;
    const phone = data.phone?.trim() || null;

    await db.$transaction(async (tx) => {
      const sales = await tx.sale.findMany({
        where: { id: { in: saleIds }, storeId },
        select: { customerId: true, customerEmail: true },
      });
      const email = sales.find(s => s.customerEmail)?.customerEmail;
      const identityKey = customerIdentityKey({ name, phone, email });
      const current = [...new Set(sales.map(s => s.customerId))];

      let customerId = current.length === 1 ? current[0] : null;
      if (customerId && identityKey) await changeCustomerIdentity(tx, storeId, customerId, identityKey);
      else if (!customerId) customerId = await findOrCreateCustomerId(tx, storeId, identityKey);

      await tx.sale.updateMany({
        where: { id: { in: saleIds }, storeId },
        data: { customerName: name, customerPhone: phone, customerAddress: data.address?.trim() || null, customerId },
      });
    });
    revalidatePath("/customers");
  });
}

export async function deleteSales(saleIds: string[], options: { restock?: boolean } = {}) {
  return guarded("Could not delete these orders.", async () => {
    const tenant = await requireTenant();
    const storeId = tenant.storeId;
    if (saleIds.length === 0) return { deleted: 0, restocked: 0 };

    // A deleted order would leave a live pickup Karmify can no longer track.
    const withCourier = await db.sale.count({
      where: { id: { in: saleIds }, storeId, courierTrackingCode: { not: null }, ...courierStillOpen },
    });
    if (withCourier > 0) {
      throw new UserError(`${withCourier} of these orders ${withCourier === 1 ? "is" : "are"} still with Upaya. Wait until delivered, returned or cancelled, then delete.`);
    }

    const { count, restocked } = await db.$transaction(async (tx) => {
      let units = 0;
      // A copy of each order as it is now, kept 30 days under "Recently deleted".
      const copies = await tx.sale.findMany({
        where: { id: { in: saleIds }, storeId },
        include: { items: { include: { product: { select: { name: true } } } } },
      });
      // What deleting puts back in stock, per order, so a restore can take exactly that out again.
      const putBack = new Map<string, { product: { productId: string; quantity: number }[]; variants: { productId: string; variantId: string; quantity: number }[] }>();
      const putBackFor = (saleId: string) => {
        const entry = putBack.get(saleId) ?? { product: [], variants: [] };
        putBack.set(saleId, entry);
        return entry;
      };

      if (options.restock) {
        const sales = await tx.sale.findMany({
          where: { id: { in: saleIds }, storeId },
          select: { id: true, invoiceNumber: true, warehouseId: true },
        });
        const saleById = new Map(sales.map(s => [s.id, s]));

        // Reverses what the ledger says left stock for each order, rather than
        // the line quantities: a website import can deduct less than was ordered.
        // Units already returned (and put back) are left out, so nothing is restocked twice,
        // and so are units an item edit took off the order without putting back.
        const ledger = await tx.stockMovement.findMany({
          where: { storeId, type: { in: ORDER_LEDGER_TYPES }, referenceId: { in: sales.map(s => s.id) } },
          select: { productId: true, quantity: true, referenceId: true, type: true },
        });
        const taken = new Map<string, { saleId: string; productId: string; quantity: number }>();
        for (const row of ledger) {
          const key = `${row.referenceId}|${row.productId}`;
          const entry = taken.get(key) ?? { saleId: row.referenceId as string, productId: row.productId, quantity: 0 };
          entry.quantity += row.type === MovementType.STOCK_OUT ? row.quantity : -row.quantity;
          taken.set(key, entry);
        }

        for (const out of taken.values()) {
          const sale = saleById.get(out.saleId);
          if (!sale || out.quantity <= 0) continue;
          const added = await tx.stock.updateMany({
            where: { storeId, productId: out.productId, warehouseId: sale.warehouseId },
            data: { quantity: { increment: out.quantity } },
          });
          if (added.count === 0) continue;

          await tx.stockMovement.create({
            data: {
              storeId,
              productId: out.productId,
              quantity: out.quantity,
              type: MovementType.RETURNED,
              destWhId: sale.warehouseId,
              referenceId: sale.id,
              notes: `Restocked: deleted order ${sale.invoiceNumber}`,
              userId: tenant.userId,
            },
          });
          units += out.quantity;
          putBackFor(sale.id).product.push({ productId: out.productId, quantity: out.quantity });
        }

        // Sized products: the units go back to the size/colour each line took
        // from, but never more than the ledger says the order still has out. A
        // website import takes nothing from a size that had none, and giving the
        // ordered quantity back would invent stock.
        const left = new Map([...taken].map(([key, out]) => [key, Math.max(0, out.quantity)]));
        const sizedLines = await tx.saleItem.findMany({
          where: { saleId: { in: sales.map(s => s.id) }, variantId: { not: null } },
          select: { saleId: true, productId: true, variantId: true, quantity: true, returnedQty: true },
        });
        for (const line of sizedLines) {
          const sale = saleById.get(line.saleId);
          if (!sale) continue;
          const key = `${line.saleId}|${line.productId}`;
          const back = Math.min(line.quantity - line.returnedQty, left.get(key) ?? 0);
          if (back <= 0) continue;
          left.set(key, (left.get(key) ?? 0) - back);
          const returned = await tx.productVariant.updateMany({
            where: { id: line.variantId!, storeId },
            data: { quantity: { increment: back } },
          });
          if (returned.count > 0) {
            await syncStockTotal(tx, storeId, line.productId, sale.warehouseId);
            putBackFor(line.saleId).variants.push({ productId: line.productId, variantId: line.variantId!, quantity: back });
          }
        }
      }

      // The website keeps its copy of these orders, so remember they were deleted
      // here; otherwise the next Sync Website would bring them back.
      const websiteOrders = await tx.sale.findMany({
        where: { id: { in: saleIds }, storeId, externalOrderId: { not: null } },
        select: { externalOrderId: true, invoiceNumber: true },
      });

      if (copies.length > 0) {
        await tx.deletedSale.createMany({
          data: copies.map(({ items, ...sale }) => {
            const back = putBack.get(sale.id) ?? { product: [], variants: [] };
            const snapshot = {
              sale,
              items: items.map(({ product, ...item }) => ({ ...item, name: product.name })),
              putBack: back,
            };
            return {
              storeId,
              saleId: sale.id,
              invoiceNumber: sale.invoiceNumber,
              customerName: sale.customerName,
              totalAmount: sale.totalAmount,
              itemCount: items.reduce((n, i) => n + i.quantity, 0),
              restocked: back.product.length > 0 || back.variants.length > 0,
              data: JSON.parse(JSON.stringify(snapshot)),
              deletedBy: tenant.userId,
            };
          }),
        });
      }

      await tx.saleItem.deleteMany({ where: { saleId: { in: saleIds }, sale: { storeId } } });
      const removed = await tx.sale.deleteMany({ where: { id: { in: saleIds }, storeId } });
      if (websiteOrders.length > 0) {
        await tx.activityLog.createMany({
          data: websiteOrders.map(s => ({
            storeId,
            userId: tenant.userId,
            action: WEBSITE_ORDER_DELETED,
            details: deletedOrderDetails(s.externalOrderId!, s.invoiceNumber),
          })),
        });
      }
      return { count: removed.count, restocked: units };
    }, { timeout: 20_000, maxWait: 10_000 });

    await logActivity(tenant, "Orders Deleted", `Deleted ${count} order(s)${restocked ? `, returned ${restocked} unit(s) to stock` : ""}.`);

    revalidatePath("/customers");
    revalidatePath("/sales");
    revalidatePath("/dashboard");
    revalidatePath("/inventory");
    return { deleted: count, restocked };
  });
}

/**
 * The customer an order belongs to after its contact details change, or
 * undefined if it stays where it is. A correction on a customer's only order
 * keeps their ID; otherwise the order moves to whoever those details belong to.
 */
async function customerAfterEdit(
  tx: Tx,
  storeId: string,
  sale: { customerId: string | null; customerName: string | null; customerPhone: string | null; customerEmail: string | null },
  edit: { customerName?: string; customerPhone?: string }
) {
  const before = customerIdentityKey({ name: sale.customerName, phone: sale.customerPhone, email: sale.customerEmail });
  const after = customerIdentityKey({
    name: edit.customerName ?? sale.customerName,
    phone: edit.customerPhone ?? sale.customerPhone,
    email: sale.customerEmail,
  });
  if (after === before) return undefined;
  if (!after) return null;

  const owner = await tx.customer.findUnique({
    where: { storeId_identityKey: { storeId, identityKey: after } },
    select: { id: true },
  });
  if (owner) return owner.id;

  if (sale.customerId && (await tx.sale.count({ where: { customerId: sale.customerId } })) === 1) {
    await tx.customer.update({ where: { id: sale.customerId }, data: { identityKey: after } });
    return sale.customerId;
  }
  return findOrCreateCustomerId(tx, storeId, after);
}

/** One line of an order as edited: an existing line keeps its itemId; a new one has none. */
export type EditedLine = { itemId?: string | null; productId: string; variantId?: string | null; quantity: number; unitPrice: number };

/**
 * Replaces an order's lines and moves stock by the difference: units added are
 * taken out (refused if there aren't enough). Units removed go back only with
 * `putBack`, never more than the order actually has out (a website import can
 * take less than ordered). Without it they stay out of stock, and a marker in the
 * ledger stops a later delete or return from putting them back after all.
 * Lines with returns keep their product and size, and can't drop below what came back.
 * Returns the order's new goods value and a note for the activity log.
 */
async function applyItemEdit(
  tx: Tx,
  tenant: { storeId: string; userId: string },
  sale: { id: string; invoiceNumber: string; warehouseId: string; deliveryStatus: DeliveryStatus },
  lines: EditedLine[],
  putBack: boolean,
) {
  const storeId = tenant.storeId;
  if (sale.deliveryStatus === DeliveryStatus.CANCELLED || sale.deliveryStatus === DeliveryStatus.RETURNED) {
    throw new UserError("The items of a cancelled or returned order can't be changed.");
  }
  if (lines.length === 0) throw new UserError("An order needs at least one item. To drop the whole order, delete it instead.");
  if (lines.some(l => !Number.isInteger(l.quantity) || l.quantity <= 0 || !Number.isFinite(l.unitPrice) || l.unitPrice < 0)) {
    throw new UserError("Each item needs a whole quantity of 1 or more and a price of 0 or more.");
  }

  const current = await tx.saleItem.findMany({
    where: { saleId: sale.id },
    select: { id: true, productId: true, variantId: true, quantity: true, returnedQty: true, unitPrice: true, variant: true, product: { select: { name: true } } },
  });
  const inExchange = await openExchangeUnits(tx, storeId, sale.id);
  const productIds = [...new Set([...lines.map(l => l.productId), ...current.map(i => i.productId)])];
  const products = await tx.product.findMany({
    where: { id: { in: productIds }, storeId },
    select: { id: true, name: true, variants: { select: { id: true, size: true, color: true } } },
  });
  const productOf = (id: string) => products.find(p => p.id === id);
  const labelOf = (productId: string, variantId: string | null) => {
    const v = variantId ? productOf(productId)?.variants.find(x => x.id === variantId) : null;
    return v ? [v.size, v.color].filter(Boolean).join(" · ") || null : null;
  };
  const nameOf = (productId: string, variantId: string | null) => {
    const label = labelOf(productId, variantId);
    const name = productOf(productId)?.name ?? current.find(i => i.productId === productId)?.product.name ?? "a product";
    return label ? `${name} (${label})` : name;
  };

  // Check each line against the catalog and against the line it replaces.
  const kept = new Set<string>();
  const clean = lines.map(l => {
    const variantId = l.variantId || null;
    const existing = l.itemId ? current.find(i => i.id === l.itemId) : undefined;
    if (l.itemId && !existing) throw new UserError("One of the items is no longer on this order. Refresh and try again.");
    if (existing) {
      if (kept.has(existing.id)) throw new UserError("The same order line appears twice. Refresh and try again.");
      kept.add(existing.id);
    }
    const unchangedProduct = existing && existing.productId === l.productId && existing.variantId === variantId;
    if (!unchangedProduct) {
      const product = productOf(l.productId);
      if (!product) throw new UserError("A product on this order no longer exists. Pick another one.");
      if (variantId && !product.variants.some(v => v.id === variantId)) throw new UserError(`That size/colour of "${product.name}" no longer exists. Pick another one.`);
      if (!variantId && product.variants.length > 0) throw new UserError(`Choose a size/colour for "${product.name}".`);
    }
    if (existing && existing.returnedQty > 0) {
      if (!unchangedProduct) throw new UserError(`"${nameOf(existing.productId, existing.variantId)}" has returns recorded, so its product and size can't be changed.`);
      if (l.quantity < existing.returnedQty) throw new UserError(`${existing.returnedQty} of "${nameOf(existing.productId, existing.variantId)}" came back already, so it can't go below ${existing.returnedQty}.`);
    }
    // Units on their way back in an exchange are held the same way.
    const exchanging = existing ? inExchange.get(existing.id) ?? 0 : 0;
    if (existing && exchanging > 0) {
      const floor = existing.returnedQty + exchanging;
      if (!unchangedProduct) throw new UserError(`"${nameOf(existing.productId, existing.variantId)}" is being exchanged, so its product and size can't be changed.`);
      if (l.quantity < floor) throw new UserError(`${exchanging} of "${nameOf(existing.productId, existing.variantId)}" ${exchanging === 1 ? "is" : "are"} being exchanged, so it can't go below ${floor}.`);
    }
    return { ...l, variantId, existing };
  });
  for (const item of current) {
    if (!kept.has(item.id) && item.returnedQty > 0) {
      throw new UserError(`"${nameOf(item.productId, item.variantId)}" has returns recorded, so it can't be removed from the order.`);
    }
    if (!kept.has(item.id) && (inExchange.get(item.id) ?? 0) > 0) {
      throw new UserError(`"${nameOf(item.productId, item.variantId)}" is being exchanged, so it can't be removed from the order.`);
    }
  }

  // The stock difference per product + size/colour.
  const keyOf = (productId: string, variantId: string | null) => `${productId}|${variantId ?? ""}`;
  const delta = new Map<string, { productId: string; variantId: string | null; change: number }>();
  const shift = (productId: string, variantId: string | null, change: number) => {
    const key = keyOf(productId, variantId);
    const entry = delta.get(key) ?? { productId, variantId, change: 0 };
    entry.change += change;
    delta.set(key, entry);
  };
  for (const item of current) shift(item.productId, item.variantId, -item.quantity);
  for (const line of clean) shift(line.productId, line.variantId, line.quantity);

  // What this order still has out of stock per product, from the ledger (as returns and deletes use).
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

  const changes: string[] = [];
  // Put back first, so swapping one size for another of the same product works on its last units.
  for (const d of [...delta.values()].filter(d => d.change < 0)) {
    const back = Math.min(-d.change, Math.max(0, stillOut.get(d.productId) ?? 0));
    const label = labelOf(d.productId, d.variantId);
    if (back <= 0) {
      changes.push(`−${-d.change} ${nameOf(d.productId, d.variantId)}`);
      continue;
    }
    stillOut.set(d.productId, (stillOut.get(d.productId) ?? 0) - back);
    if (!putBack) {
      // Stock doesn't change; the marker only says these units are no longer this order's.
      changes.push(`−${-d.change} ${nameOf(d.productId, d.variantId)} (not put back in stock)`);
      await tx.stockMovement.create({
        data: {
          storeId, productId: d.productId, quantity: back, type: MovementType.ADJUSTMENT, referenceId: sale.id,
          notes: `Removed from order ${sale.invoiceNumber} (edited)${label ? ` · ${label}` : ""}, not put back in stock`,
          userId: tenant.userId,
        },
      });
      continue;
    }
    changes.push(`−${-d.change} ${nameOf(d.productId, d.variantId)} (put back in stock)`);
    const toSize = d.variantId
      ? await tx.productVariant.updateMany({ where: { id: d.variantId, storeId }, data: { quantity: { increment: back } } })
      : { count: 0 };
    if (toSize.count > 0) await syncStockTotal(tx, storeId, d.productId, sale.warehouseId);
    else {
      await tx.stock.upsert({
        where: { productId_warehouseId: { productId: d.productId, warehouseId: sale.warehouseId } },
        update: { quantity: { increment: back } },
        create: { storeId, productId: d.productId, warehouseId: sale.warehouseId, quantity: back },
      });
    }
    await tx.stockMovement.create({
      data: {
        storeId, productId: d.productId, quantity: back, type: MovementType.RETURNED, destWhId: sale.warehouseId, referenceId: sale.id,
        notes: `Removed from order ${sale.invoiceNumber} (edited)${label ? ` · ${label}` : ""}`,
        userId: tenant.userId,
      },
    });
  }
  for (const d of [...delta.values()].filter(d => d.change > 0)) {
    changes.push(`+${d.change} ${nameOf(d.productId, d.variantId)}`);
    if (d.variantId) {
      const took = await tx.productVariant.updateMany({
        where: { id: d.variantId, productId: d.productId, storeId, quantity: { gte: d.change } },
        data: { quantity: { decrement: d.change } },
      });
      if (took.count === 0) {
        const left = (await tx.productVariant.findUnique({ where: { id: d.variantId }, select: { quantity: true } }))?.quantity ?? 0;
        throw new UserError(`Not enough stock of "${nameOf(d.productId, d.variantId)}": ${left} left, ${d.change} more needed.`);
      }
    }
    const deducted = await tx.stock.updateMany({
      where: { storeId, productId: d.productId, warehouseId: sale.warehouseId, quantity: { gte: d.change } },
      data: { quantity: { decrement: d.change } },
    });
    if (deducted.count === 0) {
      const left = (await tx.stock.findFirst({ where: { storeId, productId: d.productId, warehouseId: sale.warehouseId }, select: { quantity: true } }))?.quantity ?? 0;
      throw new UserError(`Not enough stock of "${nameOf(d.productId, d.variantId)}": ${left} left, ${d.change} more needed.`);
    }
    await tx.stockMovement.create({
      data: {
        storeId, productId: d.productId, quantity: d.change, type: MovementType.STOCK_OUT, sourceWhId: sale.warehouseId, referenceId: sale.id,
        notes: `Added to order ${sale.invoiceNumber} (edited)${labelOf(d.productId, d.variantId) ? ` · ${labelOf(d.productId, d.variantId)}` : ""}`,
        userId: tenant.userId,
      },
    });
  }

  // Now the lines themselves.
  const removed = current.filter(i => !kept.has(i.id)).map(i => i.id);
  if (removed.length) await tx.saleItem.deleteMany({ where: { id: { in: removed }, saleId: sale.id } });
  for (const line of clean) {
    const fields = { productId: line.productId, variantId: line.variantId, variant: labelOf(line.productId, line.variantId), quantity: line.quantity, unitPrice: line.unitPrice };
    if (line.existing) {
      const e = line.existing;
      const same = e.productId === fields.productId && e.variantId === fields.variantId && e.quantity === fields.quantity && e.unitPrice === fields.unitPrice;
      if (same) continue;
      if (e.unitPrice !== fields.unitPrice) changes.push(`${nameOf(line.productId, line.variantId)} price ${formatNPR(e.unitPrice)} → ${formatNPR(fields.unitPrice)}`);
      // A website line keeps the size text it came with when its size row is unchanged.
      const variant = e.productId === fields.productId && e.variantId === fields.variantId ? e.variant ?? fields.variant : fields.variant;
      await tx.saleItem.update({ where: { id: e.id }, data: { ...fields, variant } });
    } else {
      await tx.saleItem.create({ data: { saleId: sale.id, ...fields } });
    }
  }

  const goods = clean.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
  const goodsBefore = current.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
  return { goods, goodsBefore, note: changes.join(", ") };
}

export async function updateSaleDetails(saleId: string, data: {
  /** The order's lines, replacing the current ones; stock moves by the difference. */
  items?: EditedLine[];
  /** With items: put units taken off the order back in stock. Off by default: they stay out. */
  putBackRemoved?: boolean;
  /** Order discount (on top of line prices). With items, the total becomes goods less this. */
  discount?: number;
  totalAmount?: number;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  deliveryStatus?: DeliveryStatus;
  deliveryAmount?: number;
  codAmount?: number;
  paymentMethod?: PaymentMethod;
  /** "yango" when it was sent with Yango, or null for none. */
  deliveryVia?: string | null;
  /** The Upaya hub location, or null to clear it. Not changeable once booked with Upaya. */
  courierArea?: { areaId: number; locationId: number; title: string } | null;
  /** Upaya door to door (3) or door to branch (9). Not changeable once booked. */
  courierServiceId?: number;
}) {
  return guarded("Could not save this order.", async () => {
    const area = data.courierArea;
    if (area && (!Number.isInteger(area.areaId) || area.areaId <= 0 || !Number.isInteger(area.locationId) || area.locationId <= 0)) {
      throw new UserError("Choose the Upaya hub location again.");
    }
    if (data.deliveryVia && !isInstantCourier(data.deliveryVia)) throw new UserError("Unknown delivery app.");
    const tenant = await requireTenant();
    for (const amount of [data.totalAmount, data.deliveryAmount, data.codAmount, data.discount]) {
      if (amount !== undefined && (!Number.isFinite(amount) || amount < 0)) {
        throw new UserError("Amounts can't be negative.");
      }
    }

    const current = await db.sale.findFirst({
      where: { id: saleId, storeId: tenant.storeId },
      select: {
        id: true, invoiceNumber: true, warehouseId: true, kind: true, discount: true, totalAmount: true,
        paymentMethod: true, deliveryStatus: true, paymentStatus: true, courierTrackingCode: true,
        customerId: true, customerName: true, customerPhone: true, customerEmail: true,
      },
    });
    if (!current) throw new UserError("That order no longer exists. Refresh the page and try again.");
    if (data.courierServiceId !== undefined && !isCourierService(data.courierServiceId)) throw new UserError("Choose door to door or door to branch.");
    if ((data.courierArea !== undefined || data.courierServiceId !== undefined) && current.courierTrackingCode) {
      throw new UserError("This order is already booked with Upaya, which keeps the hub it was booked with.");
    }

    // Cash on delivery is only collected at the door, so when delivery status
    // changes the payment follows it. QR orders are paid up front.
    // A COD amount typed on an order paid by QR or cash (or already paid) means the
    // rider still collects that much: it becomes a part-paid cash-on-delivery order.
    const owedAgain = data.codAmount !== undefined && data.codAmount > 0 && current.kind !== "pr";
    const switchedToCod = owedAgain && (data.paymentMethod ?? current.paymentMethod) !== PaymentMethod.COD;
    if (switchedToCod) data = { ...data, paymentMethod: PaymentMethod.COD };
    const method = data.paymentMethod ?? current.paymentMethod;
    const deliveryChanged = data.deliveryStatus !== undefined && data.deliveryStatus !== current.deliveryStatus;
    const byStatus: PaymentStatus | undefined = deliveryChanged && method === PaymentMethod.COD
      ? (data.deliveryStatus === DeliveryStatus.DELIVERED ? PaymentStatus.PAID : PaymentStatus.UNPAID)
      : undefined;
    // COD changed by hand: 0 means the customer has paid (nothing left to collect);
    // an amount again on an order not yet delivered means it's still owed.
    const finalStatus = data.deliveryStatus ?? current.deliveryStatus;
    const goneBack = finalStatus === DeliveryStatus.RETURNED || finalStatus === DeliveryStatus.RETURN_PROCESS || finalStatus === DeliveryStatus.CANCELLED;
    const byCod: PaymentStatus | undefined = switchedToCod
      ? PaymentStatus.PARTIAL
      : method !== PaymentMethod.COD || data.codAmount === undefined || goneBack
        ? undefined
        : data.codAmount === 0
          ? PaymentStatus.PAID
          : current.paymentStatus === PaymentStatus.PAID
            ? PaymentStatus.UNPAID
            : undefined;
    // Marked Delivered in the same save: the rider has collected it.
    const paymentStatus = byStatus === PaymentStatus.PAID ? byStatus : byCod ?? byStatus;

    const itemNote = await db.$transaction(async (tx) => {
      const customerId = await customerAfterEdit(tx, tenant.storeId, current, data);
      // New lines: stock moves by the difference, and the total moves with the goods.
      // A PR order stays free: its whole goods value is the discount.
      let money: { totalAmount?: number; discount?: number } = {
        ...(data.totalAmount !== undefined && { totalAmount: data.totalAmount }),
        ...(data.discount !== undefined && { discount: data.discount }),
      };
      let note = "";
      if (data.items) {
        const edit = await applyItemEdit(tx, tenant, current, data.items, data.putBackRemoved === true);
        note = edit.note;
        const discount = current.kind === "pr" ? edit.goods : data.discount ?? current.discount;
        if (discount > edit.goods + 0.001) throw new UserError(`The discount (${formatNPR(discount)}) is more than the items are worth (${formatNPR(edit.goods)}).`);
        // The total moves by the change in goods and discount, so anything else in it stays:
        // a website order's total includes its delivery charge.
        const moved = (edit.goods - discount) - (edit.goodsBefore - current.discount);
        money = { discount, totalAmount: current.kind === "pr" ? 0 : Math.max(0, Math.round((current.totalAmount + moved) * 100) / 100) };
      }
      await tx.sale.update({
      where: { id: saleId, storeId: tenant.storeId },
      data: {
        ...(customerId !== undefined && { customerId }),
        ...money,
        ...(data.customerName !== undefined && { customerName: data.customerName.trim() || null }),
        ...(data.customerPhone !== undefined && { customerPhone: data.customerPhone.trim() || null }),
        ...(data.customerAddress !== undefined && { customerAddress: data.customerAddress.trim() || null }),
        ...(data.deliveryStatus !== undefined && { deliveryStatus: data.deliveryStatus }),
        ...(data.deliveryAmount !== undefined && { deliveryAmount: data.deliveryAmount }),
        ...(data.paymentMethod !== undefined && { paymentMethod: data.paymentMethod }),
        ...(data.codAmount !== undefined && { codAmount: data.codAmount }),
        ...(data.deliveryVia !== undefined && { deliveryVia: data.deliveryVia || null }),
        ...(data.courierServiceId !== undefined && { courierServiceId: data.courierServiceId }),
        ...(area !== undefined && {
          courierAreaId: area?.areaId ?? null,
          courierLocationId: area?.locationId ?? null,
          courierAreaTitle: area ? area.title.slice(0, 200) || null : null,
        }),
        ...(paymentStatus !== undefined && { paymentStatus }),
      },
      });
      return note;
    }, { timeout: 20_000, maxWait: 10_000 });
    if (itemNote) {
      await logActivity(tenant, "Order Items Edited", `Changed the items of ${current.invoiceNumber}: ${itemNote}.`.slice(0, 1000));
      revalidatePath("/inventory");
      revalidatePath("/products");
    }
    revalidatePath("/customers");
    revalidatePath("/sales");
    revalidatePath("/dashboard");
  });
}

/** Applies one delivery status to many orders, following the same COD payment rule. */
export async function updateDeliveryStatuses(saleIds: string[], status: DeliveryStatus) {
  return guarded("Could not update these orders.", async () => {
    const tenant = await requireTenant();
    const scope = { id: { in: saleIds }, storeId: tenant.storeId, deliveryStatus: { not: status } };

    const [cod, others] = await db.$transaction([
      db.sale.updateMany({
        where: { ...scope, paymentMethod: PaymentMethod.COD },
        data: {
          deliveryStatus: status,
          paymentStatus: status === DeliveryStatus.DELIVERED ? PaymentStatus.PAID : PaymentStatus.UNPAID,
        },
      }),
      db.sale.updateMany({
        where: { ...scope, paymentMethod: { not: PaymentMethod.COD } },
        data: { deliveryStatus: status },
      }),
    ]);

    const updated = cod.count + others.count;
    if (updated > 0) await logActivity(tenant, "Orders Updated", `Set ${updated} order(s) to ${status.replace("_", " ")}.`);

    revalidatePath("/customers");
    revalidatePath("/sales");
    revalidatePath("/dashboard");
    return { updated };
  });
}

/** An order as the POS sends it to createSale (and as a future order keeps it until it's sent). */
export type SaleInput = {
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  /** variantId: the size/colour stock row sold, for products with sizes. */
  items: { productId: string; quantity: number; unitPrice: number; variantId?: string | null }[];
  discount: number;
  deliveryAmount: number;
  codAmount: number;
  totalAmount: number;
  paymentMethod: PaymentMethod;
  /** Which shop the sale belongs to. */
  brand?: "originals" | "decor" | null;
  /** Sold over the counter: paid now (cash or QR) and handed over, so nothing to deliver or collect. */
  walkIn?: boolean;
  /** Delivery where the customer paid part up front; codAmount is what's left to collect. */
  partial?: boolean;
  /** Delivery: the Upaya hub location chosen in the POS, so the order can be booked with Upaya. */
  courierArea?: { areaId: number; locationId: number; title: string } | null;
  /** Delivery: Upaya door to door (3) or door to branch (9), used when it's booked. */
  courierServiceId?: number | null;
  /** PR: given free to someone (an influencer, say). Stock goes out, no money comes in. */
  pr?: boolean;
  /** Walk-in sent with Yango: paid in full at the till, so no delivery charge or COD. */
  deliveryVia?: string | null;
  /** An existing customer staff confirmed this is ("same person"), so the order joins their history. */
  customerId?: string | null;
};

export async function createSale(data: SaleInput & {
  /** A future order being sent now: it's removed in the same step, so it can't become two orders. */
  futureOrderId?: string;
  /**
   * An exchange (lib/exchange.ts): this order sends the replacements for these
   * lines of an earlier order, which the customer sends back. Their worth is in
   * `discount`. A walk-in hands them over now, so they're back in stock at once;
   * a delivery waits for staff to tick them received.
   */
  exchangeOf?: { saleId: string; items: { itemId: string; quantity: number }[] };
}) {
  return guarded("Could not complete this sale. Nothing was charged or deducted.", async () => {
    const pr = data.pr === true;
    if (data.exchangeOf) {
      const lines = data.exchangeOf.items;
      if (pr) throw new UserError("A PR order can't be an exchange.");
      if (data.futureOrderId) throw new UserError("A future order can't be an exchange.");
      if (typeof data.exchangeOf.saleId !== "string" || !Array.isArray(lines) || lines.length === 0) throw new UserError("Choose the items the customer is sending back.");
      if (lines.some(l => typeof l.itemId !== "string" || !Number.isInteger(l.quantity) || l.quantity <= 0)) throw new UserError("Each item coming back needs a whole quantity of 1 or more.");
      if (new Set(lines.map(l => l.itemId)).size !== lines.length) throw new UserError("An item coming back is listed twice. Refresh and try again.");
    }
    if (pr && !data.customerName?.trim()) throw new UserError("Enter who the PR order is for.");
    if (data.customerName?.trim() && nameProblem(data.customerName)) throw new UserError(nameProblem(data.customerName)!);
    if (data.customerPhone?.trim() && phoneProblem(data.customerPhone)) throw new UserError(phoneProblem(data.customerPhone)!);
    for (const amount of [data.discount, data.deliveryAmount, data.codAmount, data.totalAmount]) {
      if (!Number.isFinite(amount) || amount < 0) throw new UserError("Amounts can't be negative.");
    }
    if (data.items.length === 0) throw new UserError("Add at least one product to the cart.");
    const hasAddress = Boolean(data.customerAddress?.trim());
    // Yango is a walk-in option: the customer pays now and the shop books the ride.
    const deliveryVia = data.walkIn && data.pr !== true && isInstantCourier(data.deliveryVia) ? data.deliveryVia : null;
    if (data.deliveryVia && !deliveryVia) throw new UserError("Yango is only for walk-in sales paid now.");
    // Walk-ins (studio or Yango) always pay at the till, in cash or by QR. COD is
    // only for deliveries, where the Upaya rider collects at the door.
    const paymentMethod: PaymentMethod = data.pr === true
      ? PaymentMethod.QR
      : data.walkIn
        ? (data.paymentMethod === PaymentMethod.QR ? PaymentMethod.QR : PaymentMethod.CASH)
        : data.paymentMethod;
    if (!data.walkIn && data.pr !== true && paymentMethod === PaymentMethod.CASH) {
      throw new UserError("Deliveries are paid by COD or QR. Cash is for walk-ins.");
    }
    const area = data.walkIn ? null : data.courierArea ?? null;
    if (area && (!Number.isInteger(area.areaId) || area.areaId <= 0 || !Number.isInteger(area.locationId) || area.locationId <= 0)) {
      throw new UserError("Choose the Upaya hub location again.");
    }
    if (data.items.some(item => !Number.isInteger(item.quantity) || item.quantity <= 0 || item.unitPrice < 0)) {
      throw new UserError("One of the cart items has an invalid quantity or price.");
    }

    const tenant = await requireTenant();
    const storeId = tenant.storeId;
    // A delivery goes with Upaya, which needs the hub location, whether it's booked now or later.
    // (A future order being moved in keeps whatever it was saved with.)
    if (!data.walkIn && !pr && !data.futureOrderId && !area && courierEnabledFor(storeId)) {
      throw new UserError("Choose the Upaya hub location for this delivery.");
    }
    const warehouseId = await getDefaultWarehouseIdFor(storeId);
    const walkIn = data.walkIn === true && !pr;
    const paymentStatus: PaymentStatus = pr
      ? "PAID" // Nothing to collect.
      : walkIn || paymentMethod !== PaymentMethod.COD ? "PAID" : data.partial && data.codAmount > 0 ? "PARTIAL" : "UNPAID";
    // A PR order is worth nothing to the shop: its goods value is all recorded as discount.
    const goodsValue = data.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const money = pr
      ? { discount: goodsValue, deliveryAmount: 0, codAmount: 0, totalAmount: 0 }
      : {
          discount: data.discount,
          deliveryAmount: walkIn ? 0 : data.deliveryAmount,
          codAmount: walkIn ? 0 : data.codAmount,
          totalAmount: data.totalAmount,
        };
    // Handed over now (walk-in, or a PR gift with no address); otherwise it still has to be delivered.
    const handedOver = walkIn || (pr && !hasAddress);

    // Retried because two tills can claim the same invoice number at once.
    const sale = await retryOnUniqueConflict(() => db.$transaction(async (tx) => {
      await lockDocumentNumbering(tx, storeId);
      // A future order being sent: removed in this same step, so it can't become two
      // orders. Stock set aside for it when it was saved becomes this order's instead
      // of being taken again; only the rest is taken now. That's only allowed for
      // exactly the items that were saved (this action can be called directly).
      let setAsideMovements = 0;
      let toTake: StockLine[] = data.items;
      if (data.futureOrderId) {
        const future = await tx.futureOrder.findFirst({ where: { id: data.futureOrderId, storeId }, select: { data: true } });
        const removed = future ? await tx.futureOrder.deleteMany({ where: { id: data.futureOrderId, storeId } }) : { count: 0 };
        if (!future || removed.count === 0) throw new UserError("This future order was already moved to the orders or deleted.");
        const saved = future.data as unknown as FutureOrderData;
        const aside = setAsideByLine(saved);
        if (aside.some(n => n > 0)) {
          if (!sameLines(saved.sale.items, data.items)) throw new UserError("These items don't match the stock set aside for this future order. Refresh and try again.");
          setAsideMovements = aside.filter(n => n > 0).length;
          toTake = saved.lines
            .map((l, i) => ({ productId: l.productId, variantId: l.variantId, quantity: l.quantity - aside[i] }))
            .filter(l => l.quantity > 0);
        }
      }
      // An exchange: the items coming back must still be on that order, not returned
      // and not already in another exchange. Sales are created one at a time per store
      // (the numbering lock above), so two exchanges can't both claim the same units.
      let exchange: SaleExchange | null = null;
      let original: Awaited<ReturnType<typeof exchangeOriginal>> = null;
      if (data.exchangeOf) {
        original = await exchangeOriginal(tx, storeId, data.exchangeOf.saleId);
        if (!original) throw new UserError("The order being exchanged no longer exists. Refresh and try again.");
        if (original.deliveryStatus === DeliveryStatus.CANCELLED) throw new UserError(`${original.invoiceNumber} was cancelled, so there's nothing to exchange.`);
        if (original.kind === "pr") throw new UserError(`${original.invoiceNumber} was a PR order, given free, so it can't be exchanged.`);
        const open = await openExchangeUnits(tx, storeId, original.id);
        const credits = unitCredits(original);
        const lines = data.exchangeOf.items.map(line => {
          const item = original!.items.find(i => i.id === line.itemId);
          if (!item) throw new UserError(`An item being exchanged is no longer on ${original!.invoiceNumber}. Refresh and try again.`);
          const can = exchangeableUnits(item, open);
          if (line.quantity > can) {
            throw new UserError(can === 0
              ? `"${item.product.name}" on ${original!.invoiceNumber} was already returned or is in another exchange.`
              : `Only ${can} of "${item.product.name}" on ${original!.invoiceNumber} can still be exchanged.`);
          }
          return {
            itemId: item.id, productId: item.productId, variantId: item.variantId, name: item.product.name, variant: item.variant,
            quantity: line.quantity, unitCredit: credits.get(item.id) ?? item.unitPrice,
          };
        });
        exchange = {
          ofSaleId: original.id,
          ofInvoice: original.invoiceNumber,
          items: lines,
          credit: creditFor(lines),
          // Handed over at the till: the old items are back now.
          receivedAt: walkIn ? new Date().toISOString() : null,
        };
      }

      const stem = documentStem("INV");
      const todays = await tx.sale.findMany({
        where: { storeId, invoiceNumber: { startsWith: stem } },
        select: { invoiceNumber: true },
      });
      const invoiceNumber = nextDocumentNumber(stem, todays.map(s => s.invoiceNumber));
      // The customer staff picked, if it's this store's; otherwise matched by phone, then name.
      const picked = typeof data.customerId === "string" && data.customerId
        ? await tx.customer.findFirst({ where: { id: data.customerId, storeId }, select: { id: true } })
        : null;
      const customerId = picked?.id ?? await findOrCreateCustomerId(
        tx, storeId, customerIdentityKey({ name: data.customerName, phone: data.customerPhone })
      );

      // Size/colour labels for lines that name one ("M · Navy"), checked against the product.
      const variantIds = data.items.map(i => i.variantId).filter((id): id is string => Boolean(id));
      const variantRows = variantIds.length
        ? await tx.productVariant.findMany({ where: { id: { in: variantIds }, storeId }, select: { id: true, productId: true, size: true, color: true } })
        : [];
      const labelFor = (item: { productId: string; variantId?: string | null }) => {
        const v = variantRows.find(row => row.id === item.variantId && row.productId === item.productId);
        return v ? [v.size, v.color].filter(Boolean).join(" · ") || null : null;
      };

      const newSale = await tx.sale.create({
        data: {
          storeId,
          invoiceNumber,
          customerId,
          customerName: data.customerName,
          customerPhone: data.customerPhone,
          customerAddress: data.customerAddress,
          warehouseId,
          ...money,
          paymentStatus,
          paymentMethod,
          brand: data.brand === "originals" || data.brand === "decor" ? data.brand : null,
          kind: pr ? "pr" : "sale",
          deliveryVia,
          ...(handedOver && { deliveryStatus: DeliveryStatus.DELIVERED }),
          ...(area && { courierAreaId: area.areaId, courierLocationId: area.locationId, courierAreaTitle: area.title.slice(0, 200) }),
          ...(!data.walkIn && isCourierService(Number(data.courierServiceId)) && { courierServiceId: Number(data.courierServiceId) }),
          ...(exchange && { exchange: exchange as unknown as object }),
          items: {
            create: data.items.map(item => ({
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              variantId: labelFor(item) !== null || variantRows.some(v => v.id === item.variantId) ? item.variantId : null,
              variant: labelFor(item),
            })),
          },
        },
        include: {
          customer: { select: { code: true } },
          items: { include: { product: { select: { name: true, sku: true } } } },
          warehouse: { select: { name: true } },
        },
      });

      if (setAsideMovements > 0) {
        // That stock went out when the future order was saved: those movements become this order's,
        // so returns, item edits and delete-with-restock see it like any other order's stock.
        const moved = await tx.stockMovement.updateMany({
          where: { storeId, referenceId: data.futureOrderId, type: MovementType.STOCK_OUT },
          data: { referenceId: newSale.id, notes: `POS Sale invoice ${invoiceNumber} (set aside for a future order)` },
        });
        if (moved.count !== setAsideMovements) {
          throw new UserError("The stock set aside for this future order doesn't add up, so nothing was changed. Check the product's stock history.");
        }
      }
      if (toTake.length > 0) {
        await takeStock(tx, {
          storeId,
          warehouseId,
          userId: tenant.userId,
          referenceId: newSale.id,
          notes: `POS Sale invoice ${invoiceNumber}`,
          items: toTake,
          nameOf: productId => newSale.items.find(i => i.productId === productId)?.product.name,
        });
      }

      // A walk-in exchange: the old items were handed over, so they go back in stock now.
      if (exchange?.receivedAt && original) {
        await returnOrderLines(tx, {
          storeId,
          userId: tenant.userId,
          sale: original,
          lines: exchange.items.map(l => ({ itemId: l.itemId, quantity: l.quantity })),
          notes: `Back from exchange ${invoiceNumber} (order ${original.invoiceNumber})`,
        });
      }

      return newSale;
    }, { timeout: 20_000, maxWait: 10_000 }));

    const via = instantCourierLabel(deliveryVia);
    const swap = exchangeOf(sale);
    await logActivity(
      tenant,
      data.futureOrderId ? "Future Order Sent" : pr ? "PR Order Created" : swap ? "Exchange Order Created" : "POS Sale Created",
      pr
        ? `PR order ${sale.invoiceNumber} for ${data.customerName?.trim()}: ${formatNPR(goodsValue)} of goods given free${via ? `, sent with ${via}` : ""}.`
        : swap
          ? `Exchange ${sale.invoiceNumber} for ${swap.ofInvoice}: ${swap.items.map(l => `${l.quantity} × ${exchangeLineName(l)}`).join(", ")} ${swap.receivedAt ? "handed back" : "coming back"}, credit ${formatNPR(swap.credit)}; ${formatNPR(data.totalAmount + (walkIn ? 0 : data.deliveryAmount))} to pay.`.slice(0, 1000)
          : `Completed sale ${sale.invoiceNumber} (${formatNPR(data.totalAmount)})${via ? `, sent with ${via}` : ""}.`
    );

    revalidatePath("/sales");
    revalidatePath("/inventory");
    revalidatePath("/dashboard");
    return sale;
  });
}

/**
 * A customer sent some or all of an order back: puts the chosen units back in
 * stock (to the exact size/colour) and remembers them on the order line, so the
 * same units can't be returned twice. Never puts back more than the order
 * actually took from stock (a website import may have taken less). When every
 * unit has come back, the order is marked Returned.
 */
export async function returnSaleItems(saleId: string, lines: { itemId: string; quantity: number }[], options: { markReturned?: boolean } = {}) {
  return guarded("Could not record this return.", async () => {
    const tenant = await requireTenant();
    const storeId = tenant.storeId;
    const wanted = lines.filter(l => l.quantity > 0);
    if (wanted.some(l => !Number.isInteger(l.quantity))) throw new UserError("Quantities must be whole numbers.");
    if (wanted.length === 0) throw new UserError("Choose at least one item to return.");

    const result = await db.$transaction(async (tx) => {
      const sale = await tx.sale.findFirst({
        where: { id: saleId, storeId },
        select: {
          id: true, invoiceNumber: true, warehouseId: true, deliveryStatus: true, paymentMethod: true,
          items: { select: { id: true, productId: true, variantId: true, quantity: true, returnedQty: true, variant: true, product: { select: { name: true } } } },
        },
      });
      if (!sale) throw new UserError("That order no longer exists. Refresh the page and try again.");
      if (sale.deliveryStatus === DeliveryStatus.CANCELLED) throw new UserError("This order was cancelled, so there is nothing to return.");

      const { units, restocked, parts } = await returnOrderLines(tx, {
        storeId,
        userId: tenant.userId,
        sale,
        lines: wanted,
        notes: `Returned from order ${sale.invoiceNumber}`,
        held: await openExchangeUnits(tx, storeId, sale.id),
      });

      const allBack = sale.items.every(i => {
        const now = i.returnedQty + (wanted.find(l => l.itemId === i.id)?.quantity ?? 0);
        return now >= i.quantity;
      });
      const markReturned = allBack || options.markReturned === true;
      if (markReturned && sale.deliveryStatus !== DeliveryStatus.RETURNED) {
        // Same rule as changing the status by hand: cash on delivery is only collected on a delivered order.
        await tx.sale.update({
          where: { id: sale.id },
          data: { deliveryStatus: DeliveryStatus.RETURNED, ...(sale.paymentMethod === PaymentMethod.COD && { paymentStatus: PaymentStatus.UNPAID }) },
        });
      }
      return { invoiceNumber: sale.invoiceNumber, units, restocked, parts, markedReturned: markReturned };
    }, { timeout: 20_000, maxWait: 10_000 });

    await logActivity(tenant, "Order Returned", `Return on ${result.invoiceNumber}: ${result.parts.join(", ")}.`.slice(0, 1000));
    revalidatePath("/customers");
    revalidatePath("/inventory");
    revalidatePath("/products");
    revalidatePath("/dashboard");
    return { units: result.units, restocked: result.restocked, markedReturned: result.markedReturned };
  });
}
