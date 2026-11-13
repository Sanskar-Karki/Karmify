import { countsAsSale, customerKey, itemOptions } from "@/lib/orders";

// Sales analytics, worked out in the browser from the orders Karmify already
// loads. Kept free of React so it can be tested on its own.

type AnalyticsSale = {
  id: string;
  createdAt: Date | string;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  customer: { code: string } | null;
  customerAddress: string | null;
  courierTrackingCode: string | null;
  discount: number;
  deliveryAmount: number;
  paymentMethod: string;
  paymentStatus: string;
  deliveryStatus: string;
  source: string;
  brand: string | null;
  courierAreaTitle: string | null;
  items: { productId: string; quantity: number; unitPrice: number; variant: string | null; product: { name: string } }[];
};
type AnalyticsProduct = { id: string; name: string; costPrice: number; categoryId: string };
type AnalyticsCategory = { id: string; name: string };

export type RangeKey = "today" | "7d" | "30d" | "90d" | "month" | "lastMonth" | "year" | "all" | "custom";
export const RANGES: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "month", label: "This month" },
  { key: "lastMonth", label: "Last month" },
  { key: "year", label: "This year" },
  { key: "all", label: "All time" },
];

type Bucket = "hour" | "day" | "week" | "month";
export type Period = { start: Date; end: Date; prevStart: Date | null; prevEnd: Date | null; bucket: Bucket };

const DAY = 24 * 60 * 60 * 1000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Day buckets for short spans, weeks for a few months, months beyond that. */
const bucketForDays = (days: number): Bucket => (days > 120 ? "month" : days > 45 ? "week" : "day");

/**
 * The chosen range and the one just before it, of the same length, to compare
 * against. "custom" covers whole days from custom.start to custom.end.
 */
export function periodFor(key: RangeKey, now: Date, earliest: Date | null, custom?: { start: Date; end: Date }): Period {
  const tomorrow = addDays(startOfDay(now), 1);
  const rolling = (days: number, bucket: Bucket): Period => {
    const start = addDays(tomorrow, -days);
    return { start, end: tomorrow, prevStart: addDays(start, -days), prevEnd: start, bucket };
  };
  switch (key) {
    case "today": {
      const start = startOfDay(now);
      return { start, end: tomorrow, prevStart: addDays(start, -1), prevEnd: start, bucket: "hour" };
    }
    case "7d": return rolling(7, "day");
    case "30d": return rolling(30, "day");
    case "90d": return rolling(90, "week");
    case "month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start, end: tomorrow, prevStart: new Date(now.getFullYear(), now.getMonth() - 1, 1), prevEnd: start, bucket: "day" };
    }
    case "lastMonth": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start, end, prevStart: new Date(now.getFullYear(), now.getMonth() - 2, 1), prevEnd: start, bucket: "day" };
    }
    case "year": {
      const start = new Date(now.getFullYear(), 0, 1);
      return { start, end: tomorrow, prevStart: new Date(now.getFullYear() - 1, 0, 1), prevEnd: start, bucket: "month" };
    }
    case "custom": {
      if (!custom) return periodFor("30d", now, earliest);
      const start = startOfDay(custom.start);
      const end = addDays(startOfDay(custom.end), 1);
      const days = Math.round((end.getTime() - start.getTime()) / DAY);
      return { start, end, prevStart: addDays(start, -days), prevEnd: start, bucket: bucketForDays(days) };
    }
    case "all": {
      const start = startOfDay(earliest ?? now);
      const days = (tomorrow.getTime() - start.getTime()) / DAY;
      return { start, end: tomorrow, prevStart: null, prevEnd: null, bucket: bucketForDays(days) };
    }
  }
}

/** Product sales on an order: line prices less the order's discount. Delivery is counted separately. */
export const goodsValue = (sale: Pick<AnalyticsSale, "items" | "discount">) =>
  sale.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0) - (sale.discount || 0);

const isReturn = (status: string) => status === "RETURNED" || status === "RETURN_PROCESS";

export type Totals = {
  sales: number; orders: number; averageOrder: number; units: number;
  grossProfit: number; unitsWithoutCost: number; discounts: number; delivery: number;
  returns: number; returnedOrders: number; returnRate: number; cancelledOrders: number;
  awaitingPayment: number; repeatShare: number;
};

