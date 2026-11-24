"use server";

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { getDefaultWarehouseIdFor, logActivity } from "@/lib/actions/helpers";
import { guarded, UserError } from "@/lib/actions/result";
import { createSale, type SaleInput } from "@/lib/actions/sales";
import { altPhoneProblem, cleanAltPhone, nameProblem, phoneProblem } from "@/lib/customerIdentity";
import { isCourierService } from "@/lib/courier";
import {
  addDays, futureKindOf, isYmd, MAX_DAYS_AHEAD, nepalToday, sendOnLabel, setAsideByLine,
  type FutureKind, type FutureLine, type FutureMode, type FutureOrderData,
} from "@/lib/futureOrders";
import { putBackStock, takeStock } from "@/lib/stockOut";
import { formatNPR } from "@/lib/utils";
import { revalidatePath } from "next/cache";

// "Future orders": orders taken now and sent later. Two kinds (lib/futureOrders.ts):
//   restock    taken before all the items are in stock: any size or colour. What's on
//              the shelf is set aside when saved; the rest is taken once restocked.
//   scheduled  in stock, sent on the customer's date: all its stock is set aside when saved.
// Neither is a sale, so both stay out of revenue, Analytics and the orders list until
// "Move to orders" creates the real order, at the top of the list.

const isMode = (m: unknown): m is FutureMode => m === "walkin" || m === "delivery" || m === "pr";

/** The send date for a scheduled order: a real date, after today (Nepal), within a year. */
function checkSendOn(sendOn: unknown) {
  if (!isYmd(sendOn)) throw new UserError("Choose the date to send it on.");
  const today = nepalToday();
  if (sendOn <= today) throw new UserError("Choose a date after today. To send it today, complete it as a normal order.");
  if (sendOn > addDays(today, MAX_DAYS_AHEAD)) throw new UserError("That date is more than a year away. Choose an earlier one.");
  return sendOn;
}

/**
 * Saves an order to send later. "restock" (the default): any size or colour, sold
 * out or not; what's in stock is taken out now and kept for the customer, and the
 * rest waits. "scheduled": the items must all be in stock, and they're taken out
 * now and kept for the customer until `sendOn`.
 * replaceId: a saved future order opened in the POS to change its items. It's
 * replaced in the same step: its set-aside stock goes back on the shelf first (so
 * this order can take it again), and the new one keeps its place in the list.
 */
