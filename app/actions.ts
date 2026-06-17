"use server";

import { db } from "@/lib/db";
import { auth, currentUser } from "@clerk/nextjs/server";
import { Role, MovementType, OrderStatus, PaymentStatus, PaymentMethod, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";

// Sync Clerk user with database
export async function syncUser() {
  const { userId } = await auth();
  if (!userId) return null;

  const existing = await db.user.findUnique({
    where: { id: userId },
  });
  if (existing) return existing;

  try {
    const clerkUser = await currentUser();
    if (!clerkUser) return null;

    const email = clerkUser.emailAddresses[0]?.emailAddress || `clerk_${userId}@karmify.com`;
    const name = `${clerkUser.firstName || ""} ${clerkUser.lastName || ""}`.trim() || "Karmify User";

    const user = await db.user.create({
      data: {
        id: userId,
        email,
        name,
        role: Role.STAFF,
      },
    });
    return user;
  } catch (error) {
    console.error("Error syncing user:", error);
    return null;
  }
}

// Helpers for logging activity and sending notifications
export async function addActivity(action: string, details: string) {
  const user = await syncUser();
  await db.activityLog.create({
    data: {
      action,
      details,
      userId: user?.id || null,
    },
  });
}

export async function addNotification(title: string, message: string, type: "info" | "warning" | "error") {
  await db.notification.create({
    data: {
      title,
      message,
      type,
    },
  });
}

// Categories
export async function getCategories() {
  return db.category.findMany({
    orderBy: { name: "asc" },
  });
}

export async function saveCategory(name: string, description?: string) {
  const category = await db.category.upsert({
    where: { name },
    update: { description },
    create: { name, description },
  });
  await addActivity("Category Saved", `Category "${name}" created or updated.`);
  revalidatePath("/products");
  return category;
}

// Suppliers
export async function getSuppliers() {
  return db.supplier.findMany({
    orderBy: { companyName: "asc" },
  });
}

export async function saveSupplier(form: {
  companyName: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  notes?: string;
}, editingId?: string | null) {
  let supplier;
  if (editingId) {
    supplier = await db.supplier.update({
      where: { id: editingId },
      data: form,
    });
    await addActivity("Supplier Updated", `Supplier "${form.companyName}" was edited.`);
  } else {
    supplier = await db.supplier.create({
      data: form,
    });
    await addActivity("Supplier Created", `Supplier "${form.companyName}" was added.`);
  }
  revalidatePath("/settings");
  return supplier;
}

export async function deleteSupplier(id: string) {
  const supplier = await db.supplier.delete({
    where: { id },
  });
  await addActivity("Supplier Deleted", `Supplier "${supplier.companyName}" was deleted.`);
  revalidatePath("/settings");
  return supplier;
}

// Warehouses
export async function getWarehouses() {
  return db.warehouse.findMany({
    orderBy: { name: "asc" },
  });
}

export async function saveWarehouse(form: {
  name: string;
  location: string;
  description?: string;
}, editingId?: string | null) {
  let warehouse: Awaited<ReturnType<typeof db.warehouse.create>>;
  if (editingId) {
    warehouse = await db.warehouse.update({
      where: { id: editingId },
      data: form,
    });
    await addActivity("Warehouse Updated", `Warehouse "${form.name}" was edited.`);
  } else {
    warehouse = await db.warehouse.create({
      data: form,
    });
    await addActivity("Warehouse Created", `Warehouse "${form.name}" was created.`);
    
    // Auto-create stock records for existing products in this new warehouse
    const products = await db.product.findMany();
    if (products.length > 0) {
      await db.stock.createMany({
        data: products.map(p => ({
          productId: p.id,
          warehouseId: warehouse.id,
          quantity: 0,
        })),
        skipDuplicates: true,
      });
    }
  }
  revalidatePath("/settings");
  return warehouse;
}

export async function deleteWarehouse(id: string) {
  const warehouse = await db.warehouse.delete({
    where: { id },
  });
  await addActivity("Warehouse Deleted", `Warehouse "${warehouse.name}" was deleted.`);
  revalidatePath("/settings");
  return warehouse;
}

// Products
export async function getProducts() {
  return db.product.findMany({
    include: {
      category: true,
      supplier: true,
    },
    orderBy: { name: "asc" },
  });
}

export async function saveProduct(form: {
  name: string;
  sku: string;
  barcode?: string;
  description?: string;
  brand?: string;
  categoryId: string;
  supplierId: string;
  costPrice: number;
  sellingPrice: number;
  minStockLevel: number;
  status: string;
}, editingId?: string | null) {
  let product: Awaited<ReturnType<typeof db.product.create>>;
  if (editingId) {
    product = await db.product.update({
      where: { id: editingId },
      data: form,
    });
    await addActivity("Product Updated", `SKU ${form.sku} – "${form.name}" was edited.`);
  } else {
    product = await db.product.create({
      data: form,
    });
    await addActivity("Product Created", `New SKU ${form.sku} – "${form.name}" added to catalog.`);

    // Initialize stock of 0 in all warehouses for the new product
    const warehouses = await db.warehouse.findMany();
    if (warehouses.length > 0) {
      await db.stock.createMany({
        data: warehouses.map(w => ({
          productId: product.id,
          warehouseId: w.id,
          quantity: 0,
        })),
      });
    }
  }
  revalidatePath("/products");
  revalidatePath("/inventory");
  return product;
}

export async function deleteProduct(id: string) {
  const product = await db.product.delete({
    where: { id },
  });
  await addActivity("Product Deleted", `SKU ${product.sku} – "${product.name}" removed from catalog.`);
  revalidatePath("/products");
  revalidatePath("/inventory");
  return product;
}

// Stocks
export async function getStocks() {
  return db.stock.findMany({
    include: {
      product: true,
      warehouse: true,
    },
  });
}

export async function adjustStock(data: {
  productId: string;
  warehouseId: string;
  quantity: number; // The new quantity target
  notes?: string;
}) {
  const user = await syncUser();
  
  // Find current stock
  const currentStock = await db.stock.findUnique({
    where: {
      productId_warehouseId: {
        productId: data.productId,
        warehouseId: data.warehouseId,
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
        warehouseId: data.warehouseId,
      },
    },
    update: { quantity: data.quantity },
    create: {
      productId: data.productId,
      warehouseId: data.warehouseId,
      quantity: data.quantity,
    },
    include: { product: true, warehouse: true },
  });

  // Record stock movement
  await db.stockMovement.create({
    data: {
      productId: data.productId,
      quantity: Math.abs(difference),
      type: MovementType.ADJUSTMENT,
      sourceWhId: difference < 0 ? data.warehouseId : null,
      destWhId: difference > 0 ? data.warehouseId : null,
      notes: data.notes || `Stock adjustment from ${oldQty} to ${data.quantity}`,
      userId: user?.id || null,
    },
  });

  await addActivity(
    "Stock Adjusted",
    `Adjusted stock of "${stock.product.name}" in "${stock.warehouse.name}" to ${data.quantity} (change of ${difference > 0 ? "+" : ""}${difference}).`
  );

  // Check low stock
  if (data.quantity < stock.product.minStockLevel) {
    await addNotification(
      "Low Stock Alert",
      `Stock of "${stock.product.name}" in "${stock.warehouse.name}" is low (${data.quantity} units left).`,
      "warning"
    );
  }

  revalidatePath("/inventory");
  revalidatePath("/dashboard");
  return stock;
}

// Record a stock movement of any type (Stock In/Out, Damaged, Returned, Adjustment, Transfer)
export async function recordStockMovement(data: {
  productId: string;
  type: MovementType;
  sourceWhId?: string;
  destWhId?: string;
  quantity: number;
  notes?: string;
}) {
  const user = await syncUser();

  async function applyDelta(tx: Prisma.TransactionClient, warehouseId: string, delta: number) {
    const stock = await tx.stock.upsert({
      where: { productId_warehouseId: { productId: data.productId, warehouseId } },
      update: { quantity: { increment: delta } },
      create: { productId: data.productId, warehouseId, quantity: Math.max(0, delta) },
      include: { product: true, warehouse: true },
    });
    if (stock.quantity < stock.product.minStockLevel) {
      await addNotification(
        "Low Stock Alert",
        `Stock of "${stock.product.name}" in "${stock.warehouse.name}" is low (${stock.quantity} units left).`,
        "warning"
      );
    }
    return stock;
  }

  await db.$transaction(async (tx) => {
    if (data.type === MovementType.STOCK_IN && data.destWhId) await applyDelta(tx, data.destWhId, data.quantity);
    if (data.type === MovementType.STOCK_OUT && data.sourceWhId) await applyDelta(tx, data.sourceWhId, -data.quantity);
    if (data.type === MovementType.DAMAGED && data.sourceWhId) await applyDelta(tx, data.sourceWhId, -data.quantity);
    if (data.type === MovementType.RETURNED && data.destWhId) await applyDelta(tx, data.destWhId, data.quantity);
    if (data.type === MovementType.ADJUSTMENT && data.destWhId) await applyDelta(tx, data.destWhId, data.quantity);
    if (data.type === MovementType.TRANSFER && data.sourceWhId && data.destWhId) {
      await applyDelta(tx, data.sourceWhId, -data.quantity);
      await applyDelta(tx, data.destWhId, data.quantity);
    }

    await tx.stockMovement.create({
      data: {
        productId: data.productId,
        quantity: data.quantity,
        type: data.type,
        sourceWhId: data.sourceWhId || null,
        destWhId: data.destWhId || null,
        notes: data.notes || null,
        userId: user?.id || null,
      },
    });
  });

  const product = await db.product.findUnique({ where: { id: data.productId } });
  await addActivity("Stock Movement Recorded", `${data.type.replace("_", " ")} — ${data.quantity}x "${product?.name}" logged.`);

  revalidatePath("/inventory");
  revalidatePath("/dashboard");
}

export async function transferStock(data: {
  productId: string;
  sourceWhId: string;
  destWhId: string;
  quantity: number;
  notes?: string;
}) {
  const user = await syncUser();

  // Deduct from source
  const sourceStock = await db.stock.findUnique({
    where: {
      productId_warehouseId: {
        productId: data.productId,
        warehouseId: data.sourceWhId,
      },
    },
    include: { product: true, warehouse: true },
  });

  if (!sourceStock || sourceStock.quantity < data.quantity) {
    throw new Error("Insufficient stock in source warehouse.");
  }

  await db.stock.update({
    where: { id: sourceStock.id },
    data: { quantity: { decrement: data.quantity } },
  });

  // Add to destination
  const destStock = await db.stock.upsert({
    where: {
      productId_warehouseId: {
        productId: data.productId,
        warehouseId: data.destWhId,
      },
    },
    update: { quantity: { increment: data.quantity } },
    create: {
      productId: data.productId,
      warehouseId: data.destWhId,
      quantity: data.quantity,
    },
    include: { warehouse: true },
  });

  // Record Stock Movement
  await db.stockMovement.create({
    data: {
      productId: data.productId,
      quantity: data.quantity,
      type: MovementType.TRANSFER,
      sourceWhId: data.sourceWhId,
      destWhId: data.destWhId,
      notes: data.notes || `Stock transfer of ${data.quantity} units.`,
      userId: user?.id || null,
    },
  });

  await addActivity(
    "Stock Transferred",
    `Transferred ${data.quantity} units of "${sourceStock.product.name}" from "${sourceStock.warehouse.name}" to "${destStock.warehouse.name}".`
  );

  // Check low stock on source
  const updatedSourceQty = sourceStock.quantity - data.quantity;
  if (updatedSourceQty < sourceStock.product.minStockLevel) {
    await addNotification(
      "Low Stock Alert",
      `Stock of "${sourceStock.product.name}" in "${sourceStock.warehouse.name}" is low (${updatedSourceQty} units left).`,
      "warning"
    );
  }

  revalidatePath("/inventory");
  revalidatePath("/dashboard");
}

// Sales
export async function getSales() {
  return db.sale.findMany({
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
  const sales = await db.sale.findMany({
    where: { OR: [{ customerEmail: { not: null } }, { customerName: { not: null } }] },
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
  await db.sale.updateMany({
    where: { id: { in: saleIds } },
    data: {
      customerName: data.name || null,
      customerPhone: data.phone || null,
      customerAddress: data.address || null,
    },
  });
  revalidatePath("/customers");
}

export async function createSale(data: {
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  warehouseId: string;
  items: { productId: string; quantity: number; unitPrice: number }[];
  discount: number;
  totalAmount: number;
  paymentMethod: PaymentMethod;
}) {
  const user = await syncUser();
  const paymentStatus: PaymentStatus = data.paymentMethod === PaymentMethod.QR ? "PAID" : "UNPAID";

  // Create Sale transaction
  const sale = await db.$transaction(async (tx) => {
    // Generate invoice number: INV-YYYYMMDD-XXXX
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const count = await tx.sale.count({
      where: {
        invoiceNumber: {
          startsWith: `INV-${dateStr}`,
        },
      },
    });
    const seq = String(count + 1).padStart(3, "0");
    const invoiceNumber = `INV-${dateStr}-${seq}`;

    const newSale = await tx.sale.create({
      data: {
        invoiceNumber,
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        customerAddress: data.customerAddress,
        warehouseId: data.warehouseId,
        discount: data.discount,
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
            warehouseId: data.warehouseId,
          },
        },
        include: { product: true },
      });

      if (!stock || stock.quantity < item.quantity) {
        throw new Error(`Insufficient stock for product id: ${item.productId}`);
      }

      await tx.stock.update({
        where: { id: stock.id },
        data: { quantity: { decrement: item.quantity } },
      });

      // Record movement
      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          quantity: item.quantity,
          type: MovementType.STOCK_OUT,
          sourceWhId: data.warehouseId,
          referenceId: newSale.id,
          notes: `POS Sale invoice ${invoiceNumber}`,
          userId: user?.id || null,
        },
      });

      // Check low stock alert
      const updatedQty = stock.quantity - item.quantity;
      if (updatedQty < stock.product.minStockLevel) {
        await tx.notification.create({
          data: {
            title: "Low Stock Alert",
            message: `Stock of "${stock.product.name}" in "${newSale.warehouse.name}" is low (${updatedQty} units left).`,
            type: "warning",
          },
        });
      }
    }

    return newSale;
  });

  await addActivity(
    "POS Sale Created",
    `Completed sale ${sale.invoiceNumber} ($${data.totalAmount.toFixed(2)}) from "${sale.warehouse.name}".`
  );

  revalidatePath("/sales");
  revalidatePath("/inventory");
  revalidatePath("/dashboard");
  return sale;
}

