"use server";

import { db } from "@/lib/db";
import { MovementType } from "@prisma/client";
import { requireTenant } from "@/lib/tenant";
import { getDefaultWarehouseIdFor, logActivity, notify } from "@/lib/actions/helpers";
import { guarded, UserError } from "@/lib/actions/result";
import { revalidatePath } from "next/cache";

export async function adjustStock(data: {
  productId: string;
  quantity: number; // The new quantity target
  notes?: string;
}) {
  return guarded("Could not adjust this stock level.", async () => {
    if (!Number.isInteger(data.quantity) || data.quantity < 0) {
      throw new UserError("Stock must be a whole number of 0 or more.");
    }

    const tenant = await requireTenant();
    const storeId = tenant.storeId;
    const warehouseId = await getDefaultWarehouseIdFor(storeId);

    const product = await db.product.findFirst({
      where: { id: data.productId, storeId },
      select: { name: true, minStockLevel: true, _count: { select: { variants: true } } },
    });
    if (!product) throw new UserError("That product no longer exists. Refresh and try again.");
    if (product._count.variants > 0) throw new UserError("This product has sizes. Change its stock per size in Products → Edit.");

    const change = await db.$transaction(async (tx) => {
      const current = await tx.stock.findUnique({
        where: { productId_warehouseId: { productId: data.productId, warehouseId } },
        select: { quantity: true },
      });
      const oldQty = current?.quantity ?? 0;
      const difference = data.quantity - oldQty;
      if (difference === 0) return 0;

      await tx.stock.upsert({
        where: { productId_warehouseId: { productId: data.productId, warehouseId } },
        update: { quantity: data.quantity },
        create: { storeId, productId: data.productId, warehouseId, quantity: data.quantity },
      });
      await tx.stockMovement.create({
        data: {
          storeId,
          productId: data.productId,
          quantity: Math.abs(difference),
          type: MovementType.ADJUSTMENT,
          sourceWhId: difference < 0 ? warehouseId : null,
          destWhId: difference > 0 ? warehouseId : null,
          notes: data.notes || `Stock adjustment from ${oldQty} to ${data.quantity}`,
          userId: tenant.userId,
        },
      });
      return difference;
    });

    if (change === 0) return { change };

    await logActivity(tenant, "Stock Adjusted", `Adjusted stock of "${product.name}" to ${data.quantity} (change of ${change > 0 ? "+" : ""}${change}).`);

    if (data.quantity < product.minStockLevel) {
      await notify(storeId, "Low Stock Alert", `Stock of "${product.name}" is low (${data.quantity} units left).`, "warning");
    }

    revalidatePath("/inventory");
    revalidatePath("/dashboard");
    return { change };
  });
}

// Record a stock movement of any type (Stock In/Out, Damaged, Returned, Adjustment)
export async function recordStockMovement(data: {
  productId: string;
  type: "STOCK_IN" | "STOCK_OUT" | "DAMAGED" | "RETURNED" | "ADJUSTMENT";
  quantity: number;
  notes?: string;
}) {
  return guarded("Could not record this stock movement.", async () => {
    if (!Number.isInteger(data.quantity) || data.quantity <= 0) {
      throw new UserError("Quantity must be a whole number greater than 0.");
    }

    const tenant = await requireTenant();
    const storeId = tenant.storeId;

    const product = await db.product.findFirst({
      where: { id: data.productId, storeId },
      select: { name: true, minStockLevel: true, _count: { select: { variants: true } } },
    });
    if (!product) throw new UserError("That product no longer exists. Refresh and try again.");
    if (product._count.variants > 0) throw new UserError("This product has sizes. Change its stock per size in Products → Edit.");

    const warehouseId = await getDefaultWarehouseIdFor(storeId);
    const outgoing = data.type === MovementType.STOCK_OUT || data.type === MovementType.DAMAGED;

    await db.$transaction(async (tx) => {
      if (outgoing) {
        // Checking availability in the same statement keeps stock from going
        // negative when two people record a removal at the same time.
        const deducted = await tx.stock.updateMany({
          where: { storeId, productId: data.productId, warehouseId, quantity: { gte: data.quantity } },
          data: { quantity: { decrement: data.quantity } },
        });
        if (deducted.count === 0) throw new UserError(`Not enough stock of "${product.name}" for this movement.`);
      } else {
        await tx.stock.upsert({
          where: { productId_warehouseId: { productId: data.productId, warehouseId } },
          update: { quantity: { increment: data.quantity } },
          create: { storeId, productId: data.productId, warehouseId, quantity: data.quantity },
        });
      }

      const { quantity } = await tx.stock.findUniqueOrThrow({
        where: { productId_warehouseId: { productId: data.productId, warehouseId } },
        select: { quantity: true },
      });
      if (quantity < product.minStockLevel) {
        await tx.notification.create({
          data: {
            storeId,
            title: "Low Stock Alert",
            message: `Stock of "${product.name}" is low (${quantity} units left).`,
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
    });

    await logActivity(tenant, "Stock Movement Recorded", `${data.type.replace("_", " ")} — ${data.quantity}x "${product.name}" logged.`);

    revalidatePath("/inventory");
    revalidatePath("/dashboard");
  });
}
