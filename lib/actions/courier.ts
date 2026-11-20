"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { logActivity } from "@/lib/actions/helpers";
import { guarded, UserError } from "@/lib/actions/result";
import {
  COURIER_COMMENT_MAX, courierCodAmount, courierMobile, courierReference, courierStillOpen, DOOR_TO_DOOR, isCourierService, splitCourierAddress, type CourierOrderForm,
} from "@/lib/courier";
import { instantCourierLabel, itemName } from "@/lib/orders";
import { exchangeLineName, exchangeOf, type SaleExchange } from "@/lib/exchange";
import { commentWriter, courierEnabledFor, keepCommentTime, shipmentFields, syncShipment } from "@/lib/courierSync";
import {
  addOrderComment, createOrder, findOrderByReference, getCategories, getRate, isUncertainOutcome, searchAreas, sleep, suggestAreas, UpayaError, valleyLocationIds,
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

/** Whether this store books with Upaya (the POS only asks for a hub location when it does). */
export async function getCourierStatus() {
  return guarded("Could not check the courier setup.", async () => {
    const tenant = await requireTenant();
    return { enabled: courierEnabledFor(tenant.storeId) };
  });
}

/** Upaya hub locations that match a typed delivery address. */
export async function suggestCourierAreas(address: string) {
  return guarded("Could not suggest Upaya hub locations.", async () => {
    await requireCourierTenant();
    try {
      return await suggestAreas(address);
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

/** Upaya locations inside the Kathmandu valley, for splitting orders by valley. */
export async function listValleyLocations() {
  return guarded("Could not load Upaya's valley locations.", async () => {
    await requireCourierTenant();
    try {
      return await valleyLocationIds();
    } catch (err) {
      throw upayaMessage(err, "Could not reach Upaya. Try again shortly.");
    }
  });
}

/** Upaya's charge for a delivery, or for an exchange (deliver the new items, collect the old) when `exchange` is set. */
export async function estimateCourierRate(locationId: number, weight: number, serviceTypeId: number, exchange = false) {
  return guarded("Estimate unavailable.", async () => {
    await requireCourierTenant();
    return getRate(locationId, weight, serviceTypeId, exchange === true ? "exchange_order" : "delivery_order");
  });
}

/**
 * The extra fields Upaya needs for an exchange order: what the rider collects.
 * The three size keys must be sent (as null): leaving them out is an error.
 */
function exchangeFields(exchange: SaleExchange, categoryId: number) {
  return {
    order_type: "exchange_order",
    return_product_name: exchange.items.map(l => `${l.quantity} x ${exchangeLineName(l)}`).join(", ").slice(0, 250),
    return_product_weight: 1,
    return_product_category_id: categoryId,
    return_item_value: Math.max(1, Math.round(exchange.credit)),
    return_product_description: `Exchange for order ${exchange.ofInvoice}`.slice(0, 250),
    return_product_length: null,
    return_product_breadth: null,
    return_product_height: null,
  };
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
      select: { invoiceNumber: true, paymentMethod: true, deliveryStatus: true, exchange: true },
    });
    if (!sale) throw new UserError("That order no longer exists. Refresh the page and try again.");
    if (sale.deliveryStatus !== "IN_PROCESS") throw new UserError("Only orders still in process can be sent to Upaya.");
    // An exchange order goes as Upaya's exchange: the rider delivers it and collects the old items.
    const swap = exchangeOf(sale);
    const order = { ...validated(form, sale.paymentMethod !== "COD"), ...(swap && exchangeFields(swap, form.categoryId)) };

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
      data: { courierTrackingCode: booked.trackingCode, courierStatus: booked.status, courierCheckedAt: new Date(), courierSubmittingAt: null, courierServiceId: form.serviceTypeId, courierBookedAt: new Date() },
    });
    await logActivity(tenant, "Sent To Upaya", `${sale.invoiceNumber} booked with tracking code ${booked.trackingCode}.`);

    revalidatePath("/customers");
    return booked;
  });
}

// Upaya product categories: Living & Decor ships as household goods, everything else as clothing.
const UPAYA_CATEGORY = { clothing: 1, household: 6 };

/**
 * Books a delivery sale with Upaya from what's saved on it: the POS calls this
 * right after "Complete Sale". Goes through sendOrderToCourier, so the same
 * claim and duplicate check apply, and a failure leaves the sale as it is
 * (book it later from the order). The bulk send on the Orders page passes
 * door to branch for the few orders collected from a branch.
 */