// Purchase Orders
export async function getPurchaseOrders() {
  return db.purchaseOrder.findMany({
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
  warehouseId: string;
  items: { productId: string; quantity: number; unitCost: number }[];
  totalAmount: number;
  notes?: string;
}) {
  const order = await db.$transaction(async (tx) => {
    // Generate order number PO-YYYYMMDD-XXXX
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const count = await tx.purchaseOrder.count({
      where: {
        orderNumber: {
          startsWith: `PO-${dateStr}`,
        },
      },
    });
    const seq = String(count + 1).padStart(3, "0");
    const orderNumber = `PO-${dateStr}-${seq}`;

    return tx.purchaseOrder.create({
      data: {
        orderNumber,
        supplierId: data.supplierId,
        warehouseId: data.warehouseId,
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

  await addActivity(
    "Purchase Order Created",
    `Created purchase order ${order.orderNumber} ($${data.totalAmount.toFixed(2)}) for "${order.supplier.companyName}".`
  );

  revalidatePath("/purchases");
  return order;
}

export async function receivePurchaseOrder(poId: string) {
  const user = await syncUser();

  const order = await db.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({
      where: { id: poId },
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
    const updatedPo = await tx.purchaseOrder.update({
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
          productId: item.productId,
          warehouseId: po.warehouseId,
          quantity: item.quantity,
        },
      });

      // Record Stock Movement
      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          quantity: item.quantity,
          type: MovementType.STOCK_IN,
          destWhId: po.warehouseId,
          referenceId: po.id,
          notes: `Received PO ${po.orderNumber} from ${po.supplier.companyName}`,
          userId: user?.id || null,
        },
      });
    }

    return po;
  });

  await addActivity(
    "Purchase Order Received",
    `Received stock for PO ${order.orderNumber} in "${order.warehouse.name}".`
  );

  await addNotification(
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
  const order = await db.purchaseOrder.update({
    where: { id: poId },
    data: { status: OrderStatus.CANCELLED },
  });
  await addActivity("Purchase Order Cancelled", `${order.orderNumber} was cancelled.`);
  revalidatePath("/purchases");
  return order;
}

// Stock Movements
export async function getStockMovements() {
  return db.stockMovement.findMany({
    include: {
      product: true,
      sourceWarehouse: true,
      destWarehouse: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

// Notifications
export async function getNotifications() {
  return db.notification.findMany({
    orderBy: { createdAt: "desc" },
  });
}

export async function markNotificationRead(id: string) {
  const notification = await db.notification.update({
    where: { id },
    data: { isRead: true },
  });
  revalidatePath("/dashboard");
  return notification;
}

export async function markAllNotificationsRead() {
  await db.notification.updateMany({
    where: { isRead: false },
    data: { isRead: true },
  });
  revalidatePath("/dashboard");
}

// Activity Logs
export async function getActivityLogs() {
  return db.activityLog.findMany({
    include: {
      user: true,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

// Combined Dashboard Stats Action
export async function getDashboardData() {
  const [
    productsCount,
    salesCount,
    lowStockItems,
    notifications,
    activities,
    sales,
    stocks,
    movements,
  ] = await Promise.all([
    db.product.count({ where: { status: "active" } }),
    db.sale.count(),
    db.stock.findMany({
      include: { product: true, warehouse: true },
    }),
    db.notification.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    db.activityLog.findMany({
      include: { user: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    db.sale.findMany({
      orderBy: { createdAt: "desc" },
    }),
    db.stock.findMany(),
    db.stockMovement.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  // Calculate stats
  const totalStockQuantity = stocks.reduce((acc, s) => acc + s.quantity, 0);
  const totalSalesValue = sales.reduce((acc, s) => acc + s.totalAmount, 0);

  // Group low stock
  const lowStock = lowStockItems
    .map(s => ({
      productId: s.productId,
      name: s.product.name,
      sku: s.product.sku,
      warehouseName: s.warehouse.name,
      quantity: s.quantity,
      minStockLevel: s.product.minStockLevel,
    }))
    .filter(s => s.quantity < s.minStockLevel);

  return {
    productsCount,
    salesCount,
    totalStockQuantity,
    totalSalesValue,
    lowStock,
    notifications,
    activities,
    sales,
    movements,
  };
}
