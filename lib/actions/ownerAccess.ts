"use server";

import { cookies } from "next/headers";
import { requireTenant } from "@/lib/tenant";
import { guarded, UserError } from "@/lib/actions/result";
import { logActivity } from "@/lib/actions/helpers";
import { isOwnerPassword, ownerPassword, signOwnerToken, unlockEnds, verifyOwnerToken } from "@/lib/ownerAccess";
import { OWNER_COOKIE, OWNER_HINT_COOKIE } from "@/lib/ownerPaths";

// Settings → Dashboard & Analytics: unlocking them on this device with the
// owner password, and locking them again. See lib/ownerPaths.ts.

/** A wrong password waits this long before answering, so guessing is slow. */
const WRONG_PASSWORD_DELAY_MS = 1500;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function setUnlockCookies(until: number) {
  const jar = await cookies();
  const common = { path: "/", sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", expires: new Date(until) };
  jar.set(OWNER_COOKIE, await signOwnerToken(until), { ...common, httpOnly: true });
  jar.set(OWNER_HINT_COOKIE, String(until), { ...common, httpOnly: false });
}

async function clearUnlockCookies() {
  const jar = await cookies();
  jar.delete(OWNER_COOKIE);
  jar.delete(OWNER_HINT_COOKIE);
}

/** Unlocks Dashboard and Analytics on this device, with the owner password. */
export async function unlockOwnerPages(password: string) {
  return guarded("Could not unlock Dashboard and Analytics.", async () => {
    const tenant = await requireTenant();
    if (!ownerPassword()) throw new UserError("The owner password isn't set up on the server yet, so nothing can be unlocked.");
    if (typeof password !== "string" || !password.trim()) throw new UserError("Enter the owner password.");

    if (!(await isOwnerPassword(password))) {
      // Kept in the activity log (on the Dashboard, which only the owner sees). Never the password typed.
      await logActivity(tenant, "Owner unlock refused", "Someone typed a wrong owner password to unlock Dashboard and Analytics.");
      await wait(WRONG_PASSWORD_DELAY_MS);
      throw new UserError("That's not the owner password.");
    }

    const until = unlockEnds();
    await setUnlockCookies(until);
    await logActivity(tenant, "Owner pages unlocked", "Dashboard and Analytics were unlocked on a device.");
    return { until };
  });
}

/** Locks Dashboard and Analytics on this device again. No password needed. */
export async function lockOwnerPages() {
  return guarded("Could not lock Dashboard and Analytics.", async () => {
    const tenant = await requireTenant();
    await clearUnlockCookies();
    await logActivity(tenant, "Owner pages locked", "Dashboard and Analytics were locked on a device.");
    return { locked: true };
  });
}

/**
 * Whether this device is really unlocked, according to the signed cookie, and
 * the page's hint brought in line with that (it may be stale after the owner
 * password changed, or missing after cookies were cleared).
 */
export async function getOwnerAccess() {
  return guarded("Could not check the owner lock.", async () => {
    await requireTenant();
    const jar = await cookies();
    const until = await verifyOwnerToken(jar.get(OWNER_COOKIE)?.value);
    if (until) {
      if (jar.get(OWNER_HINT_COOKIE)?.value !== String(until)) await setUnlockCookies(until);
    } else if (jar.get(OWNER_COOKIE) || jar.get(OWNER_HINT_COOKIE)) {
      await clearUnlockCookies();
    }
    return { unlocked: until !== null, until, configured: ownerPassword() !== null };
  });
}
