import type { Sale } from "@/lib/types";
import { normalizePhone } from "@/lib/customerIdentity";

// Display metadata and grouping shared by the order and customer pages.

/** Title of the notification a new website order raises. */
export const WEBSITE_ORDER_NOTIFICATION = "New website order";

// Letter sizes (XS…5XL), numbers (32, 32W, 10.5) and "free/one size": how a lone
// "L" or "Navy" on a sale line is told apart.
const SIZE_LIKE = /^(x{0,3}s|m|x{0,4}l|\d\s*x{1,2}l|\d+(\.\d+)?\s*[a-z]{0,3}|free\s*size|one\s*size)$/i;

/**
 * A sale line's size and colour, read from its stored text: "L · Navy" (size
 * first, as both POS sales and website orders write it), or just "L" / "Navy".
 */
export function itemOptions(item: { variant?: string | null }): { size: string; color: string } {
  const parts = (item.variant ?? "").split("·").map(part => part.trim()).filter(Boolean);
  if (parts.length === 0) return { size: "", color: "" };
  if (parts.length === 1) return SIZE_LIKE.test(parts[0]) ? { size: parts[0], color: "" } : { size: "", color: parts[0] };
  return { size: parts[0], color: parts.slice(1).join(" · ") };
}

/** "Colour: Navy · Size: L": only what's set; "" when neither. */
export function optionsText(size?: string | null, color?: string | null, separator = " · ") {
  return [color?.trim() && `Colour: ${color.trim()}`, size?.trim() && `Size: ${size.trim()}`].filter(Boolean).join(separator);
}

/** A sale line's colour and size spelled out, e.g. "Colour: Navy · Size: L". */
export function itemOptionsText(item: { variant?: string | null }, separator = " · ") {
  const { size, color } = itemOptions(item);
  return optionsText(size, color, separator);
}

/** "Dual Tone Hoodie (Colour: Navy, Size: L)": the product plus the colour and size chosen, on one line. */
export function itemName(item: { variant?: string | null; product: { name: string } }) {
  const options = itemOptionsText(item, ", ");
  return options ? `${item.product.name} (${options})` : item.product.name;
}

export const DELIVERY_STATUSES = [
  { value: "IN_PROCESS", label: "In Process" },
  { value: "DELIVERED", label: "Delivered" },
  { value: "RETURN_PROCESS", label: "Return Process" },
  { value: "RETURNED", label: "Returned" },
  { value: "CANCELLED", label: "Cancelled" },
];

/** Cancelled orders never happened, so they stay out of revenue totals. */
/** Counts toward sales and revenue: not cancelled, and not a PR give-away (stock went out, no money came in). */
export const countsAsSale = (sale: { deliveryStatus?: string | null; kind?: string | null }) =>
  sale.deliveryStatus !== "CANCELLED" && sale.kind !== "pr";

/** A PR order: given free to someone for promotion. */
export const isPR = (sale: { kind?: string | null }) => sale.kind === "pr";

/** Walk-in orders paid at the till and sent with a ride app the shop books (only Yango for now). */
export const INSTANT_COURIERS = [
  { value: "yango", label: "Yango" },
] as const;
export type InstantCourier = (typeof INSTANT_COURIERS)[number]["value"];
export const isInstantCourier = (value: unknown): value is InstantCourier =>
  INSTANT_COURIERS.some(c => c.value === value);
/** "Yango" for "yango"; null when the order wasn't sent with a ride app. */
export const instantCourierLabel = (value?: string | null) => INSTANT_COURIERS.find(c => c.value === value)?.label ?? null;

export const DELIVERY_STYLES: Record<string, string> = {
  IN_PROCESS: "bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400",
  DELIVERED: "bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400",
  RETURN_PROCESS: "bg-orange-100 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400",
  RETURNED: "bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400",
  CANCELLED: "bg-zinc-200 dark:bg-zinc-800/60 text-zinc-600 dark:text-zinc-300",
};

/** Handed to Upaya (booked, and not cancelled there), whatever its status is now. */
export const sentWithUpaya = (sale: { courierTrackingCode?: string | null; courierStatus?: string | null }) =>
  Boolean(sale.courierTrackingCode) && sale.courierStatus !== "cancelled";
/** Green outline on the status of an order already sent with Upaya: a solid edge plus a soft halo. */
export const SENT_STATUS_BORDER =
  "border-emerald-500 hover:border-emerald-600 ring-2 ring-emerald-500/25 shadow-[0_0_0_1px_rgb(16_185_129/0.15),0_1px_6px_rgb(16_185_129/0.35)] dark:border-emerald-400 dark:hover:border-emerald-300 dark:ring-emerald-400/25";

export const PAYMENT_STYLES: Record<string, string> = {
  UNPAID: "bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400",
  PARTIAL: "bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400",
  PAID: "bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400",
};

/**
 * Cash the rider still has to collect. Nothing for orders paid up front (cash at
 * the till, QR) or once a COD order is paid. Website imports don't record a COD
 * amount, so their total is what's due.
 */
export const codToCollect = (sale: { paymentMethod: string; paymentStatus?: string | null; codAmount: number; totalAmount: number }) =>
  sale.paymentMethod !== "COD" || sale.paymentStatus === "PAID" ? 0 : sale.codAmount || sale.totalAmount;

