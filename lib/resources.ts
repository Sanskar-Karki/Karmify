"use client";

import {
  getProducts, getCategories, getSuppliers, getStocks,
  getSales, getStockMovements, getPurchaseOrders, getActivityLogs,
  getCustomers,
} from "@/app/actions";
import { defineResource } from "@/lib/useResources";

// Single source of truth for each cacheable resource. Pages compose the ones
// they need; sharing a key means a fetch on one page satisfies another within
// the cache TTL instead of refetching.
export const resources = {
  products: defineResource("products", getProducts),
  // Sales/POS only ever lists sellable products — filter at the source so the
  // shared `products` cache stays canonical and this stays a derived view.
  activeProducts: defineResource(
    "products",
    getProducts,
    (data: any[]) => data.filter(p => p.status === "active")
  ),
  categories: defineResource("categories", getCategories),
  suppliers: defineResource("suppliers", getSuppliers),
  stocks: defineResource("stocks", getStocks),
  sales: defineResource("sales", getSales),
  movements: defineResource("movements", getStockMovements),
  orders: defineResource("orders", getPurchaseOrders),
  activities: defineResource("activities", getActivityLogs),
  customers: defineResource("customers", getCustomers),
};