export async function createFutureOrder(input: { sale: SaleInput; mode: FutureMode; advance?: number; kind?: FutureKind; sendOn?: string; replaceId?: string }) {
  return guarded("Could not save this future order.", async () => {
    const { sale, mode } = input;
    const kind: FutureKind = input.kind === "scheduled" ? "scheduled" : "restock";
    if (!isMode(mode)) throw new UserError("Choose Walk-in, Delivery or PR.");
    if (!Array.isArray(sale.items) || sale.items.length === 0) throw new UserError("Add at least one product to the cart.");
    if (sale.items.some(i => !Number.isInteger(i.quantity) || i.quantity <= 0 || !Number.isFinite(i.unitPrice) || i.unitPrice < 0)) {
      throw new UserError("One of the cart items has an invalid quantity or price.");
    }
    for (const amount of [sale.discount, sale.deliveryAmount, sale.codAmount, sale.totalAmount]) {
      if (!Number.isFinite(amount) || amount < 0) throw new UserError("Amounts can't be negative.");
    }
    const name = sale.customerName?.trim();
    if (!name) throw new UserError("Enter who the order is for, so you know whose it is when it's sent.");
    if (nameProblem(name)) throw new UserError(nameProblem(name)!);
    if (sale.customerPhone?.trim() && phoneProblem(sale.customerPhone)) throw new UserError(phoneProblem(sale.customerPhone)!);
    if (sale.customerAltPhone?.trim() && altPhoneProblem(sale.customerAltPhone)) throw new UserError(altPhoneProblem(sale.customerAltPhone)!);
    const advance = Math.max(0, Number(input.advance) || 0);

    const tenant = await requireTenant();
    const storeId = tenant.storeId;
    const gone = "This future order was already moved to the orders or deleted. Save it as a new one, or clear the cart.";
    const replacing = input.replaceId
      ? await db.futureOrder.findFirst({ where: { id: input.replaceId, storeId }, select: { data: true } })
      : null;
    if (input.replaceId && !replacing) throw new UserError(gone);
    // An edited order keeping its date doesn't need it to be in the future (it may be due).
    const keptDate = replacing ? (replacing.data as unknown as FutureOrderData).sendOn : null;
    const sendOn = kind !== "scheduled" ? null : keptDate && input.sendOn === keptDate ? keptDate : checkSendOn(input.sendOn);

    // Names and size/colour labels come from the catalog, so the list reads right later.
    const productIds = [...new Set(sale.items.map(i => i.productId))];
    const products = await db.product.findMany({ where: { id: { in: productIds }, storeId }, select: { id: true, name: true } });
    const variantIds = sale.items.map(i => i.variantId).filter((id): id is string => Boolean(id));
    const variants = variantIds.length
      ? await db.productVariant.findMany({ where: { id: { in: variantIds }, storeId }, select: { id: true, productId: true, size: true, color: true } })
      : [];
    const lines: FutureLine[] = sale.items.map(item => {
      const product = products.find(p => p.id === item.productId);
      if (!product) throw new UserError("A product in the cart no longer exists. Refresh and adjust the cart.");
      const variant = item.variantId ? variants.find(v => v.id === item.variantId && v.productId === item.productId) : null;
      if (item.variantId && !variant) throw new UserError(`That size/colour of "${product.name}" no longer exists. Refresh and adjust the cart.`);
      return {
        productId: item.productId,
        variantId: variant?.id ?? null,
        name: product.name,
        variantLabel: variant ? [variant.size, variant.color].filter(Boolean).join(" · ") || null : null,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      };
    });

    const walkIn = mode === "walkin";
    const totalAmount = mode === "pr" ? 0 : sale.totalAmount + (walkIn ? 0 : sale.deliveryAmount);
    const items = lines.map(l => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice, variantId: l.variantId }));
    const warehouseId = await getDefaultWarehouseIdFor(storeId);

    // Saved and its stock set aside in one step. A scheduled order needs all of it in
    // stock (if anything isn't, nothing is saved); one waiting for stock takes what's
    // on the shelf now and waits for the rest.
    const saved = await db.$transaction(async (tx) => {
      // Replacing: the old one goes, and what it set aside is back on the shelf for this one.
      let createdAt: Date | undefined;
      if (input.replaceId) {
        const old = await tx.futureOrder.findFirst({ where: { id: input.replaceId, storeId }, select: { id: true, customerName: true, data: true, createdAt: true } });
        const removed = old ? await tx.futureOrder.deleteMany({ where: { id: old.id, storeId } }) : { count: 0 };
        if (!old || removed.count === 0) throw new UserError(gone);
        createdAt = old.createdAt;
        const oldData = old.data as unknown as FutureOrderData;
        const aside = setAsideByLine(oldData);
        if (aside.some(n => n > 0)) {
          await putBackStock(tx, {
            storeId,
            warehouseId: oldData.setAsideFrom!,
            userId: tenant.userId,
            referenceId: old.id,
            notes: `Back on the shelf: ${old.customerName ?? "a customer"}'s future order was changed`,
            items: oldData.lines.map((l, i) => ({ productId: l.productId, variantId: l.variantId, quantity: aside[i] })).filter(l => l.quantity > 0),
          });
        }
      }
      const takes = kind === "scheduled" ? lines.map(l => l.quantity) : await shelfTakes(tx, storeId, warehouseId, lines);
      const tookAny = takes.some(n => n > 0);
      const data: FutureOrderData = {
        sale: { ...sale, customerName: name, items },
        lines: lines.map((l, i) => ({ ...l, setAside: takes[i] })),
        mode,
        advance,
        kind,
        sendOn,
        setAsideFrom: tookAny ? warehouseId : null,
      };
      const created = await tx.futureOrder.create({
        data: {
          storeId,
          customerName: name,
          customerPhone: sale.customerPhone?.trim() || null,
          totalAmount,
          data: data as unknown as object,
          createdBy: tenant.userId,
          ...(createdAt && { createdAt }),
        },
        select: { id: true },
      });
      if (tookAny) {
        await takeStock(tx, {
          storeId,
          warehouseId,
          userId: tenant.userId,
          referenceId: created.id,
          notes: sendOn ? `Set aside for ${name}'s future order, to send on ${sendOnLabel(sendOn)}` : `Set aside for ${name}'s future order`,
          items: lines.map((l, i) => ({ productId: l.productId, variantId: l.variantId, quantity: takes[i] })).filter(l => l.quantity > 0),
          nameOf: productId => lines.find(l => l.productId === productId)?.name,
        });
      }
      return { id: created.id, setAside: takes.reduce((n, t) => n + t, 0) };
    }, { timeout: 20_000, maxWait: 10_000 });

    const units = lines.reduce((n, l) => n + l.quantity, 0);
    const waiting = units - saved.setAside;
    const what = `${units} item${units === 1 ? "" : "s"}, ${formatNPR(totalAmount)}`;
    await logActivity(
      tenant,
      input.replaceId ? "Future Order Edited" : "Future Order Saved",
      (input.replaceId ? "Changed items: " : "") + (sendOn
        ? `Future order for ${name}: ${what}, to send on ${sendOnLabel(sendOn)}. Its stock is set aside.`
        : `Future order for ${name}: ${what}. ${
            saved.setAside === 0 ? "Waiting for stock; nothing taken yet."
              : waiting === 0 ? "All in stock: set aside."
                : `${saved.setAside} in stock set aside; ${waiting} waiting for stock.`
          }`)
    );
    revalidatePath("/customers");
    if (saved.setAside > 0 || input.replaceId) {
      revalidatePath("/inventory");
      revalidatePath("/products");
    }
    return { id: saved.id, customerName: name, kind, sendOn, setAside: saved.setAside, waiting, replaced: Boolean(input.replaceId) };
  });
}