const SITE_NAMES: Record<string, string> = { instagram: "Instagram", ig: "Instagram", facebook: "Facebook", fb: "Facebook", meta: "Meta", tiktok: "TikTok", google: "Google", youtube: "YouTube", whatsapp: "WhatsApp" };
const PAID = /^(paid|cpc|ppc|ads?|paid[_ -]?social|sponsored)$/i;

/** True when a website order came from a paid ad (UTM medium "paid", "cpc"…). */
export const isFromAd = (referral?: string | null) => Boolean(referral && PAID.test(referral.split(" · ")[1] ?? ""));

/** "Instagram ad", "Facebook", "Google search"…, from Sale.referral; null when unknown. */
export function referralLabel(referral?: string | null) {
  if (!referral) return null;
  const [source = "", medium = ""] = referral.split(" · ");
  const site = SITE_NAMES[source.toLowerCase()] ?? source;
  if (PAID.test(medium)) return `${site} ad`;
  if (medium === "search") return `${site} search`;
  return site;
}

/** Website imports prefix the address with a "[Brand]" tag that isn't part of it. */
export const deliveryAddress = (address?: string | null) => (address ?? "").replace(/^\[[^\]]*\]\s*/, "");

type CustomerFields = {
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerName?: string | null;
  customer?: { code: string } | null;
};

/** The key customer pages used before customer IDs, so saved links keep working. */
export function contactKey(sale: CustomerFields) {
  return (sale.customerEmail || sale.customerPhone || sale.customerName || "unknown").toLowerCase();
}

/** What orders are grouped under, and the customer page's URL key. */
export function customerKey(sale: CustomerFields) {
  return sale.customer?.code ?? contactKey(sale);
}

export type Customer = {
  key: string;
  code: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  orderCount: number;
  totalSpent: number;
  sales: Sale[];
};

/** A customer already in Karmify whose name or phone is what's being typed. */
export type CustomerMatch = {
  customerId: string;
  code: string;
  name: string;
  phone: string | null;
  address: string | null;
  orders: number;
  lastOrderAt: Date | string;
  /** "phone" when a phone number matches (more certain), else "name". */
  by: "phone" | "name";
};

type MatchSale = {
  customerId: string | null;
  customer?: { code: string } | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  createdAt: Date | string;
};

const plainName = (name?: string | null) => (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Customers with the same phone or the same full name as what's typed, from
 * orders newest first. Phone matches come first, then whoever ordered most.
 */
export function findCustomerMatches(sales: MatchSale[], typed: { name: string; phone: string }, limit = 3): CustomerMatch[] {
  const name = plainName(typed.name);
  const phone = normalizePhone(typed.phone);
  const byName = name.length >= 3 && name !== "walk-in customer";
  if (!byName && !phone) return [];

  const found = new Map<string, CustomerMatch>();
  const counts = new Map<string, number>();
  const latest = new Map<string, MatchSale>();
  for (const sale of sales) {
    if (!sale.customerId || !sale.customer?.code) continue;
    counts.set(sale.customerId, (counts.get(sale.customerId) ?? 0) + 1);
    if (!latest.has(sale.customerId)) latest.set(sale.customerId, sale);
    const by = phone && normalizePhone(sale.customerPhone) === phone ? "phone" : byName && plainName(sale.customerName) === name ? "name" : null;
    const known = found.get(sale.customerId);
    if (by && (!known || (by === "phone" && known.by === "name"))) {
      found.set(sale.customerId, { customerId: sale.customerId, code: sale.customer.code, name: "", phone: null, address: null, orders: 0, lastOrderAt: sale.createdAt, by });
    }
  }
  return [...found.values()]
    .map(match => {
      // Their details as of their latest order; earlier orders fill any gaps.
      const theirs = sales.filter(s => s.customerId === match.customerId);
      const first = <K extends "customerName" | "customerPhone" | "customerAddress">(key: K) =>
        theirs.find(s => (s[key] ?? "").trim())?.[key]?.trim() || null;
      return {
        ...match,
        name: first("customerName") ?? "Customer",
        phone: first("customerPhone"),
        address: deliveryAddress(first("customerAddress")) || null,
        orders: counts.get(match.customerId) ?? 0,
        lastOrderAt: latest.get(match.customerId)!.createdAt,
      };
    })
    .sort((a, b) => (a.by === b.by ? b.orders - a.orders : a.by === "phone" ? -1 : 1))
    .slice(0, limit);
}

/** Rolls orders (newest first) up into customers, most recent customer first. */
export function groupSalesByCustomer(sales: Sale[]): Customer[] {
  const customers = new Map<string, Customer>();

  for (const sale of sales) {
    if (!sale.customerEmail && !sale.customerPhone && !sale.customerName) continue;

    const key = customerKey(sale);
    const existing = customers.get(key);
    if (existing) {
      existing.orderCount += 1;
      existing.totalSpent += sale.totalAmount;
      existing.sales.push(sale);
      existing.email ??= sale.customerEmail;
      existing.phone ??= sale.customerPhone;
      existing.address ??= sale.customerAddress;
      if (existing.name === "Walk-in Customer" && sale.customerName) existing.name = sale.customerName;
    } else {
      customers.set(key, {
        key,
        code: sale.customer?.code ?? null,
        name: sale.customerName || "Walk-in Customer",
        email: sale.customerEmail || null,
        phone: sale.customerPhone || null,
        address: sale.customerAddress || null,
        orderCount: 1,
        totalSpent: sale.totalAmount,
        sales: [sale],
      });
    }
  }

  return Array.from(customers.values());
}
