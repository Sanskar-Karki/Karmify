"use server";

import { db } from "@/lib/db";
import { MovementType, PaymentMethod, PaymentStatus, DeliveryStatus } from "@prisma/client";
import { requireTenant } from "@/lib/tenant";
import { documentStem, getDefaultWarehouseIdFor, lockDocumentNumbering, logActivity, nextDocumentNumber } from "@/lib/actions/helpers";
import { guarded, retryOnUniqueConflict, UserError } from "@/lib/actions/result";
import { customerIdentityKey, findOrCreateCustomerId, nameProblem, phoneProblem } from "@/lib/customerIdentity";
import { syncStockTotal } from "@/lib/variants";
import { courierStillOpen } from "@/lib/courier";
import { deletedOrderDetails, WEBSITE_ORDER_DELETED } from "@/lib/websiteOrders";
import { formatNPR } from "@/lib/utils";
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
        const deductions = await tx.stockMovement.findMany({
          where: { storeId, type: MovementType.STOCK_OUT, referenceId: { in: sales.map(s => s.id) } },
          select: { productId: true, quantity: true, referenceId: true },
        });

        for (const deduction of deductions) {
          const sale = saleById.get(deduction.referenceId as string);
          if (!sale) continue;
          const added = await tx.stock.updateMany({
            where: { storeId, productId: deduction.productId, warehouseId: sale.warehouseId },
            data: { quantity: { increment: deduction.quantity } },
          });
          if (added.count === 0) continue;

          await tx.stockMovement.create({
            data: {
              storeId,
              productId: deduction.productId,
              quantity: deduction.quantity,
              type: MovementType.RETURNED,
              destWhId: sale.warehouseId,
              referenceId: sale.id,
              notes: `Restocked: deleted order ${sale.invoiceNumber}`,
              userId: tenant.userId,
            },
          });
          units += deduction.quantity;
        }

        // Sized products: the units go back to the size/colour each line took
        // from, but never more than the ledger says the order took. A website
        // import takes nothing from a size that had none, and giving the
        // ordered quantity back would invent stock.
        const taken = new Map<string, number>();
        for (const deduction of deductions) {
          const key = `${deduction.referenceId}|${deduction.productId}`;
          taken.set(key, (taken.get(key) ?? 0) + deduction.quantity);
        }
        const sizedLines = await tx.saleItem.findMany({
          where: { saleId: { in: sales.map(s => s.id) }, variantId: { not: null } },
          select: { saleId: true, productId: true, variantId: true, quantity: true },
        });
        for (const line of sizedLines) {
          const sale = saleById.get(line.saleId);
          if (!sale) continue;
          const key = `${line.saleId}|${line.productId}`;
          const back = Math.min(line.quantity, taken.get(key) ?? 0);
          if (back <= 0) continue;
          taken.set(key, (taken.get(key) ?? 0) - back);
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
}) {
  return guarded("Could not save this order.", async () => {
    const tenant = await requireTenant();
    for (const amount of [data.totalAmount, data.deliveryAmount, data.codAmount]) {
      if (amount !== undefined && (!Number.isFinite(amount) || amount < 0)) {
        throw new UserError("Amounts can't be negative.");
      }
    }

    const current = await db.sale.findFirst({
      where: { id: saleId, storeId: tenant.storeId },
      select: {
        paymentMethod: true, deliveryStatus: true,
        customerId: true, customerName: true, customerPhone: true, customerEmail: true,
      },
    });
    if (!current) throw new UserError("That order no longer exists. Refresh the page and try again.");

    // Cash on delivery is only collected at the door, so when delivery status
    // changes the payment follows it. QR orders are paid up front.
    const method = data.paymentMethod ?? current.paymentMethod;
    const deliveryChanged = data.deliveryStatus !== undefined && data.deliveryStatus !== current.deliveryStatus;
    const paymentStatus: PaymentStatus | undefined = deliveryChanged && method === PaymentMethod.COD
      ? (data.deliveryStatus === DeliveryStatus.DELIVERED ? PaymentStatus.PAID : PaymentStatus.UNPAID)
      : undefined;

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
}) {
  return guarded("Could not complete this sale. Nothing was charged or deducted.", async () => {
    if (data.customerName?.trim() && nameProblem(data.customerName)) throw new UserError(nameProblem(data.customerName)!);
    if (data.customerPhone?.trim() && phoneProblem(data.customerPhone)) throw new UserError(phoneProblem(data.customerPhone)!);
    for (const amount of [data.discount, data.deliveryAmount, data.codAmount, data.totalAmount]) {
      if (!Number.isFinite(amount) || amount < 0) throw new UserError("Amounts can't be negative.");
    }
    if (data.items.length === 0) throw new UserError("Add at least one product to the cart.");
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
    const walkIn = data.walkIn === true;
    const paymentStatus: PaymentStatus =
      walkIn || data.paymentMethod === PaymentMethod.QR ? "PAID" : data.partial && data.codAmount > 0 ? "PARTIAL" : "UNPAID";

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
          discount: data.discount,
          deliveryAmount: walkIn ? 0 : data.deliveryAmount,
          codAmount: walkIn ? 0 : data.codAmount,
          totalAmount: data.totalAmount,
          paymentStatus,
          paymentMethod: data.paymentMethod,
          brand: data.brand === "originals" || data.brand === "decor" ? data.brand : null,
          ...(walkIn && { deliveryStatus: DeliveryStatus.DELIVERED }),
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

        const stock = await tx.stock.findUniqueOrThrow({
          where: { productId_warehouseId: { productId: item.productId, warehouseId } },
          select: { quantity: true, product: { select: { name: true, minStockLevel: true } } },
        });
        if (stock.quantity < stock.product.minStockLevel) {
          await tx.notification.create({
            data: {
              storeId,
              title: "Low Stock Alert",
              message: `Stock of "${stock.product.name}" is low (${stock.quantity} units left).`,
              type: "warning",
            },
          });
        }
      }

      return newSale;
    }, { timeout: 20_000, maxWait: 10_000 }));

    await logActivity(tenant, "POS Sale Created", `Completed sale ${sale.invoiceNumber} (${formatNPR(data.totalAmount)}).`);

    revalidatePath("/sales");
    revalidatePath("/inventory");
    revalidatePath("/dashboard");
    return sale;
  });
}
