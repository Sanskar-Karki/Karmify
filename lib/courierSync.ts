import "server-only";

import { DeliveryStatus, PaymentMethod, PaymentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { courierStillOpen, deliveryStatusFor } from "@/lib/courier";
import { trackOrder } from "@/lib/upaya";

// Only one store may use the Upaya account, because anyone who signs up to
// Karmify gets a store of their own. With no store named, nobody can ship.
export const courierEnabledFor = (storeId: string) =>
  Boolean(process.env.UPAYA_API_KEY) && process.env.UPAYA_STORE_ID === storeId;

export const shipmentFields = {
  id: true, courierTrackingCode: true, courierStatus: true, deliveryStatus: true, paymentMethod: true,
} as const;

type Shipment = {
  id: string;
  courierTrackingCode: string | null;
  courierStatus: string | null;
  deliveryStatus: DeliveryStatus;
  paymentMethod: PaymentMethod;
};

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
  const changed = tracking.status ? await applyCourierStatus(sale, trackingCode, tracking.status) : false;
  return { tracking, changed };
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