/** Books an order with Upaya. Without a service, the one saved on the order (or door to door) is used. */
export async function bookSaleWithUpaya(saleId: string, service?: number) {
  return guarded("Could not send this order to Upaya.", async () => {
    if (service !== undefined && !isCourierService(service)) throw new UserError("Choose door to door or door to branch.");
    const tenant = await requireCourierTenant();
    const sale = await db.sale.findFirst({
      where: { id: saleId, storeId: tenant.storeId },
      select: {
        customerName: true, customerPhone: true, customerAddress: true, courierAreaId: true, courierServiceId: true, notes: true, deliveryVia: true,
        paymentMethod: true, paymentStatus: true, codAmount: true, totalAmount: true, discount: true, brand: true, exchange: true,
        items: { select: { quantity: true, unitPrice: true, variant: true, product: { select: { name: true } } } },
      },
    });
    if (!sale) throw new UserError("That order no longer exists. Refresh the page and try again.");
    if (sale.deliveryVia) throw new UserError(`This order was sent with ${instantCourierLabel(sale.deliveryVia) ?? "a ride app"}, not Upaya. Change that in Edit first if Upaya should take it.`);
    if (!sale.courierAreaId) throw new UserError("Choose the Upaya hub location for this order, then book it.");

    const serviceTypeId = service ?? (sale.courierServiceId && isCourierService(sale.courierServiceId) ? sale.courierServiceId : DOOR_TO_DOOR);
    const { address, landmark } = splitCourierAddress(sale.customerAddress);
    // The declared value (for claims) is what the parcel is worth: an exchange's credit
    // for the old items is part of its discount, but the new items are still worth their price.
    const swap = exchangeOf(sale);
    const goods = sale.items.reduce((total, item) => total + item.quantity * item.unitPrice, 0) - Math.max(0, sale.discount - (swap?.credit ?? 0));
    const result = await sendOrderToCourier(saleId, {
      receiverName: sale.customerName ?? "",
      receiverPhone: sale.customerPhone ?? "",
      address,
      landmark,
      areaId: sale.courierAreaId,
      serviceTypeId,
      categoryId: sale.brand === "decor" ? UPAYA_CATEGORY.household : UPAYA_CATEGORY.clothing,
      description: sale.items.map(item => `${item.quantity} x ${itemName(item)}`).join(", ").slice(0, 2500),
      declaredValue: Math.max(1, Math.round(goods)),
      codAmount: courierCodAmount(sale),
      weight: 1,
      note: (sale.notes || (swap ? `Exchange: collect ${swap.items.map(l => `${l.quantity} x ${exchangeLineName(l)}`).join(", ")} from the customer.` : "")).slice(0, 250),
    });
    if (!result.ok) throw new UserError(result.message);
    return result.data;
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

/** Sends a message about a booked parcel to Upaya's team (e.g. "deliver after 4 PM"). */
export async function addCourierComment(saleId: string, comment: string) {
  return guarded("Could not send the comment to Upaya.", async () => {
    const tenant = await requireCourierTenant();
    const text = comment.replace(/\s+/g, " ").trim();
    if (!text) throw new UserError("Write a comment first.");
    if (text.length > COURIER_COMMENT_MAX) throw new UserError(`Keep the comment under ${COURIER_COMMENT_MAX} characters.`);

    const sale = await db.sale.findFirst({
      where: { id: saleId, storeId: tenant.storeId },
      select: { invoiceNumber: true, courierTrackingCode: true, courierStatus: true },
    });
    if (!sale?.courierTrackingCode || sale.courierStatus === "cancelled") throw new UserError("This order isn't booked with Upaya.");

    try {
      const saved = await addOrderComment(sale.courierTrackingCode, text);
      await db.sale.updateMany({
        where: { id: saleId, storeId: tenant.storeId },
        data: { courierComment: saved.text, courierCommentBy: commentWriter(saved) },
      }).catch(err => console.error("[upaya] couldn't save the latest comment", err));
      await keepCommentTime(saleId, { t: saved.text, us: true, at: saved.at ?? new Date().toISOString() })
        .catch(err => console.error("[upaya] couldn't keep the comment time", err));
      await logActivity(tenant, "Upaya Comment", `${sale.invoiceNumber}: ${text}`);
      revalidatePath("/upaya");
      return saved;
    } catch (err) {
      // No reply means it may have arrived: say so, so nobody posts it twice.
      if (isUncertainOutcome(err)) throw new UserError("Upaya didn't answer, so the comment may or may not have arrived. Reopen this parcel to check before sending it again.");
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
