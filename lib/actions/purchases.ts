"use server";

import { db } from "@/lib/db";
import { MovementType, OrderStatus, PaymentStatus } from "@prisma/client";
import { requireTenant } from "@/lib/tenant";
import { documentStem, getDefaultWarehouseIdFor, lockDocumentNumbering, logActivity, nextDocumentNumber, notify } from "@/lib/actions/helpers";
import { guarded, retryOnUniqueConflict, UserError } from "@/lib/actions/result";
import { formatNPR } from "@/lib/utils";
import { revalidatePath } from "next/cache";

export async function createPurchaseOrder(data: {
  supplierId: string;
  items: { productId: string; quantity: number; unitCost: number }[];
  totalAmount: number;
  notes?: string;
}) {
  return guarded("Could not create this purchase order.", async () => {
    if (data.items.length === 0) throw new UserError("Add at least one line item.");
    if (data.items.some(item => !Number.isInteger(item.quantity) || item.quantity <= 0 || item.unitCost < 0)) {
      throw new UserError("One of the line items has an invalid quantity or cost.");
    }

    const tenant = await requireTenant();
    const storeId = tenant.storeId;

    const productIds = [...new Set(data.items.map(item => item.productId))];
    const [supplier, ownedProducts] = await Promise.all([
      db.supplier.findFirst({ where: { id: data.supplierId, storeId }, select: { id: true } }),
      db.product.count({ where: { id: { in: productIds }, storeId } }),
    ]);
    if (!supplier || ownedProducts !== productIds.length) {
      throw new UserError("The supplier or a product no longer exists. Refresh and try again.");
    }

    const warehouseId = await getDefaultWarehouseIdFor(storeId);

    const order = await retryOnUniqueConflict(() => db.$transaction(async (tx) => {
      await lockDocumentNumbering(tx, storeId);
      const stem = documentStem("PO");
      const todays = await tx.purchaseOrder.findMany({
        where: { storeId, orderNumber: { startsWith: stem } },
        select: { orderNumber: true },
      });

      return tx.purchaseOrder.create({
        data: {
          storeId,
          orderNumber: nextDocumentNumber(stem, todays.map(o => o.orderNumber)),
          supplierId: data.supplierId,
          warehouseId,
          status: OrderStatus.PENDING,
          paymentStatus: PaymentStatus.UNPAID,
          totalAmount: data.totalAmount,
          notes: data.notes,
          items: {
            create: data.items.map(item => ({
              productId: item.productId,
              quantity: item.quantity,
              unitCost: item.unitCost,
            })),
          },
        },
        include: { supplier: { select: { companyName: true } } },
      });
    }));

    await logActivity(
      tenant,
      "Purchase Order Created",
      `Created purchase order ${order.orderNumber} (${formatNPR(data.totalAmount)}) for "${order.supplier.companyName}".`
    );

    revalidatePath("/purchases");
    return { orderNumber: order.orderNumber };
  });
}

export async function receivePurchaseOrder(poId: string) {
  return guarded("Could not receive this purchase order.", async () => {
    const tenant = await requireTenant();
    const storeId = tenant.storeId;

    const order = await db.$transaction(async (tx) => {
      // Claiming the order and checking it is still pending is one statement,
      // so a double click or a second tab can't add the stock twice.
      const claimed = await tx.purchaseOrder.updateMany({
        where: { id: poId, storeId, status: OrderStatus.PENDING },
        data: { status: OrderStatus.COMPLETED, paymentStatus: PaymentStatus.PAID },
      });
      if (claimed.count === 0) {
        throw new UserError("This order has already been received or cancelled.");
      }

      const po = await tx.purchaseOrder.findUniqueOrThrow({
        where: { id: poId },
        include: {
          items: true,
          warehouse: { select: { name: true } },
          supplier: { select: { companyName: true } },
        },
      });

      for (const item of po.items) {
        await tx.stock.upsert({
          where: { productId_warehouseId: { productId: item.productId, warehouseId: po.warehouseId } },
          update: { quantity: { increment: item.quantity } },
          create: { storeId, productId: item.productId, warehouseId: po.warehouseId, quantity: item.quantity },
        });

        await tx.stockMovement.create({
          data: {
            storeId,
            productId: item.productId,
            quantity: item.quantity,
            type: MovementType.STOCK_IN,
            destWhId: po.warehouseId,
            referenceId: po.id,
            notes: `Received PO ${po.orderNumber} from ${po.supplier.companyName}`,
            userId: tenant.userId,
          },
        });
      }

      // Sized products got stock into their total only; ask for the split by size.
      const sized = await tx.product.findMany({
        where: { id: { in: po.items.map(i => i.productId) }, variants: { some: {} } },
        select: { name: true },
      });
      if (sized.length) {
        await tx.notification.create({
          data: {
            storeId,
            title: "Split received stock by size",
            message: `PO ${po.orderNumber} added stock to ${sized.map(p => `"${p.name}"`).join(", ")}. Open each in Products → Edit and enter the new stock per size and colour.`,
            type: "warning",
          },
        });
      }

      return po;
    }, { timeout: 20_000, maxWait: 10_000 });

    const units = order.items.reduce((acc, item) => acc + item.quantity, 0);

    await logActivity(tenant, "Purchase Order Received", `Received stock for PO ${order.orderNumber} in "${order.warehouse.name}".`);
    await notify(storeId, "Stock Received", `Successfully received ${units} items from "${order.supplier.companyName}" in PO ${order.orderNumber}.`, "info");

    revalidatePath("/purchases");
    revalidatePath("/inventory");
    revalidatePath("/dashboard");
    return { orderNumber: order.orderNumber, units };
  });
}

export async function cancelPurchaseOrder(poId: string) {
  return guarded("Could not cancel this purchase order.", async () => {
    const tenant = await requireTenant();
    const claimed = await db.purchaseOrder.updateMany({
      where: { id: poId, storeId: tenant.storeId, status: OrderStatus.PENDING },
      data: { status: OrderStatus.CANCELLED },
    });
    if (claimed.count === 0) {
      throw new UserError("Only pending orders can be cancelled.");
    }

    const order = await db.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, select: { orderNumber: true } });
    await logActivity(tenant, "Purchase Order Cancelled", `${order.orderNumber} was cancelled.`);
    revalidatePath("/purchases");
    return order;
  });
}
