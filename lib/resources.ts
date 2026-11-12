"use client";

import { groupSalesByCustomer } from "@/lib/orders";
import { batchLoad } from "@/lib/resourceBatch";
import { defineResource } from "@/lib/useResources";
import type { ResourceKey } from "@/lib/types";

const batched = <K extends ResourceKey>(key: K) => defineResource(key, () => batchLoad(key));

// Single source of truth for each cacheable resource. Pages compose the ones
// they need; sharing a key means a fetch on one page satisfies another.
export const resources = {
  products: batched("products"),
  // Sales/POS only lists sellable products. This is a view over the shared
  // `products` entry rather than a second copy of it.
  activeProducts: defineResource(
    "products",
    () => batchLoad("products"),
    products => products.filter(p => p.status === "active")
  ),
  categories: batched("categories"),
  suppliers: batched("suppliers"),
  stocks: batched("stocks"),
  sales: batched("sales"),
  movements: batched("movements"),
  orders: batched("orders"),
  activities: batched("activities"),
  // Derived from sales rather than fetched again, so opening a customer is
  // instant whenever the order list has already loaded.
  customers: defineResource("sales", () => batchLoad("sales"), groupSalesByCustomer),
  notifications: batched("notifications"),
};
