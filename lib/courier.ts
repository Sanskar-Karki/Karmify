import { normalizePhone } from "@/lib/customerIdentity";
import { codToCollect, deliveryAddress } from "@/lib/orders";

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

/**
 * Where a parcel is, in the steps Upaya's own dashboard counts (the Upaya page's
 * boxes). Together they make up "In process": everything not delivered, returned
 * to us, waiting on a return follow-up, lost or cancelled.
 */
export const UPAYA_STAGES = [
  { id: "ready", label: "Ready for pickup", statuses: ["unassigned-pickup", "assigned-pickup"] },
  { id: "picked", label: "Picked up", statuses: ["picked-up-by-rider"] },
  { id: "failed-pickup", label: "Failed pickup", statuses: ["failed-pickup"] },
  { id: "origin-hub", label: "Received at origin hub", statuses: ["inbound-at-warehouse"] },
  { id: "with-rider", label: "Dispatched with rider", statuses: ["dispatched-with-rider", "redirected"] },
  { id: "transit", label: "In transit", statuses: ["midmile-sortation", "prepared-for-transit", "in-transit-to-hub", "in-transit"] },
  { id: "dest-hub", label: "Arrived at destination hub", statuses: ["received-at-hub", "ready-for-dispatch"] },
  { id: "return", label: "Return process", statuses: RETURN_STATUSES.filter(s => s !== "followup-for-return") },
  { id: "hold", label: "Hold", statuses: ["hold"] },
  { id: "failed-delivery", label: "On-field failed delivery", statuses: ["on-field-failed-delivery"] },
] as const;

export type UpayaStage = (typeof UPAYA_STAGES)[number]["id"] | "other";
export type UpayaBucket = "delivered" | "process" | "rto" | "followup" | "lost" | "cancelled";

/**
 * Which box an Upaya status belongs in. A booking not read back yet counts as
 * ready for pickup; a status Upaya adds later counts as in process ("other"),
 * as Upaya's docs ask.
 */
export function upayaPlace(slug?: string | null): { bucket: UpayaBucket; stage: UpayaStage | null } {
  const status = slug || "unassigned-pickup";
  if (status === "delivered") return { bucket: "delivered", stage: null };
  if (status === "returned-to-vendor") return { bucket: "rto", stage: null };
  if (status === "followup-for-return") return { bucket: "followup", stage: null };
  if (status === "loss-and-damage" || status === "dispose") return { bucket: "lost", stage: null };
  if (status === "cancelled") return { bucket: "cancelled", stage: null };
  const stage = UPAYA_STAGES.find(s => (s.statuses as readonly string[]).includes(status));
  return { bucket: "process", stage: stage?.id ?? "other" };
}

/** Track-order reports "Picked Up By Rider"; webhooks and lists say "picked-up-by-rider". */
export const courierStatusSlug = (display: string) => display.trim().toLowerCase().replace(/\s+/g, "-");

export const courierStatusLabel = (slug: string) =>
  slug.split("-").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");

/**
 * The Karmify delivery status a courier status means, or null to leave it alone.
 * Lost and disposed parcels need a person to decide what happened.
 */
export function deliveryStatusFor(slug: string): "DELIVERED" | "RETURN_PROCESS" | "RETURNED" | "CANCELLED" | null {
  if (slug === "delivered") return "DELIVERED";
  if (slug === "cancelled") return "CANCELLED";
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
  /** Messages between us and Upaya about this parcel, newest first as Upaya sends them. `fromUs` is a comment Karmify (or the shop) sent. */
  comments: CourierComment[];
};

export type CourierComment = { by: string | null; text: string; at: string | null; fromUs: boolean };

/** Upaya's times ("2026-11-20 17:20:30") are Nepal time; this gives an ISO time, or null. */
export function upayaTime(value: string | null | undefined): string | null {
  const m = value?.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const date = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}+05:45`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** When a comment was made, as kept on the order (`Sale.courierCommentTimes`). */
export type CommentTime = { t: string; us: boolean; at: string };

export function readCommentTimes(raw: string | null | undefined): CommentTime[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter(e => e && typeof e.t === "string" && typeof e.at === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Gives each comment its time from the kept list. The same words can be said
 * twice, so each kept time is used once, oldest comment first.
 */
export function withCommentTimes(comments: CourierComment[], times: CommentTime[]): CourierComment[] {
  const used = new Set<number>();
  const timed = [...comments].reverse().map(c => {
    if (c.at) return c;
    const i = times.findIndex((e, j) => !used.has(j) && e.t === c.text && e.us === c.fromUs);
    if (i < 0) return c;
    used.add(i);
    return { ...c, at: times[i].at };
  });
  return timed.reverse();
}

/** A comment's time for people: "5:20 PM" today, "Yesterday 5:20 PM", else "18 Nov, 5:20 PM". */
export function commentTimeLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(new Date()) - day(d)) / 86_400_000);
  if (diff === 0) return time;
  if (diff === 1) return `Yesterday ${time}`;
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}, ${time}`;
}

