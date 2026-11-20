import "server-only";

import { DeliveryStatus, PaymentMethod, PaymentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { courierStillOpen, deliveryStatusFor, readCommentTimes, upayaTime, withCommentTimes, type CourierComment } from "@/lib/courier";
import { trackOrder } from "@/lib/upaya";
import { notify } from "@/lib/actions/helpers";

// Only one store may use the Upaya account, because anyone who signs up to
// Karmify gets a store of their own. With no store named, nobody can ship.
export const courierEnabledFor = (storeId: string) =>
  Boolean(process.env.UPAYA_API_KEY) && process.env.UPAYA_STORE_ID === storeId;

export const shipmentFields = {
  id: true, courierTrackingCode: true, courierStatus: true, deliveryStatus: true, paymentMethod: true,
  courierComment: true, courierCommentBy: true, courierCommentTimes: true,
} as const;

type Shipment = {
  id: string;
  courierTrackingCode: string | null;
  courierStatus: string | null;
  deliveryStatus: DeliveryStatus;
  paymentMethod: PaymentMethod;
  courierComment?: string | null;
  courierCommentBy?: string | null;
  courierCommentTimes?: string | null;
};

/** What the Upaya list shows for a comment's writer. */
export const commentWriter = (comment: CourierComment) => (comment.fromUs ? "You" : comment.by ?? "Rider");

/**
 * Keeps the newest comment on the order, so the Upaya list can show it without
 * asking Upaya about every row. Saved even for finished parcels: people still
 * talk about a returned one. Returns whether it changed.
 */
export async function saveLatestComment(sale: Shipment, trackingCode: string, latest: CourierComment | undefined) {
  const comment = latest?.text ?? null;
  const by = latest ? commentWriter(latest) : null;
  if (comment === (sale.courierComment ?? null) && by === (sale.courierCommentBy ?? null)) return false;
  // Upaya sometimes leaves comments out of a reply; don't wipe a saved one for that.
  if (comment === null) return false;
  const { count } = await db.sale.updateMany({
    where: { id: sale.id, courierTrackingCode: trackingCode },
    data: { courierComment: comment, courierCommentBy: by },
  });
  return count > 0;
}

/**
 * Saves a status read from Upaya, applying the app's rule that COD orders are
 * paid exactly when delivered. Finished shipments are never reopened, which
 * also makes a slow, out-of-date read harmless. Returns whether anything changed.
 */
export async function applyCourierStatus(sale: Shipment, trackingCode: string, status: string) {
  const delivery = deliveryStatusFor(status);
  const deliveryChanged = delivery !== null && delivery !== sale.deliveryStatus;
  const paymentStatus = deliveryChanged && sale.paymentMethod === PaymentMethod.COD
    ? (delivery === DeliveryStatus.DELIVERED ? PaymentStatus.PAID : PaymentStatus.UNPAID)
    : undefined;

  const { count } = await db.sale.updateMany({
    where: { id: sale.id, courierTrackingCode: trackingCode, ...courierStillOpen },
    data: {
      courierStatus: status,
      courierCheckedAt: new Date(),
      ...(deliveryChanged && { deliveryStatus: delivery }),
      ...(paymentStatus && { paymentStatus }),
    },
  });
  return count > 0 && sale.courierStatus !== status;
}

/** Reads one shipment's real status from Upaya and saves it. */
export async function syncShipment(sale: Shipment) {
  const trackingCode = sale.courierTrackingCode;
  if (!trackingCode) throw new Error("This order has no tracking code.");
  const tracking = await trackOrder(trackingCode);
  const statusChanged = tracking.status ? await applyCourierStatus(sale, trackingCode, tracking.status) : false;
  const commentChanged = await saveLatestComment(sale, trackingCode, tracking.comments[0]);
  tracking.comments = withCommentTimes(tracking.comments, readCommentTimes(sale.courierCommentTimes));
  return { tracking, changed: statusChanged || commentChanged };
}

/**
 * Handles a webhook. Webhooks are unsigned and can arrive out of order, so the
 * event only says which shipment to look at; the status comes from Upaya itself.
 */
export async function syncShipmentByTrackingCode(trackingCode: string) {
  const storeId = process.env.UPAYA_STORE_ID;
  if (!storeId) return;
  const sale = await db.sale.findFirst({
    where: { storeId, courierTrackingCode: trackingCode },
    select: shipmentFields,
  });
  if (sale) await syncShipment(sale);
}

export const COURIER_COMMENT_NOTIFICATION = "Upaya comment on an order";

/** Keeps when a comment was made (the newest 100), since Upaya's tracking leaves times out. */
export async function keepCommentTime(saleId: string, entry: { t: string; us: boolean; at: string }) {
  const sale = await db.sale.findUnique({ where: { id: saleId }, select: { courierCommentTimes: true } });
  if (!sale) return;
  const times = readCommentTimes(sale.courierCommentTimes);
  if (times.some(e => e.t === entry.t && e.us === entry.us && e.at === entry.at)) return; // a repeated webhook
  await db.sale.update({ where: { id: saleId }, data: { courierCommentTimes: JSON.stringify([...times, entry].slice(-100)) } });
}

/**
 * Handles a comment webhook: a note from Upaya's team or the rider ("customer
 * not reachable"). Like status webhooks it's unsigned, so it only counts once
 * the same words show up in Upaya's own record of the parcel. Comments we sent
 * ourselves come back too and are skipped.
 */
export async function noteCourierComment(trackingCode: string, comment: string, by: string | null, commentedAt: string | null = null) {
  const storeId = process.env.UPAYA_STORE_ID;
  // Our own comments come back too: their time was kept when they were sent.
  if (!storeId || by === "Client") return;
  const sale = await db.sale.findFirst({
    where: { storeId, courierTrackingCode: trackingCode },
    select: { ...shipmentFields, invoiceNumber: true, customerName: true },
  });
  if (!sale) return;

  const { tracking } = await syncShipment(sale);
  const said = comment.trim();
  const confirmed = tracking.comments.some(c => !c.fromUs && c.text === said);
  if (!confirmed) return;

  await keepCommentTime(sale.id, { t: said, us: false, at: upayaTime(commentedAt) ?? new Date().toISOString() });
  const who = by?.trim() || "Upaya";
  const text = said.length > 300 ? `${said.slice(0, 299)}…` : said;
  await notify(storeId, COURIER_COMMENT_NOTIFICATION, `${who} on ${sale.invoiceNumber}${sale.customerName ? ` (${sale.customerName})` : ""}: ${text}`, "info");
}
