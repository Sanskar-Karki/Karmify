"use client";

import { fetchResource } from "@/lib/resourceCache";
import { resources } from "@/lib/resources";

// Which cached resources each route needs, mirroring each page's own
// `useResources({...})` call, so a click lands on data already loaded.
const ROUTE_RESOURCES: Record<string, (keyof typeof resources)[]> = {
  "/dashboard": ["products", "sales", "stocks", "movements", "categories", "activities"],
  "/analytics": ["sales", "products", "categories"],
  "/customers": ["sales"],
  "/products": ["products", "categories", "suppliers", "stocks"],
  "/inventory": ["products", "stocks", "movements"],
  "/purchases": ["products", "suppliers", "orders"],
  "/sales": ["activeProducts", "categories", "stocks", "sales"],
};

// Safe to call repeatedly: fetchResource skips fresh entries and shares any
// request already running.
export function prefetchRoute(href: string) {
  for (const key of ROUTE_RESOURCES[href] ?? []) {
    const def = resources[key];
    fetchResource(def.key, def.fetcher).catch(() => {});
  }
}

let warmed = false;

// Warm every route once, shortly after the current page's own load has gone
// out. Everything requested here shares a single batched request.
export function prefetchAllRoutesOnce() {
  if (warmed) return;
  warmed = true;
  setTimeout(() => Object.keys(ROUTE_RESOURCES).forEach(prefetchRoute), 300);
}
