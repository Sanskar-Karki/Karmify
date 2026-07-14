"use client";

import { fetchResource } from "@/lib/resourceCache";
import { resources } from "@/lib/resources";

// Which cached resources each route's page needs, mirroring each page's own
// `useResources({...})` call. Used to warm the cache before navigation so the
// click lands on data that's already in flight (or already resolved) instead
// of starting a fresh fetch on mount.
const ROUTE_RESOURCES: Record<string, (keyof typeof resources)[]> = {
  "/dashboard": ["products", "sales", "stocks", "movements", "categories", "activities"],
  "/customers": ["sales"],
  "/products": ["products", "categories", "suppliers", "stocks"],
  "/inventory": ["products", "stocks", "movements"],
  "/purchases": ["products", "suppliers", "orders"],
  "/sales": ["activeProducts", "categories", "stocks", "sales"],
};

const prefetched = new Set<string>();

// Kick off the fetchers for a route's resources. Safe to call repeatedly —
// fetchResource already dedupes in-flight requests and skips fresh cache hits,
// so this only ever causes a network call the first time or after the TTL
// expires.
export function prefetchRoute(href: string) {
  const keys = ROUTE_RESOURCES[href];
  if (!keys) return;
  for (const key of keys) {
    const def = resources[key];
    fetchResource(def.key, def.fetcher).catch(() => {});
  }
}

// Warm every dockable route once, staggered slightly so the burst of
// concurrent requests on first load doesn't compete with the current page's
// own fetch. Called once from the dashboard layout.
export function prefetchAllRoutesOnce() {
  if (prefetched.has("__all__")) return;
  prefetched.add("__all__");
  const routes = Object.keys(ROUTE_RESOURCES);
  routes.forEach((href, i) => {
    setTimeout(() => prefetchRoute(href), 150 * (i + 1));
  });
}