/**
 * How many of each line the shelf can give right now, in cart order. Lines of one
 * product share its stock (and lines of one size/colour share that), so each line
 * gets what the lines before it left.
 */
async function shelfTakes(tx: Prisma.TransactionClient, storeId: string, warehouseId: string, lines: FutureLine[]) {
  const productIds = [...new Set(lines.map(l => l.productId))];
  const variantIds = [...new Set(lines.map(l => l.variantId).filter((id): id is string => Boolean(id)))];
  const stocks = await tx.stock.findMany({ where: { storeId, warehouseId, productId: { in: productIds } }, select: { productId: true, quantity: true } });
  const variants = variantIds.length
    ? await tx.productVariant.findMany({ where: { storeId, id: { in: variantIds } }, select: { id: true, quantity: true } })
    : [];
  const product = new Map(stocks.map(s => [s.productId, Math.max(0, s.quantity)]));
  const variant = new Map(variants.map(v => [v.id, Math.max(0, v.quantity)]));
  return lines.map(line => {
    const room = Math.min(product.get(line.productId) ?? 0, line.variantId ? variant.get(line.variantId) ?? 0 : Infinity);
    const take = Math.max(0, Math.min(line.quantity, room));
    product.set(line.productId, (product.get(line.productId) ?? 0) - take);
    if (line.variantId) variant.set(line.variantId, (variant.get(line.variantId) ?? 0) - take);
    return take;
  });
}

/**
 * Future orders: the ones with a send date first (soonest first), then the ones
 * waiting for stock (waiting longest first), each line with whether it can go.
 */
