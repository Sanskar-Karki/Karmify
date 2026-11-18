"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

/** The orders table's search, filters and sort. Keys match the URL parameters other pages link with. */
export const ORDER_FILTER_DEFAULTS = {
  q: "",
  filter: "all",
  from: "",
  to: "",
  source: "all",
  area: "all",
  payment: "all",
  status: "all",
  sort: "newest",
};
export type OrderFilters = typeof ORDER_FILTER_DEFAULTS;
const KEYS = Object.keys(ORDER_FILTER_DEFAULTS) as (keyof OrderFilters)[];

// Kept in memory (module state), not in storage: it survives moving between
// Karmify's pages, which are client-side navigations, and is gone after a
// reload, which starts the table fresh.
let remembered: { filters: OrderFilters; urlKey: string } | null = null;

/** The filter parameters in the address, as a stable key ("" when there are none). */
function urlKeyOf(params: URLSearchParams) {
  return KEYS.filter(k => params.has(k)).map(k => `${k}=${params.get(k)}`).join("&");
}

function fromUrl(params: URLSearchParams): OrderFilters {
  const next = { ...ORDER_FILTER_DEFAULTS };
  for (const k of KEYS) {
    const v = params.get(k);
    if (v !== null) next[k] = v;
  }
  return next;
}

/**
 * Filters that stay put while you switch pages and come back, and reset on
 * reload. A link that carries filters (Analytics → "Sent with Upaya", a search
 * result, ?status=CANCELLED) opens with exactly those, and a later link while
 * already on the page applies too. Coming back to the same address (the dock,
 * or Back from a customer) restores what you had.
 * Requires a Suspense boundary above the caller (provided by the dashboard layout).
 */
export function useOrderFilters() {
  const params = useSearchParams();
  const urlKey = urlKeyOf(params);

  const [filters, setFilters] = useState<OrderFilters>(() =>
    remembered && (urlKey === "" || urlKey === remembered.urlKey) ? remembered.filters : fromUrl(params)
  );
  const [startedFrom, setStartedFrom] = useState(urlKey);

  if (urlKey !== startedFrom) {
    setStartedFrom(urlKey);
    if (urlKey !== "") setFilters(fromUrl(params));
  }

  useEffect(() => {
    remembered = { filters, urlKey: startedFrom };
  }, [filters, startedFrom]);

  const update = (patch: Partial<OrderFilters>) => setFilters(f => ({ ...f, ...patch }));
  /** Everything back to the defaults, search included. */
  const reset = () => setFilters(ORDER_FILTER_DEFAULTS);

  return { filters, update, reset };
}
