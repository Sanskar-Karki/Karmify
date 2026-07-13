"use server";

import { db } from "@/lib/db";
import { MovementType, OrderStatus, PaymentStatus } from "@prisma/client";
import { requireTenant } from "@/lib/tenant";
import { logActivity, notify, getDefaultWarehouseIdFor } from "@/lib/actions/helpers";
import { revalidatePath } from "next/cache";

// Purchase Orders
export async function getPurchaseOrders() {
  const tenant = await requireTenant();
  return db.purchaseOrder.findMany({
    where: { storeId: tenant.storeId },
    include: {
      supplier: true,
      warehouse: true,
      items: {
        include: {
          product: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function createPurchaseOrder(data: {
  supplierId: string;
  items: { productId: string; quantity: number; unitCost: number }[];
  totalAmount: number;
  notes?: string;
}) {
  const tenant = await requireTenant();
  const storeId = tenant.storeId;
  const warehouseId = await getDefaultWarehouseIdFor(storeId);

  const order = await db.$transaction(async (tx) => {
    // Generate order number PO-YYYYMMDD-XXXX (per store)
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const count = await tx.purchaseOrder.count({
      where: {
        storeId,
        orderNumber: {
          startsWith: `PO-${dateStr}`,
        },
      },
    });
    const seq = String(count + 1).padStart(3, "0");
    const orderNumber = `PO-${dateStr}-${seq}`;

    return tx.purchaseOrder.create({
      data: {
        storeId,
        orderNumber,
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
      include: {
        supplier: true,
        warehouse: true,
      },
    });
  });

  await logActivity(
    tenant,
    "Purchase Order Created",
    `Created purchase order ${order.orderNumber} ($${data.totalAmount.toFixed(2)}) for "${order.supplier.companyName}".`
  );

  revalidatePath("/purchases");
  return order;
}

export async function receivePurchaseOrder(poId: string) {
  const tenant = await requireTenant();
  const storeId = tenant.storeId;

  const order = await db.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({
      where: { id: poId, storeId },
      include: {
        items: {
          include: {
            product: true,
          },
        },
        warehouse: true,
        supplier: true,
      },
    });

    if (!po) throw new Error("Purchase order not found.");
    if (po.status === OrderStatus.COMPLETED) {
      throw new Error("Purchase order has already been received.");
    }

    // Mark PO Completed and Paid
    await tx.purchaseOrder.update({
      where: { id: poId },
      data: {
        status: OrderStatus.COMPLETED,
        paymentStatus: PaymentStatus.PAID,
      },
    });

    // Add stock and record movements
    for (const item of po.items) {
      await tx.stock.upsert({
        where: {
          productId_warehouseId: {
            productId: item.productId,
            warehouseId: po.warehouseId,
          },
        },
        update: { quantity: { increment: item.quantity } },
        create: {
          storeId,
          productId: item.productId,
          warehouseId: po.warehouseId,
          quantity: item.quantity,
        },
      });

      // Record Stock Movement
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

    return po;
  });

  await logActivity(
    tenant,
    "Purchase Order Received",
    `Received stock for PO ${order.orderNumber} in "${order.warehouse.name}".`
  );

  await notify(
    storeId,
    "Stock Received",
    `Successfully received ${order.items.reduce((acc, item) => acc + item.quantity, 0)} items from "${order.supplier.companyName}" in PO ${order.orderNumber}.`,
    "info"
  );

  revalidatePath("/purchases");
  revalidatePath("/inventory");
  revalidatePath("/dashboard");
  return order;
}

export async function cancelPurchaseOrder(poId: string) {
  const tenant = await requireTenant();
  const order = await db.purchaseOrder.update({
    where: { id: poId, storeId: tenant.storeId },
    data: { status: OrderStatus.CANCELLED },
  });
  await logActivity(tenant, "Purchase Order Cancelled", `${order.orderNumber} was cancelled.`);
  revalidatePath("/purchases");
  return order;
}
