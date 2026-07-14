"use server";

import { db } from "@/lib/db";
import { MovementType, PaymentMethod, PaymentStatus, DeliveryStatus } from "@prisma/client";
import { requireTenant } from "@/lib/tenant";
import { logActivity } from "@/lib/actions/helpers";
import { getDefaultWarehouseIdFor } from "@/lib/actions/helpers";
import { revalidatePath } from "next/cache";

// Sales
export async function getSales() {
  const tenant = await requireTenant();
  return db.sale.findMany({
    where: { storeId: tenant.storeId },
    include: {
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

export async function getCustomers() {
  const tenant = await requireTenant();
  const sales = await db.sale.findMany({
    where: {
      storeId: tenant.storeId,
      OR: [{ customerEmail: { not: null } }, { customerName: { not: null } }],
    },
    include: {
      warehouse: true,
      items: { include: { product: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const customers = new Map<
    string,
    {
      key: string;
      name: string;
      email: string | null;
      phone: string | null;
      address: string | null;
      orderCount: number;
      totalSpent: number;
      lastOrderAt: Date;
      sales: typeof sales;
    }
  >();

  for (const sale of sales) {
    const key = (sale.customerEmail || sale.customerPhone || sale.customerName || "unknown").toLowerCase();
    const existing = customers.get(key);
    if (existing) {
      existing.orderCount += 1;
      existing.totalSpent += sale.totalAmount;
      existing.sales.push(sale);
      if (sale.createdAt > existing.lastOrderAt) existing.lastOrderAt = sale.createdAt;
      if (!existing.email && sale.customerEmail) existing.email = sale.customerEmail;
      if (!existing.phone && sale.customerPhone) existing.phone = sale.customerPhone;
      if (!existing.address && sale.customerAddress) existing.address = sale.customerAddress;
      if (existing.name === "Walk-in Customer" && sale.customerName) existing.name = sale.customerName;
    } else {
      customers.set(key, {
        key,
        name: sale.customerName || "Walk-in Customer",
        email: sale.customerEmail || null,
        phone: sale.customerPhone || null,
        address: sale.customerAddress || null,
        orderCount: 1,
        totalSpent: sale.totalAmount,
        lastOrderAt: sale.createdAt,
        sales: [sale],
      });
    }
  }

  return Array.from(customers.values()).sort((a, b) => b.lastOrderAt.getTime() - a.lastOrderAt.getTime());
}

export async function updateCustomerInfo(saleIds: string[], data: { name?: string; phone?: string; address?: string }) {
  const tenant = await requireTenant();
  await db.sale.updateMany({
    where: { id: { in: saleIds }, storeId: tenant.storeId },
    data: {
      customerName: data.name || null,
      customerPhone: data.phone || null,
      customerAddress: data.address || null,
    },
  });
  revalidatePath("/customers");
}

export async function deleteSales(saleIds: string[]) {
  const tenant = await requireTenant();
  if (saleIds.length === 0) return { deleted: 0 };

  const result = await db.$transaction(async (tx) => {
    await tx.saleItem.deleteMany({
      where: { saleId: { in: saleIds }, sale: { storeId: tenant.storeId } },
    });
    return tx.sale.deleteMany({
      where: { id: { in: saleIds }, storeId: tenant.storeId },
    });
  });

  await logActivity(
    tenant,
    "Orders Deleted",
    `Deleted ${result.count} order(s).`
  );

  revalidatePath("/customers");
  revalidatePath("/sales");
  revalidatePath("/dashboard");
  return { deleted: result.count };
}

export async function updateSaleDetails(saleId: string, data: { totalAmount?: number; customerName?: string; customerPhone?: string; customerAddress?: string; deliveryStatus?: DeliveryStatus; deliveryAmount?: number; codAmount?: number; paymentMethod?: PaymentMethod }) {
  const tenant = await requireTenant();
  await db.sale.update({
    where: { id: saleId, storeId: tenant.storeId },
    data: {
      ...(data.totalAmount !== undefined && { totalAmount: data.totalAmount }),
      ...(data.customerName !== undefined && { customerName: data.customerName || null }),
      ...(data.customerPhone !== undefined && { customerPhone: data.customerPhone || null }),
      ...(data.customerAddress !== undefined && { customerAddress: data.customerAddress || null }),
      ...(data.deliveryStatus !== undefined && { deliveryStatus: data.deliveryStatus }),
      ...(data.deliveryAmount !== undefined && { deliveryAmount: data.deliveryAmount }),
      ...(data.paymentMethod !== undefined && { paymentMethod: data.paymentMethod }),
      ...(data.codAmount !== undefined && { codAmount: data.codAmount }),
    },
  });
  revalidatePath("/customers");
  revalidatePath("/sales");
}

export async function createSale(data: {
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  items: { productId: string; quantity: number; unitPrice: number }[];
  discount: number;
  deliveryAmount: number;
  codAmount: number;
  totalAmount: number;
  paymentMethod: PaymentMethod;
}) {
  const tenant = await requireTenant();
  const storeId = tenant.storeId;
  const warehouseId = await getDefaultWarehouseIdFor(storeId);
  const paymentStatus: PaymentStatus = data.paymentMethod === PaymentMethod.QR ? "PAID" : "UNPAID";

  // Create Sale transaction
  const sale = await db.$transaction(async (tx) => {
    // Generate invoice number: INV-YYYYMMDD-XXXX (per store)
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const count = await tx.sale.count({
      where: {
        storeId,
        invoiceNumber: {
          startsWith: `INV-${dateStr}`,
        },
      },
    });
    const seq = String(count + 1).padStart(3, "0");
    const invoiceNumber = `INV-${dateStr}-${seq}`;

    const newSale = await tx.sale.create({
      data: {
        storeId,
        invoiceNumber,
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        customerAddress: data.customerAddress,
        warehouseId,
        discount: data.discount,
        deliveryAmount: data.deliveryAmount,
        codAmount: data.codAmount,
        totalAmount: data.totalAmount,
        paymentStatus,
        paymentMethod: data.paymentMethod,
        items: {
          create: data.items.map(item => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          })),
        },
      },
      include: {
        items: {
          include: {
            product: true,
          },
        },
        warehouse: true,
      },
    });

    // Deduct stock and record movements
    for (const item of data.items) {
      const stock = await tx.stock.findUnique({
        where: {
          productId_warehouseId: {
            productId: item.productId,
            warehouseId,
          },
        },
        include: { product: true },
      });

      if (!stock || stock.storeId !== storeId || stock.quantity < item.quantity) {
        throw new Error(`Insufficient stock for product id: ${item.productId}`);
      }

      await tx.stock.update({
        where: { id: stock.id },
        data: { quantity: { decrement: item.quantity } },
      });

      // Record movement
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

      // Check low stock alert
      const updatedQty = stock.quantity - item.quantity;
      if (updatedQty < stock.product.minStockLevel) {
        await tx.notification.create({
          data: {
            storeId,
            title: "Low Stock Alert",
            message: `Stock of "${stock.product.name}" is low (${updatedQty} units left).`,
            type: "warning",
          },
        });
      }
    }

    return newSale;
  });

  await logActivity(
    tenant,
    "POS Sale Created",
    `Completed sale ${sale.invoiceNumber} ($${data.totalAmount.toFixed(2)}).`
  );

  revalidatePath("/sales");
  revalidatePath("/inventory");
  revalidatePath("/dashboard");
  return sale;
}
