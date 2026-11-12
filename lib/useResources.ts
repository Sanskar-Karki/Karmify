"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { ResourceLoadError } from "@/lib/resourceBatch";
import { filterForShop, useShop } from "@/lib/shop";
import {
  fetchResource, getCached, getCacheVersion, getServerCacheVersion, invalidateAll, subscribeToCache,
} from "@/lib/resourceCache";

/**
 * A named resource: a stable cache key, how to load it, and an optional
 * projection for views that only want part of the data.
 */
export type ResourceDef<T> = {
  key: string;
  fetcher: () => Promise<unknown>;
  select: (raw: unknown) => T;
};

export function defineResource<Raw, T = Raw>(
  key: string,
  fetcher: () => Promise<Raw>,
  select?: (raw: Raw) => T
): ResourceDef<T> {
  return {
    key,
    fetcher,
    select: raw => (select ? select(raw as Raw) : (raw as unknown as T)),
  };
}

/** Load one resource outside React, sharing the app-wide cache. */
export async function readResource<T>(def: ResourceDef<T>): Promise<T> {
  return def.select(await fetchResource(def.key, def.fetcher));
}

type Defs = Record<string, ResourceDef<unknown>>;
type Values<R extends Defs> = { [K in keyof R]: R[K] extends ResourceDef<infer T> ? T : never };

const LOAD_ERROR_TOAST = "resource-load-error";

/**
 * Load a set of named resources from the shared cache. Cached values paint
 * immediately and refresh in the background. `loading` stays true until every
 * resource has data, so a failed load shows a skeleton and a Retry toast
 * rather than an empty page that looks like lost data.
 */
export function useResources<R extends Defs>(defs: R) {
  const [stableDefs] = useState(defs);
  const version = useSyncExternalStore(subscribeToCache, getCacheVersion, getServerCacheVersion);
  // The shop switch (Originals / Living & Decor / all) filters what every page sees.
  const shop = useShop();

  const { values, loading } = useMemo(() => {
    const next: Record<string, unknown> = {};
    let complete = true;
    for (const [name, def] of Object.entries(stableDefs)) {
      const cached = getCached<unknown>(def.key);
      if (cached === undefined) complete = false;
      next[name] = cached === undefined ? [] : def.select(filterForShop(def.key, cached, shop));
    }
    return { values: next as Values<R>, loading: !complete };
    // version is the signal that the cache changed; the cache itself is external.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableDefs, version, shop]);

  const load = useCallback((force: boolean, quiet = false) => {
    async function run(): Promise<void> {
      try {
        await Promise.all(Object.values(stableDefs).map(def => fetchResource(def.key, def.fetcher, { force })));
        toast.dismiss(LOAD_ERROR_TOAST);
      } catch (err) {
        console.error("Failed to load data", err);
        if (quiet) return;
        toast.error("Couldn't load the latest data.", {
          id: LOAD_ERROR_TOAST,
          description: err instanceof ResourceLoadError ? err.message : "Check your connection and try again.",
          duration: Infinity,
          action: { label: "Retry", onClick: () => void run() },
        });
      }
    }
    return run();
  }, [stableDefs]);

  useEffect(() => {
    void load(false);

    // Pick up changes made on another till when staff come back to this tab.
    function onVisible() {
      if (document.visibilityState === "visible") void load(false);
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  /** Reload after a mutation. Never rejects, so a failed reload can't read as a failed save. */
  const refetch = useCallback((options?: { quiet?: boolean }) => {
    // A write can affect any page (stock, ledger, activity log), so everything
    // goes stale; only this page's resources are reloaded right now.
    invalidateAll();
    return load(true, options?.quiet);
  }, [load]);

  return { ...values, loading, refetch } as Values<R> & {
    loading: boolean;
    refetch: (options?: { quiet?: boolean }) => Promise<void>;
  };
}
