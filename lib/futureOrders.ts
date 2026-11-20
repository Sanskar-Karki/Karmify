import type { SaleInput } from "@/lib/actions/sales";

// Future orders come in two kinds (the actions are in lib/actions/futureOrders.ts):
//   restock    Not all in stock yet: any size or colour. Whatever is on the shelf when
//              it's saved is set aside then; the rest is taken once restocked.
//   scheduled  In stock, but the customer wants it sent on a later date: all of its
//              stock is set aside when it's saved.
// Set-aside units are out of stock, so nobody else can buy them meanwhile.
// Neither is a sale until "Move to orders", so neither counts in revenue or Analytics.

export type FutureKind = "restock" | "scheduled";
export type FutureMode = "walkin" | "delivery" | "pr";

export type FutureLine = {
  productId: string;
  variantId: string | null;
  name: string;
  variantLabel: string | null;
  quantity: number;
  /** The price charged for one. */
  unitPrice: number;
  /** Units taken out of stock when the order was saved (0 to quantity). Read it with setAsideByLine(). */
  setAside?: number;
};

/** What a FutureOrder row keeps in its `data` column. */
export type FutureOrderData = {
  sale: SaleInput;
  lines: FutureLine[];
  mode: FutureMode;
  /** Delivery: what the customer has already paid up front. */
  advance: number;
  /** Missing on future orders saved before scheduled ones existed: those are all "restock". */
  kind?: FutureKind;
  /** Scheduled: the Nepal date (YYYY-MM-DD) the customer wants it sent on. */
  sendOn?: string | null;
  /** The warehouse stock was set aside from when it was saved; null when nothing was. */
  setAsideFrom?: string | null;
};

export const futureKindOf = (data: Pick<FutureOrderData, "kind">): FutureKind => (data.kind === "scheduled" ? "scheduled" : "restock");

/**
 * Units of each line (in `lines` order, the same as `sale.items`) taken out of stock
 * when the order was saved. Saved before this was kept per line: a scheduled order
 * set everything aside, one waiting for stock nothing.
 */
export function setAsideByLine(data: Pick<FutureOrderData, "kind" | "setAsideFrom" | "lines">): number[] {
  const tookStock = typeof data.setAsideFrom === "string" && data.setAsideFrom.length > 0;
  return data.lines.map(line => {
    if (!tookStock) return 0;
    if (Number.isInteger(line.setAside)) return Math.min(Math.max(line.setAside!, 0), line.quantity);
    return data.kind === "scheduled" ? line.quantity : 0;
  });
}

/** The furthest ahead a send date can be. */
export const MAX_DAYS_AHEAD = 366;

const DAY_MS = 86_400_000;
const atUtcMidnight = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`);

/** Today in Nepal, as YYYY-MM-DD. */
export const nepalToday = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kathmandu" }).format(now);

/** A real calendar date written as YYYY-MM-DD (so not 2026-02-30). */
export const isYmd = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(atUtcMidnight(value)).toISOString().startsWith(value);

export const addDays = (ymd: string, days: number) => new Date(atUtcMidnight(ymd) + days * DAY_MS).toISOString().slice(0, 10);

/** Days from today (Nepal) to the date: 0 today, 1 tomorrow, negative once it's passed. */
export const daysUntil = (ymd: string, today = nepalToday()) => Math.round((atUtcMidnight(ymd) - atUtcMidnight(today)) / DAY_MS);

/** "Tue 25 Nov" (with the year when it isn't this year's). */
export function sendOnLabel(ymd: string, today = nepalToday()) {
  const sameYear = ymd.slice(0, 4) === today.slice(0, 4);
  return new Date(atUtcMidnight(ymd)).toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC",
  });
}

/** How soon it's due, for the list: "due today", "in 3 days", "2 days late". */
export function dueLabel(ymd: string, today = nepalToday()) {
  const days = daysUntil(ymd, today);
  if (days === 0) return "due today";
  if (days === 1) return "tomorrow";
  if (days > 1) return `in ${days} days`;
  return days === -1 ? "1 day late" : `${-days} days late`;
}

/** The same products, sizes and quantities, in any order. */
export function sameLines(a: SaleInput["items"], b: SaleInput["items"]) {
  const key = (items: SaleInput["items"]) => items.map(i => `${i.productId}|${i.variantId ?? ""}|${i.quantity}`).sort().join("\n");
  return key(a) === key(b);
}