function totalsFor(sales: AnalyticsSale[], costOf: Map<string, number>, orderCountByCustomer: Map<string, number>): Totals {
  const counted = sales.filter(countsAsSale);
  let goods = 0, units = 0, cost = 0, unitsWithoutCost = 0, discounts = 0, delivery = 0, returns = 0, returnedOrders = 0, awaiting = 0, repeatOrders = 0;
  for (const sale of counted) {
    const value = goodsValue(sale);
    goods += value;
    discounts += sale.discount || 0;
    delivery += sale.deliveryAmount || 0;
    for (const item of sale.items) {
      units += item.quantity;
      const unitCost = costOf.get(item.productId) ?? 0;
      if (unitCost > 0) cost += unitCost * item.quantity;
      else unitsWithoutCost += item.quantity;
    }
    if (isReturn(sale.deliveryStatus)) {
      returns += value;
      returnedOrders += 1;
    } else if (sale.paymentStatus !== "PAID") {
      awaiting += value + (sale.deliveryAmount || 0);
    }
    if ((orderCountByCustomer.get(customerKey(sale)) ?? 0) > 1) repeatOrders += 1;
  }
  const orders = counted.length;
  return {
    sales: goods, orders, averageOrder: orders ? goods / orders : 0, units,
    grossProfit: goods - cost, unitsWithoutCost, discounts, delivery,
    returns, returnedOrders, returnRate: orders ? returnedOrders / orders : 0,
    cancelledOrders: sales.length - counted.length,
    awaitingPayment: awaiting, repeatShare: orders ? repeatOrders / orders : 0,
  };
}

const inPeriod = (sale: AnalyticsSale, start: Date, end: Date) => {
  const t = new Date(sale.createdAt).getTime();
  return t >= start.getTime() && t < end.getTime();
};

