// Module-level store: survives client-side navigations (the module instance
// persists as long as the app isn't fully reloaded), so pages can paint
// immediately with last-known data instead of waiting on every revisit.
const store = new Map<string, unknown>();

export function getPageCache<T>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}

export function setPageCache<T>(key: string, data: T) {
  store.set(key, data);
}
