"use server";

import { requireTenant } from "@/lib/tenant";
import { db } from "@/lib/db";
import { guarded, UserError } from "@/lib/actions/result";
import { pushConfigured, pushTest } from "@/lib/push";

// Settings → Phone notifications: signing this phone/computer up for alerts,
// changing what it gets, and switching it off again.

type Subscription = { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };

const text = (value: unknown, max: number) =>
  typeof value === "string" && value.length > 0 && value.length <= max ? value : null;

function readSubscription(sub: Subscription) {
  const endpoint = text(sub?.endpoint, 1000);
  const p256dh = text(sub?.keys?.p256dh, 200);
  const auth = text(sub?.keys?.auth, 100);
  if (!endpoint || !endpoint.startsWith("https://") || !p256dh || !auth) {
    throw new UserError("This browser gave an unusable notification address. Try again.");
  }
  return { endpoint, p256dh, auth };
}

/** Whether this device is signed up, and for what. */
export async function getPushDevice(endpoint: string | null) {
  return guarded("Could not check phone notifications.", async () => {
    const { storeId } = await requireTenant();
    const configured = pushConfigured();
    const found = endpoint
      ? await db.pushDevice.findFirst({ where: { storeId, endpoint }, select: { everything: true } })
      : null;
    return { configured, registered: Boolean(found), everything: found?.everything ?? false };
  });
}

/** Signs this device up (or updates it) and sends a test notification. */
export async function savePushDevice(sub: Subscription, everything: boolean, userAgent: string) {
  return guarded("Could not switch on phone notifications.", async () => {
    const { storeId } = await requireTenant();
    if (!pushConfigured()) throw new UserError("Phone notifications aren't set up on the server yet.");
    const { endpoint, p256dh, auth } = readSubscription(sub);
    const data = { storeId, p256dh, auth, everything: Boolean(everything), userAgent: text(userAgent, 300) };
    await db.pushDevice.upsert({ where: { endpoint }, update: data, create: { endpoint, ...data } });
    const test = await pushTest(storeId, endpoint);
    return { tested: test.sent > 0 };
  });
}

/** Changes whether this device also gets low stock, stock received and problem alerts. */
export async function setPushEverything(endpoint: string, everything: boolean) {
  return guarded("Could not change phone notifications.", async () => {
    const { storeId } = await requireTenant();
    const { count } = await db.pushDevice.updateMany({ where: { storeId, endpoint: String(endpoint) }, data: { everything: Boolean(everything) } });
    if (count === 0) throw new UserError("This device isn't signed up any more. Switch phone notifications on again.");
    return { everything: Boolean(everything) };
  });
}

/** Sends a test notification to this device. */
export async function testPushDevice(endpoint: string) {
  return guarded("Could not send a test notification.", async () => {
    const { storeId } = await requireTenant();
    if (!pushConfigured()) throw new UserError("Phone notifications aren't set up on the server yet.");
    const result = await pushTest(storeId, String(endpoint));
    if (result.missing) throw new UserError("This device isn't signed up any more. Switch phone notifications on again.");
    if (result.sent === 0) throw new UserError("The test didn't go through. Switch phone notifications off and on again.");
    return { sent: true };
  });
}

/** Stops alerts to this device. */
export async function removePushDevice(endpoint: string) {
  return guarded("Could not switch off phone notifications.", async () => {
    const { storeId } = await requireTenant();
    await db.pushDevice.deleteMany({ where: { storeId, endpoint: String(endpoint) } });
    return { removed: true };
  });
}