export async function listFutureOrders() {
  return guarded("Could not load future orders.", async () => {
    const tenant = await requireTenant();
    const storeId = tenant.storeId;
    const rows = await db.futureOrder.findMany({ where: { storeId }, orderBy: { createdAt: "asc" }, take: 300 });
    if (rows.length === 0) return [];

    const all = rows.map(row => ({ row, data: row.data as unknown as FutureOrderData }));
    const productIds = [...new Set(all.flatMap(o => o.data.lines.map(l => l.productId)))];
    const variantIds = [...new Set(all.flatMap(o => o.data.lines.map(l => l.variantId)).filter((id): id is string => Boolean(id)))];
    const warehouseId = await getDefaultWarehouseIdFor(storeId);
    const [stocks, variants, products] = await Promise.all([
      db.stock.findMany({ where: { storeId, warehouseId, productId: { in: productIds } }, select: { productId: true, quantity: true } }),
      variantIds.length ? db.productVariant.findMany({ where: { storeId, id: { in: variantIds } }, select: { id: true, quantity: true } }) : [],
      db.product.findMany({ where: { storeId, id: { in: productIds } }, select: { id: true } }),
    ]);
    const productStock = new Map(stocks.map(s => [s.productId, s.quantity]));
    const variantStock = new Map(variants.map(v => [v.id, v.quantity]));
    const exists = new Set(products.map(p => p.id));

    const list = all.map(({ row, data }) => {
      const kind = futureKindOf(data);
      const aside = setAsideByLine(data);
      // Set-aside units are already off the shelf, so only the rest needs stock. Lines
      // of one product share its total, so what they still need is added up first.
      const needProduct = new Map<string, number>();
      const needVariant = new Map<string, number>();
      data.lines.forEach((l, i) => {
        const rest = l.quantity - aside[i];
        needProduct.set(l.productId, (needProduct.get(l.productId) ?? 0) + rest);
        if (l.variantId) needVariant.set(l.variantId, (needVariant.get(l.variantId) ?? 0) + rest);
      });
      const lines = data.lines.map((l, i) => {
        const gone = !exists.has(l.productId) || (l.variantId !== null && !variantStock.has(l.variantId));
        const inStock = l.variantId ? variantStock.get(l.variantId) ?? 0 : productStock.get(l.productId) ?? 0;
        const enough = !gone && (aside[i] === l.quantity || (
          (l.variantId ? inStock >= (needVariant.get(l.variantId) ?? 0) : true)
          && (productStock.get(l.productId) ?? 0) >= (needProduct.get(l.productId) ?? 0)
        ));
        return {
          name: l.name, variantLabel: l.variantLabel, quantity: l.quantity, unitPrice: l.unitPrice,
          inStock: gone ? 0 : inStock, setAside: aside[i], ready: enough, gone,
        };
      });
      return {
        id: row.id,
        kind,
        sendOn: kind === "scheduled" && isYmd(data.sendOn) ? data.sendOn : null,
        /** Units taken out of stock for it when it was saved. */
        setAside: aside.reduce((n, a) => n + a, 0),
        customerName: row.customerName,
        customerPhone: row.customerPhone,
        customerAltPhone: data.sale.customerAltPhone?.trim() || null,
        address: data.sale.customerAddress ?? null,
        mode: data.mode,
        totalAmount: row.totalAmount,
        codAmount: data.mode === "delivery" ? data.sale.codAmount : 0,
        // What the Edit dialog starts from.
        goodsTotal: data.sale.totalAmount,
        deliveryAmount: data.mode === "delivery" ? data.sale.deliveryAmount : 0,
        courierArea: data.sale.courierArea ?? null,
        courierServiceId: data.sale.courierServiceId ?? null,
        advance: data.advance,
        paymentMethod: data.sale.paymentMethod,
        createdAt: row.createdAt,
        lines,
        ready: lines.every(l => l.ready),
      };
    });

    const dated = list.filter(o => o.sendOn).sort((a, b) => a.sendOn!.localeCompare(b.sendOn!));
    return [...dated, ...list.filter(o => !o.sendOn)];
  });
}

/** One saved future order as the POS needs it, to open it there and change its items. */
export async function getFutureOrder(id: string) {
  return guarded("Could not load this future order.", async () => {
    const tenant = await requireTenant();
    const row = await db.futureOrder.findFirst({ where: { id, storeId: tenant.storeId }, select: { id: true, data: true } });
    if (!row) throw new UserError("This future order was already moved to the orders or deleted.");
    const data = row.data as unknown as FutureOrderData;
    const aside = setAsideByLine(data);
    return {
      id: row.id,
      mode: data.mode,
      kind: futureKindOf(data),
      sendOn: data.sendOn ?? null,
      advance: data.advance,
      sale: data.sale,
      lines: data.lines.map((l, i) => ({
        productId: l.productId, variantId: l.variantId, name: l.name, variantLabel: l.variantLabel,
        quantity: l.quantity, unitPrice: l.unitPrice, setAside: aside[i],
      })),
    };
  });
}