/** When the order's latest comment was made, if Karmify knows. */
export function latestCommentTime(sale: { courierComment?: string | null; courierCommentBy?: string | null; courierCommentTimes?: string | null }) {
  if (!sale.courierComment) return null;
  const us = sale.courierCommentBy === "You";
  const times = readCommentTimes(sale.courierCommentTimes).filter(e => e.t === sale.courierComment && e.us === us);
  return times.at(-1)?.at ?? null;
}

/** Upaya doesn't publish a limit; this keeps a comment to a readable message. */
export const COURIER_COMMENT_MAX = 500;

export const DOOR_TO_DOOR = 3;
export const DOOR_TO_BRANCH = 9;

/** The two services a batch can use: almost every order is door to door, a few are collected from a branch. */
export const BATCH_COURIER_SERVICES = [
  { id: DOOR_TO_DOOR, label: "Door to door", short: "Door" },
  { id: DOOR_TO_BRANCH, label: "Door to branch", short: "Branch" },
] as const;

export const isCourierService = (id: number) => COURIER_SERVICES.some(s => Number(s.value) === id);

/** Upaya hubs that serve the Kathmandu valley: Kathmandu, Lalitpur and Bhaktapur. */
const VALLEY_HUB = /^(kathmandu hub|gongabu hub|radhe radhe|pharping hub|\[airport\] - kathmandu international airport)$/i;
export const isValleyHub = (hub?: string | null) => VALLEY_HUB.test((hub ?? "").replace(/\s+/g, " ").trim());

/**
 * Upaya locations served by those hubs, from Upaya's list (Nov 2026). Places
 * Upaya adds later come from its live list (see useValleyLocations).
 */
export const VALLEY_LOCATION_IDS: ReadonlySet<number> = new Set([
  779, 790, 792, 794, 1211, 1320, 1321, 1322, 1361, 1362, 1363, 1364, 1365, 1366, 1367, 1368, 1369, 1370, 1372, 1477,
  1519, 1521, 1522, 1523, 1524, 1525, 1527, 1537, 1619, 1684, 1690, 1708, 1710, 1904, 1905, 1906, 1907, 1908, 1909,
  1910, 1911, 1912, 1913, 1914, 2456, 2457, 3552, 3553,
]);

const VALLEY_DISTRICT = /\b(kathmandu|lalitpur|bhaktapur)\b/i;

/** Inside the Kathmandu valley, outside it, or no hub to tell by. */
export type Valley = "inside" | "outside" | "none";

export const VALLEY_LABELS: Record<Valley, string> = { inside: "Inside valley", outside: "Outside valley", none: "No hub set" };

/**
 * Which side of the valley an order goes to, by its Upaya hub location. Yango
 * only runs inside the valley. `live` adds valley locations from Upaya's
 * current list to the saved ones.
 */
export function valleyOf(
  sale: { courierLocationId: number | null; courierAreaTitle: string | null; deliveryVia?: string | null },
  live?: ReadonlySet<number> | null
): Valley {
  if (sale.deliveryVia) return "inside";
  const id = sale.courierLocationId;
  if (id) return VALLEY_LOCATION_IDS.has(id) || live?.has(id) || VALLEY_DISTRICT.test(sale.courierAreaTitle ?? "") ? "inside" : "outside";
  return VALLEY_DISTRICT.test(sale.courierAreaTitle ?? "") ? "inside" : "none";
}

/**
 * What Upaya collects on delivery. Paid orders (QR, or marked paid) collect
 * nothing; otherwise what's left to pay. Website imports don't record a COD
 * amount, and their total already includes delivery.
 */
export function courierCodAmount(sale: { paymentMethod: string; paymentStatus: string; codAmount: number; totalAmount: number }) {
  return codToCollect(sale);
}
