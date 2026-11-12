// Shared, resource-level data cache for the dashboard.
//
// Keyed by resource rather than by page, so two pages that need products share
// one result. Fresh data is served without a network call, concurrent reads of
// a key share one request, and subscribers re-render whenever an entry lands.

type Entry = {
  data: unknown;
  /** 0 means "never loaded or explicitly stale". */
  fetchedAt: number;
  inFlight?: Promise<unknown>;
};

const store = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;
let owner: string | null = null;

export const DEFAULT_TTL_MS = 30_000;

function publish() {
  version += 1;
  listeners.forEach(listener => listener());
}

export function subscribeToCache(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const getCacheVersion = () => version;
export const getServerCacheVersion = () => 0;

export function getCached<T>(key: string): T | undefined {
  return store.get(key)?.data as T | undefined;
}

/**
 * Fetch a resource, returning cached data while it is fresh and sharing any
 * request already running. `force` always starts a new request and makes it
 * the winner: a read that began before a mutation must not overwrite, or be
 * mistaken for, the data read after it.
 */
export function fetchResource<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts: { ttl?: number; force?: boolean } = {}
): Promise<T> {
  const ttl = opts.ttl ?? DEFAULT_TTL_MS;
  const entry = store.get(key);

  if (!opts.force && entry) {
    if (entry.inFlight) return entry.inFlight as Promise<T>;
    if (entry.fetchedAt > 0 && Date.now() - entry.fetchedAt < ttl) return Promise.resolve(entry.data as T);
  }

  const request: Promise<T> = fetcher().then(
    data => {
      if (store.get(key)?.inFlight === request) {
        store.set(key, { data, fetchedAt: Date.now() });
        publish();
      }
      return data;
    },
    err => {
      const current = store.get(key);
      if (current?.inFlight === request) {
        // Keep stale data on screen and allow a later read to retry.
        store.set(key, { data: current.data, fetchedAt: current.fetchedAt });
      }
      throw err;
    }
  );

  store.set(key, { data: entry?.data, fetchedAt: entry?.fetchedAt ?? 0, inFlight: request });
  return request;
}

/** Mark everything stale so each resource refetches on its next read. */
export function invalidateAll() {
  for (const [key, entry] of store) store.set(key, { ...entry, fetchedAt: 0 });
}

/**
 * Drops all cached data when a different account signs in on this browser, so
 * one store's records are never shown to, or edited by, another.
 */
export function bindCacheToUser(userId: string | null | undefined) {
  if (!userId || userId === owner) return;
  if (owner !== null) store.clear();
  owner = userId;
}
