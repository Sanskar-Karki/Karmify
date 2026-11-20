// Dashboard and Analytics show the shop's sales figures, and everyone signs in
// with the same account, so they're locked on each device until the owner
// unlocks them in Settings with the owner password. proxy.ts enforces it on the
// server; lib/ownerLock.ts tells the screens. Plain values only: this file is
// imported by both the proxy and the pages, so nothing secret goes here.

/** The pages behind the owner lock. */
export const OWNER_PATHS = ["/dashboard", "/analytics"] as const;

/** Where a locked device goes instead. */
export const LOCKED_HOME = "/customers";

/** The proof of an unlock: an httpOnly, signed cookie the page can't read or forge. */
export const OWNER_COOKIE = "karmify_owner";

/** Readable by the page (not proof of anything): when this device's unlock ends, in ms. */
export const OWNER_HINT_COOKIE = "karmify_owner_until";

/** How long an unlock lasts on a device, unless it's locked again in Settings first. */
export const UNLOCK_DAYS = 30;

export const isOwnerPath = (pathname: string) => OWNER_PATHS.some(p => pathname === p || pathname.startsWith(`${p}/`));
