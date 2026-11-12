"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { logActivity } from "@/lib/actions/helpers";
import { guarded, UserError } from "@/lib/actions/result";
import { courierMobile, courierReference, courierStillOpen, type CourierOrderForm } from "@/lib/courier";
import { courierEnabledFor, shipmentFields, syncShipment } from "@/lib/courierSync";
import {
  createOrder, findOrderByReference, getCategories, getRate, isUncertainOutcome, searchAreas, sleep, suggestAreas, UpayaError,
} from "@/lib/upaya";

// Longer than the slowest booking can take, so a live claim is never stolen.
const CLAIM_MS = 3 * 60 * 1000;
const CONFIRM_WAITS_MS = [2000, 4000, 8000];

async function requireCourierTenant() {
  const tenant = await requireTenant();
  if (!courierEnabledFor(tenant.storeId)) {
    throw new UserError(`Upaya isn't enabled for this store. Add UPAYA_STORE_ID=${tenant.storeId} to the server's environment, then restart.`);
  }
  return tenant;
}

function upayaMessage(err: unknown, fallback: string) {
  if (!(err instanceof UpayaError)) return err;
  if (err.status === 429) return new UserError("Upaya is busy right now. Try again in a minute.");
  if (err.status === null || err.status >= 500) return new UserError(fallback);
  return new UserError(`Upaya: ${err.message}`);
}

export async function getCourierSetup(address: string) {
  return guarded("Could not load Upaya's delivery options.", async () => {
    await requireCourierTenant();
    try {
      const [categories, suggestions] = await Promise.all([getCategories(), suggestAreas(address)]);
      return { categories, suggestions };
    } catch (err) {
      throw upayaMessage(err, "Could not reach Upaya. Try again shortly.");
    }
  });
}

export async function searchCourierAreas(query: string) {
  return guarded("Could not search Upaya's delivery areas.", async () => {
    await requireCourierTenant();
    try {
      return await searchAreas(query);
    } catch (err) {
      throw upayaMessage(err, "Could not reach Upaya. Try again shortly.");
    }
  });
}

export async function estimateCourierRate(locationId: number, weight: number, serviceTypeId: number) {
  return guarded("Estimate unavailable.", async () => {
    await requireCourierTenant();
    return getRate(locationId, weight, serviceTypeId);
  });
}

function validated(form: CourierOrderForm, paidOnline: boolean) {
  const name = form.receiverName.trim();
  const address = form.address.trim();
  const phone = courierMobile(form.receiverPhone);

  if (!name || name.length > 100) throw new UserError("Enter the receiver's name (100 characters at most).");
  if (!phone) throw new UserError("Upaya needs a 10-digit Nepal mobile number for the receiver.");
  if (!address || address.length > 100) throw new UserError("Enter the street and house (100 characters at most).");
  if (form.landmark.length > 250) throw new UserError("The landmark can be 250 characters at most.");
  if (form.note.length > 250) throw new UserError("The rider note can be 250 characters at most.");
  if (form.description.length > 2500) throw new UserError("The description is too long.");
  if (!Number.isInteger(form.areaId) || form.areaId <= 0) throw new UserError("Choose a delivery area.");
  if (!Number.isInteger(form.categoryId) || form.categoryId <= 0) throw new UserError("Choose a product category.");
  if (!Number.isInteger(form.serviceTypeId) || form.serviceTypeId <= 0) throw new UserError("Choose a service type.");
  if (!Number.isFinite(form.weight) || form.weight <= 0) throw new UserError("Enter the parcel's weight in kg.");
  if (!Number.isFinite(form.declaredValue) || form.declaredValue < 1) throw new UserError("The declared value must be at least Rs. 1.");
  if (!Number.isFinite(form.codAmount) || form.codAmount < 0 || form.codAmount > 500_000) {
    throw new UserError("The COD amount must be between Rs. 0 and Rs. 5,00,000.");
  }
  if (paidOnline && form.codAmount > 0) throw new UserError("This order was paid by QR, so the COD amount must be 0.");

  return {
    receiver_name: name,
    receiver_contact: phone,
    receiver_address: address,
    receiver_landmark: form.landmark.trim() || undefined,
    area_id: form.areaId,
    service_type_id: form.serviceTypeId,
    product_category_id: form.categoryId,
    product_description: form.description.trim() || undefined,
    product_price: form.declaredValue,
    cod_amount: form.codAmount,
    weight: form.weight,
    // Upaya's rate endpoint fails when these keys are missing, so they're always sent.
    length: 0,
    breadth: 0,
    height: 0,
    order_type: "delivery_order",
    client_note: form.note.trim() || undefined,
  };
}

