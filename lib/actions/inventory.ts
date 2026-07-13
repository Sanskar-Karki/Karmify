"use server";

import { db } from "@/lib/db";
import { MovementType, Prisma } from "@prisma/client";
import { requireTenant } from "@/lib/tenant";
import { logActivity, notify, getDefaultWarehouseIdFor } from "@/lib/actions/helpers";
import { revalidatePath } from "next/cache";

// Stocks
export async function getStocks() {
  const tenant = await requireTenant();
  return db.stock.findMany({
    where: { storeId: tenant.storeId },
    include: {
      product: true,
      warehouse: true,
    },
  });
}

export async function adjustStock(data: {
  productId: string;
  quantity: number; // The new quantity target
  notes?: string;
}) {
  const tenant = await requireTenant();
  const warehouseId = await getDefaultWarehouseIdFor(tenant.storeId);

  // Find current stock
  const currentStock = await db.stock.findUnique({
    where: {
      productId_warehouseId: {
        productId: data.productId,
        warehouseId,
      },
    },
  });

  const oldQty = currentStock?.quantity || 0;
  const difference = data.quantity - oldQty;

  if (difference === 0) return currentStock;

  const stock = await db.stock.upsert({
    where: {
      productId_warehouseId: {
        productId: data.productId,
        warehouseId,
      },
    },
    update: { quantity: data.quantity },
    create: {
      storeId: tenant.storeId,
      productId: data.productId,
      warehouseId,
      quantity: data.quantity,
    },
    include: { product: true, warehouse: true },
  });

  // Record stock movement
  await db.stockMovement.create({
    data: {
      storeId: tenant.storeId,
      productId: data.productId,
      quantity: Math.abs(difference),
      type: MovementType.ADJUSTMENT,
      sourceWhId: difference < 0 ? warehouseId : null,
      destWhId: difference > 0 ? warehouseId : null,
      notes: data.notes || `Stock adjustment from ${oldQty} to ${data.quantity}`,
      userId: tenant.userId,
    },
  });

  await logActivity(
    tenant,
    "Stock Adjusted",
    `Adjusted stock of "${stock.product.name}" to ${data.quantity} (change of ${difference > 0 ? "+" : ""}${difference}).`
  );

  // Check low stock
  if (data.quantity < stock.product.minStockLevel) {
    await notify(
      tenant.storeId,
      "Low Stock Alert",
      `Stock of "${stock.product.name}" is low (${data.quantity} units left).`,
      "warning"
    );
  }

  revalidatePath("/inventory");
  revalidatePath("/dashboard");
  return stock;
}

// Record a stock movement of any type (Stock In/Out, Damaged, Returned, Adjustment)
export async function recordStockMovement(data: {
  productId: string;
  type: "STOCK_IN" | "STOCK_OUT" | "DAMAGED" | "RETURNED" | "ADJUSTMENT";
  quantity: number;
  notes?: string;
}) {
  const tenant = await requireTenant();
  const storeId = tenant.storeId;
  const warehouseId = await getDefaultWarehouseIdFor(storeId);

  const outgoing = data.type === MovementType.STOCK_OUT || data.type === MovementType.DAMAGED;
  const delta = outgoing ? -data.quantity : data.quantity;

  const stock = await db.$transaction(async (tx) => {
    const updated = await tx.stock.upsert({
      where: { productId_warehouseId: { productId: data.productId, warehouseId } },
      update: { quantity: { increment: delta } },
      create: { storeId, productId: data.productId, warehouseId, quantity: Math.max(0, delta) },
      include: { product: true },
    });

    if (updated.quantity < updated.product.minStockLevel) {
      await tx.notification.create({
        data: {
          storeId,
          title: "Low Stock Alert",
          message: `Stock of "${updated.product.name}" is low (${updated.quantity} units left).`,
          type: "warning",
        },
      });
    }

    await tx.stockMovement.create({
      data: {
        storeId,
        productId: data.productId,
        quantity: data.quantity,
        type: data.type,
        sourceWhId: outgoing ? warehouseId : null,
        destWhId: outgoing ? null : warehouseId,
        notes: data.notes || null,
        userId: tenant.userId,
      },
    });

    return updated;
  });

  await logActivity(tenant, "Stock Movement Recorded", `${data.type.replace("_", " ")} — ${data.quantity}x "${stock.product.name}" logged.`);

  revalidatePath("/inventory");
  revalidatePath("/dashboard");
}

// Stock Movements
export async function getStockMovements() {
  const tenant = await requireTenant();
  return db.stockMovement.findMany({
    where: { storeId: tenant.storeId },
    include: {
      product: true,
      sourceWarehouse: true,
      destWarehouse: true,
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}
