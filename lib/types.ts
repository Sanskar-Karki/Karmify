import type {
  getActivityLogs, getCategories, getProducts, getPurchaseOrders,
  getNotifications, getSales, getStockMovements, getStocks, getSuppliers,
} from "@/lib/queries";

export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; message: string };

/** Every list the dashboard can load, keyed by its cache name. */
export type ResourceData = {
  products: Awaited<ReturnType<typeof getProducts>>;
  categories: Awaited<ReturnType<typeof getCategories>>;
  suppliers: Awaited<ReturnType<typeof getSuppliers>>;
  stocks: Awaited<ReturnType<typeof getStocks>>;
  sales: Awaited<ReturnType<typeof getSales>>;
  movements: Awaited<ReturnType<typeof getStockMovements>>;
  orders: Awaited<ReturnType<typeof getPurchaseOrders>>;
  activities: Awaited<ReturnType<typeof getActivityLogs>>;
  notifications: Awaited<ReturnType<typeof getNotifications>>;
};

export type ResourceKey = keyof ResourceData;
export type ResourceBatch = { [K in ResourceKey]?: ActionResult<ResourceData[K]> };

export type Product = ResourceData["products"][number];
export type Sale = ResourceData["sales"][number];
export type PurchaseOrder = ResourceData["orders"][number];
export type Supplier = ResourceData["suppliers"][number];