/**
 * Upaya has no duplicate protection, so a repeated request is a second pickup.
 * An order that may already exist is always searched for first, and a request
 * that gets no clear answer is never sent again automatically.
 */
async function bookCourierOrder(reference: string, order: Record<string, unknown>) {
  let existing;
  try {
    existing = await findOrderByReference(reference);
  } catch (err) {
    throw upayaMessage(err, "Could not check Upaya for this order, so nothing was sent. Try again shortly.");
  }
  if (existing) return { trackingCode: existing.trackingCode, status: existing.status, alreadyBooked: true };

  try {
    return { trackingCode: await createOrder({ ...order, order_reference_id: reference }), status: "unassigned-pickup", alreadyBooked: false };
  } catch (err) {
    if (!isUncertainOutcome(err)) throw upayaMessage(err, "Upaya couldn't take this order.");
  }

  for (const wait of CONFIRM_WAITS_MS) {
    await sleep(wait);
    const found = await findOrderByReference(reference).catch(() => null);
    if (found) return { trackingCode: found.trackingCode, status: found.status, alreadyBooked: true };
  }
  throw new UserError("Upaya didn't confirm this order. Wait a minute and press Book again. Karmify checks for it first, so it won't be booked twice.");
}

export async function sendOrderToCourier(saleId: string, form: CourierOrderForm) {
  return guarded("Could not send this order to Upaya.", async () => {
    const tenant = await requireCourierTenant();
    const storeId = tenant.storeId;

    const sale = await db.sale.findFirst({
      where: { id: saleId, storeId },
      select: { invoiceNumber: true, paymentMethod: true, deliveryStatus: true },
    });
    if (!sale) throw new UserError("That order no longer exists. Refresh the page and try again.");
    if (sale.deliveryStatus !== "IN_PROCESS") throw new UserError("Only orders still in process can be sent to Upaya.");
    const order = validated(form, sale.paymentMethod === "QR");

    // One claim at a time, so a double click or a second till can't book twice.
    const claimed = await db.sale.updateMany({
      where: {
        id: saleId,
        storeId,
        AND: [
          { OR: [{ courierTrackingCode: null }, { courierStatus: "cancelled" }] },
          { OR: [{ courierSubmittingAt: null }, { courierSubmittingAt: { lt: new Date(Date.now() - CLAIM_MS) } }] },
        ],
      },
      data: { courierSubmittingAt: new Date() },
    });
    if (claimed.count === 0) throw new UserError("This order is already with Upaya or being sent. Refresh the page.");

    let booked;
    try {
      booked = await bookCourierOrder(courierReference(sale.invoiceNumber), order);
    } catch (err) {
      await db.sale.update({ where: { id: saleId }, data: { courierSubmittingAt: null } });
      throw err;
    }

    await db.sale.update({
      where: { id: saleId },
      data: { courierTrackingCode: booked.trackingCode, courierStatus: booked.status, courierCheckedAt: new Date(), courierSubmittingAt: null },
    });
    await logActivity(tenant, "Sent To Upaya", `${sale.invoiceNumber} booked with tracking code ${booked.trackingCode}.`);

    revalidatePath("/customers");
    return booked;
  });
}

export async function getCourierTracking(saleId: string) {
  return guarded("Could not load this shipment.", async () => {
    const tenant = await requireCourierTenant();
    const sale = await db.sale.findFirst({ where: { id: saleId, storeId: tenant.storeId }, select: shipmentFields });
    if (!sale?.courierTrackingCode) throw new UserError("This order hasn't been sent to Upaya.");

    try {
      const result = await syncShipment(sale);
      if (result.changed) revalidatePath("/customers");
      return result;
    } catch (err) {
      throw upayaMessage(err, "Could not reach Upaya. Try again shortly.");
    }
  });
}

/** Catches up on any webhook that was missed, since Upaya doesn't resend them. */
export async function refreshCourierShipments() {
  return guarded("Could not refresh shipments.", async () => {
    const tenant = await requireCourierTenant();
    // Stays well inside Upaya's 100 requests a minute. Oldest checks go first,
    // so repeated presses work through a longer list.
    const open = await db.sale.findMany({
      where: { storeId: tenant.storeId, courierTrackingCode: { not: null }, ...courierStillOpen },
      orderBy: { courierCheckedAt: { sort: "asc", nulls: "first" } },
      take: 40,
      select: shipmentFields,
    });

    let updated = 0;
    let failed = 0;
    for (const sale of open) {
      try {
        if ((await syncShipment(sale)).changed) updated += 1;
      } catch {
        failed += 1;
      }
    }

    if (updated > 0) {
      revalidatePath("/customers");
      revalidatePath("/dashboard");
    }
    return { checked: open.length, updated, failed };
  });
}
