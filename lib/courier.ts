import { normalizePhone } from "@/lib/customerIdentity";
import { deliveryAddress } from "@/lib/orders";

// Rules for the Upaya courier that both the order dialog and the server need.

export const COURIER_SERVICES = [
  { value: "3", label: "Door to door" },
  { value: "9", label: "Door to branch" },
  { value: "5", label: "Branch to branch" },
];

export const COURIER_FINAL_STATUSES = ["delivered", "returned-to-vendor", "cancelled", "loss-and-damage", "dispose"];

/** Prisma filter for shipments Upaya can still update. */
export const courierStillOpen = {
  OR: [{ courierStatus: null }, { courierStatus: { notIn: COURIER_FINAL_STATUSES } }],
};

const RETURN_STATUSES = [
  "followup-for-return", "confirmed-for-return", "return-processed-from-hub",
  "return-received-at-central-facility", "out-for-return", "on-field-failed-return",
];

/** Track-order reports "Picked Up By Rider"; webhooks and lists say "picked-up-by-rider". */
export const courierStatusSlug = (display: string) => display.trim().toLowerCase().replace(/\s+/g, "-");

export const courierStatusLabel = (slug: string) =>
  slug.split("-").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");

/**
 * The Karmify delivery status a courier status means, or null to leave it alone.
 * Cancelled, lost and disposed parcels need a person to decide what happened.
 */
export function deliveryStatusFor(slug: string): "DELIVERED" | "RETURN_PROCESS" | "RETURNED" | null {
  if (slug === "delivered") return "DELIVERED";
  if (slug === "returned-to-vendor") return "RETURNED";
  return RETURN_STATUSES.includes(slug) ? "RETURN_PROCESS" : null;
}

export function courierStatusStyle(slug: string) {
  if (slug === "delivered") return "bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400";
  if (["loss-and-damage", "dispose", "cancelled", "failed-pickup", "on-field-failed-delivery"].includes(slug)) {
    return "bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400";
  }
  if (slug === "returned-to-vendor" || RETURN_STATUSES.includes(slug)) {
    return "bg-orange-100 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400";
  }
  return "bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400";
}

/** Upaya accepts only letters, numbers, underscore and space in a reference. */
export const courierReference = (invoiceNumber: string) => invoiceNumber.replace(/[^A-Za-z0-9_ ]/g, "_");

/** Upaya can hand a reference back with spaces removed and a "ref-" prefix added. */
export function sameCourierReference(a: string | null, b: string) {
  const plain = (value: string) => value.replace(/\s/g, "").replace(/^ref-/i, "").toLowerCase();
  return a !== null && plain(a) !== "" && plain(a) === plain(b);
}

/** The 10-digit mobile Upaya requires, or null if the number can't be one. */
export function courierMobile(phone?: string | null) {
  const digits = normalizePhone(phone);
  return digits && /^9\d{9}$/.test(digits) ? digits : null;
}

/** Upaya's address field holds 100 characters, so the rest goes in the landmark. */
export function splitCourierAddress(raw?: string | null) {
  const clean = deliveryAddress(raw).replace(/\s+/g, " ").trim();
  if (clean.length <= 100) return { address: clean, landmark: "" };
  const space = clean.lastIndexOf(" ", 100);
  const cut = space > 40 ? space : 100;
  return {
    address: clean.slice(0, cut).replace(/[,\s]+$/, ""),
    landmark: clean.slice(cut).replace(/^[,\s]+/, "").slice(0, 250),
  };
}

export type CourierArea = { areaId: number; locationId: number; title: string; hub: string | null };
export type CourierCategory = { value: string; label: string };

export type CourierOrderForm = {
  receiverName: string;
  receiverPhone: string;
  address: string;
  landmark: string;
  areaId: number;
  serviceTypeId: number;
  categoryId: number;
  description: string;
  declaredValue: number;
  codAmount: number;
  weight: number;
  note: string;
};

export type CourierTracking = {
  trackingCode: string;
  referenceId: string | null;
  status: string | null;
  createdDate: string | null;
  latestUpdate: string | null;
  area: string | null;
  hub: string | null;
  codAmount: number | null;
  codSettlement: string | null;
  serviceCharge: number | null;
  serviceChargeStatus: string | null;
  history: { at: string | null; status: string | null; by: string | null; hub: string | null; remarks: string | null }[];
};
