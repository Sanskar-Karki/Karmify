"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchResource, getCached, invalidate } from "@/lib/resourceCache";

/**
 * A named resource: a stable cache key + the server action that loads it.
 * Optionally `transform` post-processes the result before it hits state
 * (e.g. the sales page only wants active products).
 */
export type ResourceDef<T> = {
  key: string;
  fetcher: () => Promise<T>;
  transform?: (data: any) => T;
};

export function defineResource<T>(
  key: string,
  fetcher: () => Promise<T>,
  transform?: (data: any) => T
): ResourceDef<T> {
  return { key, fetcher, transform };
}

type Values<R extends Record<string, ResourceDef<any>>> = {
  [K in keyof R]: R[K] extends ResourceDef<infer T> ? T : never;
};

/**
 * Load a set of named resources, sharing a TTL-backed cache across the whole
 * app. Returns the current values (served instantly from cache when present),
 * a single `loading` flag that is only true on the very first load with no
 * cached data, and a `refetch` that force-refreshes after mutations.
 */
export function useResources<R extends Record<string, ResourceDef<any>>>(defs: R) {
  // Read the defs once; they are static per page.
  const defsRef = useRef(defs);
  const entries = Object.entries(defsRef.current) as [keyof R, ResourceDef<any>][];

  const readCache = useCallback(() => {
    const out: Partial<Values<R>> = {};
    let allCached = true;
    for (const [name, def] of entries) {
      const cached = getCached<any>(def.key);
      if (cached === undefined) allCached = false;
      out[name] = (cached ?? []) as any;
    }
    return { values: out as Values<R>, allCached };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initial = readCache();
  const [values, setValues] = useState<Values<R>>(initial.values);
  // Only show the loading state when we have nothing cached to paint.
  const [loading, setLoading] = useState(!initial.allCached);

  const load = useCallback(async (force = false) => {
    const results = await Promise.all(
      entries.map(async ([name, def]) => {
        const raw = await fetchResource(def.key, def.fetcher, { force });
        return [name, def.transform ? def.transform(raw) : raw] as const;
      })
    );
    const next = {} as Values<R>;
    for (const [name, data] of results) next[name] = data as any;
    setValues(next);
    setLoading(false);
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Force-refresh: invalidate then reload. Use after create/update/delete.
  const refetch = useCallback(() => {
    invalidate(...entries.map(([, def]) => def.key));
    return load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  return { ...values, loading, refetch } as Values<R> & {
    loading: boolean;
    refetch: () => Promise<Values<R>>;
  };
}
