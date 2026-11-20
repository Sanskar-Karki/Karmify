import { useSyncExternalStore } from "react";
import { OWNER_HINT_COOKIE } from "@/lib/ownerPaths";

// What the screens show for the owner lock (see lib/ownerPaths.ts). Hiding a
// page here is only tidiness: the server (proxy.ts) is what keeps a locked
// device out of Dashboard and Analytics.

/** When this device's unlock ends, or null when it's locked. */
export function readOwnerUntil(): number | null {
  if (typeof document === "undefined") return null;
  const raw = document.cookie.split("; ").find(c => c.startsWith(`${OWNER_HINT_COOKIE}=`))?.slice(OWNER_HINT_COOKIE.length + 1);
  const until = Number(raw);
  return Number.isFinite(until) && until > Date.now() ? until : null;
}

const EVENT = "karmify-owner-lock";

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

/** Call after locking or unlocking, so the dock, search and Settings update at once. */
export function ownerLockChanged() {
  window.dispatchEvent(new Event(EVENT));
}

/**
 * True when Dashboard and Analytics are unlocked on this device. Starts false
 * (locked) until the page has loaded, so a staff phone never shows them, even
 * for a moment.
 */
export function useOwnerUnlocked() {
  return useSyncExternalStore(subscribe, () => readOwnerUntil() !== null, () => false);
}
