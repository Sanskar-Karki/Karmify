"use server";

import { db } from "@/lib/db";
import { MovementType, PaymentMethod, PaymentStatus, DeliveryStatus } from "@prisma/client";
import { requireTenant } from "@/lib/tenant";
import { documentStem, getDefaultWarehouseIdFor, lockDocumentNumbering, logActivity, nextDocumentNumber } from "@/lib/actions/helpers";
import { guarded, retryOnUniqueConflict, UserError } from "@/lib/actions/result";
import { isIgnored } from "@/lib/lowStock";
import { customerIdentityKey, findOrCreateCustomerId, nameProblem, phoneProblem } from "@/lib/customerIdentity";
import { syncStockTotal } from "@/lib/variants";
import { courierStillOpen } from "@/lib/courier";
import { deletedOrderDetails, WEBSITE_ORDER_DELETED } from "@/lib/websiteOrders";
import { formatNPR } from "@/lib/utils";
import { instantCourierLabel, isInstantCourier } from "@/lib/orders";
import { revalidatePath } from "next/cache";

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

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

      if (options.restock) {
        const sales = await tx.sale.findMany({
          where: { id: { in: saleIds }, storeId },
          select: { id: true, invoiceNumber: true, warehouseId: true },
        });
        const saleById = new Map(sales.map(s => [s.id, s]));

        // Reverses what the ledger says left stock for each order, rather than
        // the line quantities: a website import can deduct less than was ordered.
        // Units already returned (and put back) are left out, so nothing is restocked twice.
        const ledger = await tx.stockMovement.findMany({
          where: { storeId, type: { in: [MovementType.STOCK_OUT, MovementType.RETURNED] }, referenceId: { in: sales.map(s => s.id) } },
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
          if (returned.count > 0) await syncStockTotal(tx, storeId, line.productId, sale.warehouseId);
        }
      }

      // The website keeps its copy of these orders, so remember they were deleted
      // here; otherwise the next Sync Website would bring them back.
      const websiteOrders = await tx.sale.findMany({
        where: { id: { in: saleIds }, storeId, externalOrderId: { not: null } },
        select: { externalOrderId: true, invoiceNumber: true },
      });

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

export async function updateSaleDetails(saleId: string, data: {
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
}) {
  return guarded("Could not save this order.", async () => {
    if (data.deliveryVia && !isInstantCourier(data.deliveryVia)) throw new UserError("Unknown delivery app.");
    const tenant = await requireTenant();
    for (const amount of [data.totalAmount, data.deliveryAmount, data.codAmount]) {
      if (amount !== undefined && (!Number.isFinite(amount) || amount < 0)) {
        throw new UserError("Amounts can't be negative.");
      }
    }

    const current = await db.sale.findFirst({
      where: { id: saleId, storeId: tenant.storeId },
      select: {
        paymentMethod: true, deliveryStatus: true, paymentStatus: true,
        customerId: true, customerName: true, customerPhone: true, customerEmail: true,
      },
    });
    if (!current) throw new UserError("That order no longer exists. Refresh the page and try again.");

    // Cash on delivery is only collected at the door, so when delivery status
    // changes the payment follows it. QR orders are paid up front.
    const method = data.paymentMethod ?? current.paymentMethod;
    const deliveryChanged = data.deliveryStatus !== undefined && data.deliveryStatus !== current.deliveryStatus;
    const byStatus: PaymentStatus | undefined = deliveryChanged && method === PaymentMethod.COD
      ? (data.deliveryStatus === DeliveryStatus.DELIVERED ? PaymentStatus.PAID : PaymentStatus.UNPAID)
      : undefined;
    // COD changed by hand: 0 means the customer has paid (nothing left to collect);
    // an amount again on an order not yet delivered means it's still owed.
    const finalStatus = data.deliveryStatus ?? current.deliveryStatus;
    const goneBack = finalStatus === DeliveryStatus.RETURNED || finalStatus === DeliveryStatus.RETURN_PROCESS || finalStatus === DeliveryStatus.CANCELLED;
    const byCod: PaymentStatus | undefined = method !== PaymentMethod.COD || data.codAmount === undefined || goneBack
      ? undefined
      : data.codAmount === 0
        ? PaymentStatus.PAID
        : current.paymentStatus === PaymentStatus.PAID && finalStatus !== DeliveryStatus.DELIVERED
          ? PaymentStatus.UNPAID
          : undefined;
    const paymentStatus = byCod ?? byStatus;

    await db.$transaction(async (tx) => {
      const customerId = await customerAfterEdit(tx, tenant.storeId, current, data);
      await tx.sale.update({
      where: { id: saleId, storeId: tenant.storeId },
      data: {
        ...(customerId !== undefined && { customerId }),
        ...(data.totalAmount !== undefined && { totalAmount: data.totalAmount }),
        ...(data.customerName !== undefined && { customerName: data.customerName.trim() || null }),
        ...(data.customerPhone !== undefined && { customerPhone: data.customerPhone.trim() || null }),
        ...(data.customerAddress !== undefined && { customerAddress: data.customerAddress.trim() || null }),
        ...(data.deliveryStatus !== undefined && { deliveryStatus: data.deliveryStatus }),
        ...(data.deliveryAmount !== undefined && { deliveryAmount: data.deliveryAmount }),
        ...(data.paymentMethod !== undefined && { paymentMethod: data.paymentMethod }),
        ...(data.codAmount !== undefined && { codAmount: data.codAmount }),
        ...(data.deliveryVia !== undefined && { deliveryVia: data.deliveryVia || null }),
        ...(paymentStatus !== undefined && { paymentStatus }),
      },
      });
    });
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

export async function createSale(data: {
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
  /** PR: given free to someone (an influencer, say). Stock goes out, no money comes in. */
  pr?: boolean;
  /** Walk-in sent with Yango: paid in full at the till, so no delivery charge or COD. */
  deliveryVia?: string | null;
}) {
  return guarded("Could not complete this sale. Nothing was charged or deducted.", async () => {
    const pr = data.pr === true;
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
      const stem = documentStem("INV");
      const todays = await tx.sale.findMany({
        where: { storeId, invoiceNumber: { startsWith: stem } },
        select: { invoiceNumber: true },
      });
      const invoiceNumber = nextDocumentNumber(stem, todays.map(s => s.invoiceNumber));
      const customerId = await findOrCreateCustomerId(
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

      for (const item of data.items) {
        if (item.variantId) {
          // Sized product: that size/colour must have enough, checked and taken in one statement.
          const took = await tx.productVariant.updateMany({
            where: { id: item.variantId, productId: item.productId, storeId, quantity: { gte: item.quantity } },
            data: { quantity: { decrement: item.quantity } },
          });
          if (took.count === 0) {
            const line = newSale.items.find(i => i.productId === item.productId);
            throw new UserError(`Not enough stock of that size/colour for "${line?.product.name ?? "a product in the cart"}". Refresh and adjust the cart.`);
          }
        }
        // The stock check and the decrement are one statement, so two
        // simultaneous checkouts can't both take the last unit.
        const deducted = await tx.stock.updateMany({
          where: { storeId, productId: item.productId, warehouseId, quantity: { gte: item.quantity } },
          data: { quantity: { decrement: item.quantity } },
        });

        if (deducted.count === 0) {
          const line = newSale.items.find(i => i.productId === item.productId);
          throw new UserError(`Not enough stock for "${line?.product.name ?? "a product in the cart"}". Refresh and adjust the cart.`);
        }

        await tx.stockMovement.create({
          data: {
            storeId,
            productId: item.productId,
            quantity: item.quantity,
            type: MovementType.STOCK_OUT,
            sourceWhId: warehouseId,
            referenceId: newSale.id,
            notes: `POS Sale invoice ${invoiceNumber}`,
            userId: tenant.userId,
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

      return newSale;
    }, { timeout: 20_000, maxWait: 10_000 }));

    const via = instantCourierLabel(deliveryVia);
    await logActivity(
      tenant,
      pr ? "PR Order Created" : "POS Sale Created",
      pr
        ? `PR order ${sale.invoiceNumber} for ${data.customerName?.trim()}: ${formatNPR(goodsValue)} of goods given free${via ? `, sent with ${via}` : ""}.`
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

      // What the order took from stock per product, less what has come back already.
      const ledger = await tx.stockMovement.groupBy({
        by: ["productId", "type"],
        where: { storeId, referenceId: sale.id, type: { in: [MovementType.STOCK_OUT, MovementType.RETURNED] } },
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
      for (const line of wanted) {
        const item = sale.items.find(i => i.id === line.itemId);
        if (!item) throw new UserError("One of the items is no longer on this order. Refresh and try again.");
        const left = item.quantity - item.returnedQty;
        if (line.quantity > left) {
          throw new UserError(`Only ${left} of "${item.product.name}" can still be returned.`);
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
            notes: `Returned from order ${sale.invoiceNumber}${item.variant ? ` · ${item.variant}` : ""}`,
            userId: tenant.userId,
          },
        });
        restocked += back;
      }

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
