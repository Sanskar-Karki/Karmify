"use server";

import { db } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { getDefaultWarehouseIdFor, logActivity } from "@/lib/actions/helpers";
import { guarded, UserError } from "@/lib/actions/result";
import { createSale, type SaleInput } from "@/lib/actions/sales";
import { nameProblem, phoneProblem } from "@/lib/customerIdentity";
import { formatNPR } from "@/lib/utils";
import { revalidatePath } from "next/cache";

// "Future orders": an order taken before its items are in stock, to be sent in a
// few days once they're restocked. Saving one takes no stock and isn't a sale, so
// it stays out of revenue, Analytics and the orders list. "Move to orders" creates
// the real order at that moment (taking the stock then), at the top of the list.

type FutureMode = "walkin" | "delivery" | "pr";

type FutureLine = {
  productId: string;
  variantId: string | null;
  name: string;
  variantLabel: string | null;
  quantity: number;
  /** The price charged for one. */
  unitPrice: number;
};

type FutureOrderData = {
  sale: SaleInput;
  lines: FutureLine[];
  mode: FutureMode;
  /** Delivery: what the customer has already paid up front. */
  advance: number;
};

const isMode = (m: unknown): m is FutureMode => m === "walkin" || m === "delivery" || m === "pr";

/** Saves an order to send later. Any size or colour can be ordered, sold out or not. */
export async function createFutureOrder(input: { sale: SaleInput; mode: FutureMode; advance?: number }) {
  return guarded("Could not save this future order.", async () => {
    const { sale, mode } = input;
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
    const advance = Math.max(0, Number(input.advance) || 0);

    const tenant = await requireTenant();
    const storeId = tenant.storeId;

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
    const data: FutureOrderData = {
      sale: { ...sale, customerName: name, items: lines.map(l => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice, variantId: l.variantId })) },
      lines,
      mode,
      advance,
    };
    const row = await db.futureOrder.create({
      data: {
        storeId,
        customerName: name,
        customerPhone: sale.customerPhone?.trim() || null,
        totalAmount,
        data: data as unknown as object,
        createdBy: tenant.userId,
      },
      select: { id: true },
    });
    const units = lines.reduce((n, l) => n + l.quantity, 0);
    await logActivity(tenant, "Future Order Saved", `Future order for ${name}: ${units} item${units === 1 ? "" : "s"}, ${formatNPR(totalAmount)}. Not sent yet.`);
    revalidatePath("/customers");
    return { id: row.id, customerName: name };
  });
}

/** Future orders, oldest first (waiting longest), each with whether its stock is in yet. */
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

    return all.map(({ row, data }) => {
      // Lines of one product share its total, so what each needs is added up first.
      const needProduct = new Map<string, number>();
      const needVariant = new Map<string, number>();
      for (const l of data.lines) {
        needProduct.set(l.productId, (needProduct.get(l.productId) ?? 0) + l.quantity);
        if (l.variantId) needVariant.set(l.variantId, (needVariant.get(l.variantId) ?? 0) + l.quantity);
      }
      const lines = data.lines.map(l => {
        const gone = !exists.has(l.productId) || (l.variantId !== null && !variantStock.has(l.variantId));
        const inStock = l.variantId ? variantStock.get(l.variantId) ?? 0 : productStock.get(l.productId) ?? 0;
        const enough = !gone
          && (l.variantId ? inStock >= (needVariant.get(l.variantId) ?? 0) : true)
          && (productStock.get(l.productId) ?? 0) >= (needProduct.get(l.productId) ?? 0);
        return { name: l.name, variantLabel: l.variantLabel, quantity: l.quantity, unitPrice: l.unitPrice, inStock: gone ? 0 : inStock, ready: enough, gone };
      });
      return {
        id: row.id,
        customerName: row.customerName,
        customerPhone: row.customerPhone,
        address: data.sale.customerAddress ?? null,
        mode: data.mode,
        totalAmount: row.totalAmount,
        codAmount: data.mode === "delivery" ? data.sale.codAmount : 0,
        advance: data.advance,
        paymentMethod: data.sale.paymentMethod,
        createdAt: row.createdAt,
        lines,
        ready: lines.every(l => l.ready),
      };
    });
  });
}

/**
 * Sends a future order now: creates the real order (new invoice number, dated now,
 * so it's at the top of the orders) and takes its stock. Refused if the stock
 * isn't in yet; nothing changes then.
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

/** Drops a future order that won't be sent (the customer cancelled, say). It never took stock. */
export async function deleteFutureOrder(id: string) {
  return guarded("Could not delete this future order.", async () => {
    const tenant = await requireTenant();
    const row = await db.futureOrder.findFirst({ where: { id, storeId: tenant.storeId }, select: { id: true, customerName: true, totalAmount: true } });
    if (!row) throw new UserError("This future order was already moved to the orders or deleted.");
    // deleteMany: deleted at the same moment elsewhere reads as "already deleted", not an error.
    const removed = await db.futureOrder.deleteMany({ where: { id: row.id, storeId: tenant.storeId } });
    if (removed.count === 0) throw new UserError("This future order was already moved to the orders or deleted.");
    await logActivity(tenant, "Future Order Deleted", `Deleted the future order for ${row.customerName ?? "a customer"} (${formatNPR(row.totalAmount)}).`);
    revalidatePath("/customers");
    return { customerName: row.customerName };
  });
}
