import "server-only";

import { db } from "@/lib/db";

// Read models for the dashboard. They take an already-resolved storeId, so one
// batched load pays for a single auth/tenant lookup, and they select only the
// relations the UI renders to keep the response small.

export function getCategories(storeId: string) {
  return db.category.findMany({ where: { storeId }, orderBy: { name: "asc" } });
}

export function getSuppliers(storeId: string) {
  return db.supplier.findMany({ where: { storeId }, orderBy: { companyName: "asc" } });
}

export function getProducts(storeId: string) {
  return db.product.findMany({
    where: { storeId },
    orderBy: { name: "asc" },
    // Stock per size and colour, for clothing.
    include: { variants: { select: { id: true, size: true, color: true, quantity: true, lowStockIgnoredQty: true }, orderBy: [{ size: "asc" }, { color: "asc" }] } },
  });
}

export function getStocks(storeId: string) {
  return db.stock.findMany({
    where: { storeId },
    select: { id: true, productId: true, warehouseId: true, quantity: true },
  });
}

export function getStockMovements(storeId: string) {
  return db.stockMovement.findMany({
    where: { storeId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

// Every order is sent to the browser, so each field per line adds up quickly.
const saleInclude = {
  customer: { select: { code: true } },
  warehouse: { select: { name: true } },
  items: { select: { id: true, productId: true, quantity: true, returnedQty: true, unitPrice: true, variant: true, product: { select: { name: true, sku: true } } } },
} as const;

/**
 * Orders booked with Upaya before the send time was saved (courierBookedAt) get
 * it once, from their "Sent To Upaya" activity entry (the latest, if booked more
 * than once), or their order date when there is none. Analytics counts
 * "Sent with Upaya" by that day. Cheap when there is nothing to fill in.
 */
async function fillCourierBookedAt(storeId: string) {
  const missing = await db.sale.findMany({
    where: { storeId, courierTrackingCode: { not: null }, courierBookedAt: null },
    select: { id: true, invoiceNumber: true, createdAt: true },
    take: 500,
  });
  if (missing.length === 0) return;
  const logs = await db.activityLog.findMany({
    where: { storeId, action: "Sent To Upaya", OR: missing.map(s => ({ details: { startsWith: `${s.invoiceNumber} ` } })) },
    select: { details: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const sentAt = new Map<string, Date>();
  for (const log of logs) sentAt.set(log.details.split(" ")[0], log.createdAt);
  await db.$transaction(missing.map(s => db.sale.update({ where: { id: s.id }, data: { courierBookedAt: sentAt.get(s.invoiceNumber) ?? s.createdAt } })));
}

export async function getSales(storeId: string) {
  await fillCourierBookedAt(storeId).catch(err => console.error("[sales] could not fill Upaya send dates", err));
  return db.sale.findMany({
    where: { storeId },
    include: saleInclude,
    orderBy: { createdAt: "desc" },
  });
}

export function getPurchaseOrders(storeId: string) {
  return db.purchaseOrder.findMany({
    where: { storeId },
    include: {
      supplier: { select: { companyName: true } },
      items: { include: { product: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export function getNotifications(storeId: string) {
  return db.notification.findMany({
    where: { storeId },
    orderBy: { createdAt: "desc" },
    take: 60,
  });
}

export function getActivityLogs(storeId: string) {
  return db.activityLog.findMany({
    where: { storeId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}
