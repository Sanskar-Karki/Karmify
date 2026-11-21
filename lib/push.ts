import "server-only";

import webpush from "web-push";
import { db } from "@/lib/db";
import { WEBSITE_ORDER_NOTIFICATION } from "@/lib/orders";
import { notificationLink } from "@/lib/notifications";

// Phone notifications (web push). Each phone that switched them on in Settings
// has a PushDevice row; when Karmify raises a notification, the phones that
// want that kind get it on their lock screen, even with Karmify closed.
//
// Needs NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (one pair for the
// whole app, made once with `npx web-push generate-vapid-keys`). Without them
// nothing is sent and the Settings card says so.

/** Who the push services can contact about this sender (an https address or mailto:). */
const SUBJECT = process.env.VAPID_SUBJECT?.trim() || "https://app.karmaluoriginals.com";
const SEND_TIMEOUT_MS = 8_000;

let configured: boolean | null = null;

export function pushConfigured() {
  if (configured !== null) return configured;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  configured = Boolean(publicKey && privateKey);
  if (configured) webpush.setVapidDetails(SUBJECT, publicKey!, privateKey!);
  return configured;
}

export type PushMessage = {
  title: string;
  body: string;
  /** The Karmify page to open when the notification is tapped. */
  url: string;
  /** Notifications with the same tag replace each other instead of piling up. */
  tag?: string;
};

type Device = { id: string; endpoint: string; p256dh: string; auth: string };

/** Sends to each device; devices the push service says are gone are removed. */
async function sendTo(devices: Device[], message: PushMessage) {
  if (devices.length === 0 || !pushConfigured()) return { sent: 0, failed: 0 };
  const payload = JSON.stringify({
    title: message.title,
    body: message.body.length > 240 ? `${message.body.slice(0, 237)}…` : message.body,
    url: message.url,
    tag: message.tag,
  });

  const gone: string[] = [];
  let sent = 0;
  await Promise.all(
    devices.map(async device => {
      try {
        await webpush.sendNotification(
          { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
          payload,
          { TTL: 60 * 60 * 24, urgency: "high", timeout: SEND_TIMEOUT_MS }
        );
        sent += 1;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // 404/410: the phone switched notifications off, or the app was removed.
        if (status === 404 || status === 410) gone.push(device.id);
        else console.error("[push] send failed", status ?? err);
      }
    })
  );
  if (gone.length > 0) await db.pushDevice.deleteMany({ where: { id: { in: gone } } }).catch(() => {});
  return { sent, failed: devices.length - sent };
}

/** Whether a notification counts as a new website order (which every signed-up phone gets). */
const isWebsiteOrder = (title: string) => title === WEBSITE_ORDER_NOTIFICATION;

/** Pushes a just-created Karmify notification to the phones that want it. Never throws. */
export async function pushNotification(storeId: string, title: string, message: string) {
  try {
    if (!pushConfigured()) return;
    const devices = await db.pushDevice.findMany({
      where: { storeId, ...(isWebsiteOrder(title) ? {} : { everything: true }) },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    await sendTo(devices, {
      title,
      body: message,
      url: notificationLink({ title, message })?.href ?? "/customers",
      // Each order gets its own notification; other kinds replace their last one.
      tag: isWebsiteOrder(title) ? undefined : title,
    });
  } catch (err) {
    console.error("[push] failed", title, err);
  }
}

/** A test notification to one device, from Settings. */
export async function pushTest(storeId: string, endpoint: string) {
  const device = await db.pushDevice.findFirst({
    where: { storeId, endpoint },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  if (!device) return { sent: 0, failed: 0, missing: true };
  return {
    ...(await sendTo([device], {
      title: "Karmify notifications are on",
      body: "New website orders will show up here, even when Karmify is closed.",
      url: "/settings",
      tag: "karmify-test",
    })),
    missing: false,
  };
}