/**
 * Sends a future order now: creates the real order (new invoice number, dated now,
 * so it's at the top of the orders). The order takes over the stock set aside for
 * it and takes the rest now, and is refused if the rest isn't in yet.
 */
export async function moveFutureOrder(id: string) {
  const found = await guarded("Could not load this future order.", async () => {
    const tenant = await requireTenant();
    const row = await db.futureOrder.findFirst({ where: { id, storeId: tenant.storeId }, select: { data: true } });
    if (!row) throw new UserError("This future order was already moved to the orders or deleted.");
    return (row.data as unknown as FutureOrderData).sale;
  });
  if (!found.ok) return found;
  const result = await createSale({ ...found.data, futureOrderId: id });
  if (!result.ok) {
    // createSale's stock message speaks of the POS cart; here the fix is restocking.
    const message = result.message.replace(/ Refresh and adjust the cart\.$/, " Restock it first, then move this order.");
    return { ok: false as const, message };
  }
  revalidatePath("/customers");
  return result;
}

export type FutureOrderEdit = {
  customerName: string;
  customerPhone?: string;
  customerAltPhone?: string;
  customerAddress?: string;
  /** Scheduled orders: the day to send it on. */
  sendOn?: string;
  /** Delivery orders: the charge, what the rider collects, and the Upaya hub and service. */
  deliveryAmount?: number;
  codAmount?: number;
  courierArea?: { areaId: number; locationId: number; title: string } | null;
  courierServiceId?: number | null;
};

/**
 * Changes a saved future order's customer details, send date and delivery money.
 * Its items stay as saved: their stock may already be set aside, and "Move to
 * orders" sends exactly those (to change items, delete it and save a new one).
 */
export async function updateFutureOrder(id: string, edit: FutureOrderEdit) {
  return guarded("Could not save the changes to this future order.", async () => {
    const name = edit.customerName?.trim();
    if (!name) throw new UserError("Enter who the order is for.");
    if (nameProblem(name)) throw new UserError(nameProblem(name)!);
    const phone = edit.customerPhone?.trim() ?? "";
    if (phone && phoneProblem(phone)) throw new UserError(phoneProblem(phone)!);
    if (edit.customerAltPhone?.trim() && altPhoneProblem(edit.customerAltPhone)) throw new UserError(altPhoneProblem(edit.customerAltPhone)!);

    const tenant = await requireTenant();
    const storeId = tenant.storeId;
    const row = await db.futureOrder.findFirst({ where: { id, storeId }, select: { id: true, data: true, totalAmount: true } });
    if (!row) throw new UserError("This future order was already moved to the orders or deleted.");
    const data = row.data as unknown as FutureOrderData;
    const sale: SaleInput = { ...data.sale };
    const changes: string[] = [];

    // A field left out keeps what was saved.
    sale.customerName = name;
    if (edit.customerPhone !== undefined) sale.customerPhone = phone || undefined;
    if (edit.customerAltPhone !== undefined) sale.customerAltPhone = cleanAltPhone(edit.customerAltPhone, sale.customerPhone) ?? undefined;
    if (edit.customerAddress !== undefined && (data.mode !== "walkin" || sale.customerAddress)) sale.customerAddress = edit.customerAddress.trim() || undefined;

    // The date: only checked when it changes, so a late order can still have its phone fixed.
    let sendOn = data.sendOn ?? null;
    if (futureKindOf(data) === "scheduled" && edit.sendOn !== undefined && edit.sendOn !== data.sendOn) {
      sendOn = checkSendOn(edit.sendOn);
      changes.push(`send date to ${sendOnLabel(sendOn)}`);
    }

    let advance = data.advance;
    if (data.mode === "delivery") {
      const delivery = edit.deliveryAmount ?? sale.deliveryAmount;
      if (!Number.isFinite(delivery) || delivery < 0) throw new UserError("The delivery charge can't be negative.");
      const grand = Math.round((sale.totalAmount + delivery) * 100) / 100;
      if (sale.paymentMethod === "COD") {
        const cod = edit.codAmount ?? sale.codAmount + (delivery - sale.deliveryAmount);
        if (!Number.isFinite(cod) || cod <= 0) throw new UserError("Enter the amount for the rider to collect (more than 0).");
        if (cod > grand + 0.001) throw new UserError(`The amount to collect can't be more than the total, ${formatNPR(grand)}.`);
        // Anything not collected on delivery was paid up front.
        advance = Math.round((grand - cod) * 100) / 100;
        sale.codAmount = Math.round(cod * 100) / 100;
        sale.partial = advance > 0;
      }
      if (delivery !== sale.deliveryAmount) changes.push(`delivery charge to ${formatNPR(delivery)}`);
      sale.deliveryAmount = delivery;
      if (edit.courierArea !== undefined) {
        const area = edit.courierArea;
        if (area && !(Number.isInteger(area.areaId) && Number.isInteger(area.locationId))) throw new UserError("Choose the Upaya hub location again.");
        sale.courierArea = area ? { areaId: area.areaId, locationId: area.locationId, title: String(area.title ?? "").slice(0, 200) } : null;
      }
      if (edit.courierServiceId !== undefined) {
        sale.courierServiceId = edit.courierServiceId !== null && isCourierService(Number(edit.courierServiceId)) ? Number(edit.courierServiceId) : null;
      }
    }

    const totalAmount = data.mode === "pr" ? 0 : sale.totalAmount + (data.mode === "walkin" ? 0 : sale.deliveryAmount);
    const next: FutureOrderData = { ...data, sale, advance, sendOn };
    const updated = await db.futureOrder.updateMany({
      where: { id: row.id, storeId },
      data: { customerName: name, customerPhone: sale.customerPhone?.trim() || null, totalAmount, data: next as unknown as object },
    });
    if (updated.count === 0) throw new UserError("This future order was already moved to the orders or deleted.");

    await logActivity(tenant, "Future Order Edited", `Edited the future order for ${name}${changes.length ? `: ${changes.join(", ")}` : ""}.`);
    revalidatePath("/customers");
    return { customerName: name };
  });
}

