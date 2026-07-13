"use server";

import { db } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";

// Combined Dashboard Stats Action.
//
// One round-trip per resource, everything scoped to the caller's store. Stocks
// are fetched once with only the fields the dashboard needs (the old version
// fetched the full stock table twice, plus every sale row a second time for
// counting).
export async function getDashboardData() {
  const tenant = await requireTenant();
  const storeId = tenant.storeId;

  const [productsCount, stocks, notifications, activities, sales, movements] = await Promise.all([
    db.product.count({ where: { storeId, status: "active" } }),
    db.stock.findMany({
      where: { storeId },
      select: {
        productId: true,
        quantity: true,
        product: { select: { name: true, sku: true, minStockLevel: true } },
      },
    }),
    db.notification.findMany({
      where: { storeId },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    db.activityLog.findMany({
      where: { storeId },
      include: { user: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    db.sale.findMany({
      where: { storeId },
      orderBy: { createdAt: "desc" },
    }),
    db.stockMovement.findMany({
      where: { storeId },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  const totalStockQuantity = stocks.reduce((acc, s) => acc + s.quantity, 0);
  const totalSalesValue = sales.reduce((acc, s) => acc + s.totalAmount, 0);

  const lowStock = stocks
    .filter(s => s.quantity < s.product.minStockLevel)
    .map(s => ({
      productId: s.productId,
      name: s.product.name,
      sku: s.product.sku,
      quantity: s.quantity,
      minStockLevel: s.product.minStockLevel,
    }));

  return {
    productsCount,
    salesCount: sales.length,
    totalStockQuantity,
    totalSalesValue,
    lowStock,
    notifications,
    activities,
    sales,
    movements,
  };
}
