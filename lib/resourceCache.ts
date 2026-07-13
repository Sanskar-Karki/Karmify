// Shared, resource-level data cache for the dashboard.
//
// Why this exists: every page used to keep its own per-page cache and refetch
// *all* of its resources on every mount, so `getProducts` (used on 5 pages)
// fired again on each navigation, and two pages that both need products never
// shared the result. This store is keyed by resource name instead of by page,
// adds a TTL so fresh data isn't refetched, and dedupes concurrent requests for
// the same resource so N pages mounting at once trigger one fetch, not N.

type Entry<T> = {
  data: T;
  fetchedAt: number;
  inFlight?: Promise<T>;
};

const store = new Map<string, Entry<unknown>>();

// How long cached data is considered fresh. Within this window a resource is
// served from cache with no network call; past it the next read refetches.
export const DEFAULT_TTL_MS = 30_000;

// Bumped whenever a mutation invalidates resources, so the SVG-fast cache reads
// stay correct after writes.
export function getCached<T>(key: string): T | undefined {
  const entry = store.get(key);
  return entry ? (entry.data as T) : undefined;
}

function isFresh(entry: Entry<unknown> | undefined, ttl: number): boolean {
  return !!entry && Date.now() - entry.fetchedAt < ttl;
}

/**
 * Fetch a resource, returning cached data when it is still fresh and deduping
 * concurrent fetches for the same key. `force` bypasses the freshness check
 * (used after a mutation) while still benefiting from in-flight dedupe.
 */
export function fetchResource<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts: { ttl?: number; force?: boolean } = {}
): Promise<T> {
  const ttl = opts.ttl ?? DEFAULT_TTL_MS;
  const entry = store.get(key) as Entry<T> | undefined;

  if (entry?.inFlight) return entry.inFlight;
  if (!opts.force && isFresh(entry, ttl)) return Promise.resolve(entry!.data);

  const inFlight = fetcher()
    .then(data => {
      store.set(key, { data, fetchedAt: Date.now() });
      return data;
    })
    .catch(err => {
      // Drop the in-flight marker so a later read can retry; keep stale data.
      if (entry) store.set(key, { data: entry.data, fetchedAt: entry.fetchedAt });
      else store.delete(key);
      throw err;
    });

  store.set(key, { data: (entry?.data as T) ?? (undefined as T), fetchedAt: entry?.fetchedAt ?? 0, inFlight });
  return inFlight;
}

/** Mark resources stale so the next read refetches (call after a mutation). */
export function invalidate(...keys: string[]) {
  for (const key of keys) {
    const entry = store.get(key);
    if (entry) store.set(key, { ...entry, fetchedAt: 0 });
  }
}