/**
 * Drops a future order that won't be sent (the customer cancelled, say). Any stock
 * set aside for it goes back on the shelf in the same step.
 */
export async function deleteFutureOrder(id: string) {
  return guarded("Could not delete this future order.", async () => {
    const tenant = await requireTenant();
    const storeId = tenant.storeId;
    const result = await db.$transaction(async (tx) => {
      const row = await tx.futureOrder.findFirst({ where: { id, storeId }, select: { id: true, customerName: true, totalAmount: true, data: true } });
      if (!row) throw new UserError("This future order was already moved to the orders or deleted.");
      // deleteMany: deleted at the same moment elsewhere reads as "already deleted", not an error.
      const removed = await tx.futureOrder.deleteMany({ where: { id: row.id, storeId } });
      if (removed.count === 0) throw new UserError("This future order was already moved to the orders or deleted.");
      const data = row.data as unknown as FutureOrderData;
      const aside = setAsideByLine(data);
      const putBack = aside.some(n => n > 0)
        ? await putBackStock(tx, {
            storeId,
            warehouseId: data.setAsideFrom!,
            userId: tenant.userId,
            referenceId: row.id,
            notes: `Back on the shelf: ${row.customerName ?? "a customer"}'s future order was deleted`,
            items: data.lines.map((l, i) => ({ productId: l.productId, variantId: l.variantId, quantity: aside[i] })).filter(l => l.quantity > 0),
          })
        : 0;
      return { customerName: row.customerName, totalAmount: row.totalAmount, putBack };
    }, { timeout: 20_000, maxWait: 10_000 });

    await logActivity(
      tenant,
      "Future Order Deleted",
      `Deleted the future order for ${result.customerName ?? "a customer"} (${formatNPR(result.totalAmount)})${result.putBack ? `; ${result.putBack} item${result.putBack === 1 ? "" : "s"} put back in stock` : ""}.`
    );
    revalidatePath("/customers");
    if (result.putBack) {
      revalidatePath("/inventory");
      revalidatePath("/products");
    }
    return { customerName: result.customerName, putBack: result.putBack };
  });
}