function bucketStart(d: Date, bucket: Bucket) {
  if (bucket === "hour") return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours());
  if (bucket === "month") return new Date(d.getFullYear(), d.getMonth(), 1);
  const day = startOfDay(d);
  if (bucket === "week") return addDays(day, -((day.getDay() + 6) % 7)); // weeks start on Monday
  return day;
}
function nextBucket(d: Date, bucket: Bucket) {
  if (bucket === "hour") return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1);
  if (bucket === "month") return new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return addDays(d, bucket === "week" ? 7 : 1);
}
function bucketLabel(d: Date, bucket: Bucket) {
  if (bucket === "hour") return `${d.getHours() % 12 === 0 ? 12 : d.getHours() % 12}${d.getHours() < 12 ? "am" : "pm"}`;
  if (bucket === "month") return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export type ChannelKey = "website" | "upaya" | "store" | "delivery";
export const CHANNEL_LABELS: Record<ChannelKey, string> = {
  website: "Website orders",
  upaya: "Upaya delivery",
  store: "In store",
  delivery: "Other shop delivery",
};
export const CHANNEL_NOTES: Record<ChannelKey, string> = {
  website: "Placed on karmaluoriginals.com",
  upaya: "Shop orders sent with Upaya",
  store: "Walk-in sales at the till",
  delivery: "Shop deliveries not sent with Upaya",
};

/** Which channel an order belongs to. Website orders stay "website" even when Upaya delivers them. */
export function channelOf(sale: Pick<AnalyticsSale, "source" | "courierTrackingCode" | "customerAddress" | "deliveryAmount">): ChannelKey {
  if (sale.source === "website") return "website";
  if (sale.courierTrackingCode) return "upaya";
  if (!sale.customerAddress?.trim() && !(sale.deliveryAmount > 0)) return "store";
  return "delivery";
}

export type ChannelRow = { key: ChannelKey; label: string; note: string; sales: number; orders: number; previousSales: number | null; previousOrders: number | null };

function channelTotals(sales: AnalyticsSale[]) {
  const out = new Map<ChannelKey, { sales: number; orders: number }>();
  for (const sale of sales.filter(countsAsSale)) {
    const key = channelOf(sale);
    const row = out.get(key) ?? { sales: 0, orders: 0 };
    row.sales += goodsValue(sale);
    row.orders += 1;
    out.set(key, row);
  }
  return out;
}

export type TrendPoint = { label: string; sales: number; orders: number; previous: number | null };
export type Ranked = { key: string; label: string; value: number; secondary?: number; href?: string };

export type Analytics = {
  totals: Totals;
  previous: Totals | null;
  trend: TrendPoint[];
  topProducts: Ranked[];
  categories: Ranked[];
  channels: ChannelRow[];
  /** Website orders that Upaya delivers (they count under "Website orders"). */
  websiteViaUpaya: number;
  brands: Ranked[];
  payment: Ranked[];
  outcomes: { status: string; orders: number }[];
  weekdays: Ranked[];
  hours: Ranked[];
  sizes: Ranked[];
  colours: Ranked[];
  customers: Ranked[];
  areas: Ranked[];
};

function rank(map: Map<string, { label: string; value: number; secondary?: number; href?: string }>, limit?: number): Ranked[] {
  const rows = [...map.entries()].map(([key, row]) => ({ key, ...row })).sort((a, b) => b.value - a.value);
  return limit ? rows.slice(0, limit) : rows;
}
function add(map: Map<string, { label: string; value: number; secondary?: number; href?: string }>, key: string, label: string, value: number, secondary = 0, href?: string) {
  const row = map.get(key) ?? { label, value: 0, secondary: 0, href };
  row.value += value;
  row.secondary = (row.secondary ?? 0) + secondary;
  map.set(key, row);
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const titleCase = (s: string) => s.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

export function buildAnalytics(
  allSales: AnalyticsSale[],
  products: AnalyticsProduct[],
  categories: AnalyticsCategory[],
  period: Period,
): Analytics {
  const costOf = new Map(products.map(p => [p.id, p.costPrice]));
  const categoryOf = new Map(products.map(p => [p.id, p.categoryId]));
  const categoryName = new Map(categories.map(c => [c.id, c.name]));
  // "Repeat" is judged on the whole history: someone's second order counts even if the first was long ago.
  const orderCountByCustomer = new Map<string, number>();
  for (const sale of allSales.filter(countsAsSale)) {
    if (!sale.customerName && !sale.customerPhone && !sale.customerEmail) continue;
    const key = customerKey(sale);
    orderCountByCustomer.set(key, (orderCountByCustomer.get(key) ?? 0) + 1);
  }

  const current = allSales.filter(s => inPeriod(s, period.start, period.end));
  const before = period.prevStart && period.prevEnd ? allSales.filter(s => inPeriod(s, period.prevStart!, period.prevEnd!)) : null;
  const counted = current.filter(countsAsSale);

  // Sales over time, with the previous period laid over it bucket by bucket.
  const trend: TrendPoint[] = [];
  const index = new Map<number, number>();
  for (let b = bucketStart(period.start, period.bucket); b < period.end; b = nextBucket(b, period.bucket)) {
    index.set(b.getTime(), trend.length);
    trend.push({ label: bucketLabel(b, period.bucket), sales: 0, orders: 0, previous: before ? 0 : null });
  }
  for (const sale of counted) {
    const i = index.get(bucketStart(new Date(sale.createdAt), period.bucket).getTime());
    if (i === undefined) continue;
    trend[i].sales += goodsValue(sale);
    trend[i].orders += 1;
  }
  if (before && period.prevStart) {
    const prevBuckets: number[] = [];
    for (let b = bucketStart(period.prevStart, period.bucket); b < period.prevEnd!; b = nextBucket(b, period.bucket)) prevBuckets.push(b.getTime());
    const prevIndex = new Map(prevBuckets.map((t, i) => [t, i]));
    for (const sale of before.filter(countsAsSale)) {
      const i = prevIndex.get(bucketStart(new Date(sale.createdAt), period.bucket).getTime());
      if (i !== undefined && i < trend.length) trend[i].previous = (trend[i].previous ?? 0) + goodsValue(sale);
    }
  }

  const productMap = new Map(), categoryMap = new Map(), brandMap = new Map(), paymentMap = new Map();
  const sizeMap = new Map(), colourMap = new Map(), customerMap = new Map(), areaMap = new Map();
  const weekdayCounts = WEEKDAYS.map(() => 0);
  const hourCounts = Array.from({ length: 24 }, () => 0);
  for (const sale of counted) {
    const value = goodsValue(sale);
    const lines = sale.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0) || 1;
    for (const item of sale.items) {
      // The order discount is shared across its lines by value.
      const lineValue = item.quantity * item.unitPrice * (value / lines);
      add(productMap, item.productId, item.product.name, lineValue, item.quantity);
      const categoryId = categoryOf.get(item.productId);
      add(categoryMap, categoryId ?? "none", categoryName.get(categoryId ?? "") ?? "Uncategorised", lineValue, item.quantity);
      const { size, color } = itemOptions(item);
      if (size) add(sizeMap, size.toUpperCase(), size.toUpperCase(), item.quantity);
      if (color) add(colourMap, color.toLowerCase(), titleCase(color), item.quantity);
    }
    add(brandMap, sale.brand ?? "none", sale.brand === "decor" ? "Living & Decor" : sale.brand === "originals" ? "Originals" : "Not set", value, 1);
    add(paymentMap, sale.paymentMethod, sale.paymentMethod === "QR" ? "QR payment" : "Cash on delivery", value, 1);
    if (sale.customerName || sale.customerPhone || sale.customerEmail) {
      const key = customerKey(sale);
      add(customerMap, key, sale.customerName || sale.customerPhone || "Customer", value, 1, `/customers/${encodeURIComponent(key)}`);
    }
    if (sale.courierAreaTitle) {
      const area = sale.courierAreaTitle.split(" · ")[0].trim();
      add(areaMap, area.toLowerCase(), area, 1, value);
    }
    const created = new Date(sale.createdAt);
    weekdayCounts[(created.getDay() + 6) % 7] += 1;
    hourCounts[created.getHours()] += 1;
  }

  const outcomeCounts = new Map<string, number>();
  for (const sale of current) outcomeCounts.set(sale.deliveryStatus, (outcomeCounts.get(sale.deliveryStatus) ?? 0) + 1);

  return {
    totals: totalsFor(current, costOf, orderCountByCustomer),
    previous: before ? totalsFor(before, costOf, orderCountByCustomer) : null,
    trend,
    topProducts: rank(productMap, 8),
    categories: rank(categoryMap, 8),
    channels: (() => {
      const now = channelTotals(current);
      const then = before ? channelTotals(before) : null;
      return (Object.keys(CHANNEL_LABELS) as ChannelKey[])
        // "Other shop delivery" only appears when there is some.
        .filter(key => key !== "delivery" || now.has(key) || then?.has(key))
        .map(key => ({
          key, label: CHANNEL_LABELS[key], note: CHANNEL_NOTES[key],
          sales: now.get(key)?.sales ?? 0, orders: now.get(key)?.orders ?? 0,
          previousSales: then ? then.get(key)?.sales ?? 0 : null,
          previousOrders: then ? then.get(key)?.orders ?? 0 : null,
        }));
    })(),
    websiteViaUpaya: counted.filter(sale => sale.source === "website" && sale.courierTrackingCode).length,
    brands: rank(brandMap),
    payment: rank(paymentMap),
    outcomes: ["DELIVERED", "IN_PROCESS", "RETURN_PROCESS", "RETURNED", "CANCELLED"].map(status => ({ status, orders: outcomeCounts.get(status) ?? 0 })),
    weekdays: WEEKDAYS.map((label, i) => ({ key: label, label, value: weekdayCounts[i] })),
    hours: hourCounts.map((value, h) => ({ key: String(h), label: `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "am" : "pm"}`, value })),
    sizes: rank(sizeMap, 8),
    colours: rank(colourMap, 8),
    customers: rank(customerMap, 8),
    areas: rank(areaMap, 8),
  };
}

/** Change from the previous period, as a fraction (0.12 = +12%), or null when there's nothing to compare with. */
export function change(now: number, before: number | undefined | null) {
  if (before === undefined || before === null) return null;
  if (before === 0) return now === 0 ? 0 : null;
  return (now - before) / Math.abs(before);
}
