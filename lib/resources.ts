"use client";

import { groupSalesByCustomer } from "@/lib/orders";
import { batchLoad, ResourceLoadError } from "@/lib/resourceBatch";
import { defineResource } from "@/lib/useResources";
import type { ResourceData, ResourceKey } from "@/lib/types";

const batched = <K extends ResourceKey>(key: K) => defineResource(key, () => batchLoad(key));

/**
 * The bell checks often, so it has its own GET endpoint instead of the batched
 * Server Action: Server Actions run one at a time, and a check stuck behind the
 * order list or a save is why new website orders used to show up late.
 */
async function fetchNotifications(): Promise<ResourceData["notifications"]> {
  const res = await fetch("/api/notifications", { cache: "no-store" });
  if (!res.ok) {
    throw new ResourceLoadError(res.status === 401 ? "Your session has expired. Please sign in again." : "Could not load notifications.");
  }
  const rows = (await res.json()) as (Omit<ResourceData["notifications"][number], "createdAt"> & { createdAt: string })[];
  return rows.map(n => ({ ...n, createdAt: new Date(n.createdAt) }));
}

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
  notifications: defineResource("notifications", fetchNotifications),
  notes: batched("notes"),
};
