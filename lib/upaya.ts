import "server-only";

import { courierStatusSlug, sameCourierReference, type CourierArea, type CourierCategory, type CourierTracking } from "@/lib/courier";

// Client for the Upaya courier API. The key stays on the server: this module
// can't be imported by browser code, and neither the key nor request headers
// are ever logged.

const PRODUCTION_URL = "https://portal-api.upaya.com.np/api/v1/client";
const CACHE_MS = 24 * 60 * 60 * 1000;

/** `status` is null when no response arrived, so the outcome of a write is unknown. */
export class UpayaError extends Error {
  constructor(message: string, readonly status: number | null, readonly retryAfter: number | null = null) {
    super(message);
  }
}

/** True when a create-order call may have gone through despite the error. */
export const isUncertainOutcome = (err: unknown) =>
  err instanceof UpayaError && (err.status === null || err.status >= 500);

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function call<T>(path: string, options: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const key = process.env.UPAYA_API_KEY;
  if (!key) throw new UpayaError("The Upaya API key isn't set on this server.", 401);

  let res: Response;
  try {
    res = await fetch(`${process.env.UPAYA_BASE_URL || PRODUCTION_URL}${path}`, {
      method: options.method ?? "GET",
      headers: { "X-API-Key": key, Accept: "application/json", "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      cache: "no-store",
    });
  } catch {
    throw new UpayaError("Could not reach Upaya.", null);
  }

  const text = await res.text();
  let json: { errors?: { detail?: string }[]; message?: string } | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Upaya's server errors are HTML pages.
  }

  if (!res.ok) {
    const detail = json?.errors?.[0]?.detail ?? json?.message ?? "Upaya had a problem with this request.";
    console.error("[upaya]", options.method ?? "GET", path.split("?")[0], res.status, detail);
    throw new UpayaError(detail, res.status, Number(res.headers.get("retry-after")) || null);
  }
  if (json === null) throw new UpayaError("Upaya sent a response Karmify couldn't read.", null);
  return json as T;
}

/** Calls that change nothing are safe to repeat, so these ride out brief failures. */
async function read<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call<T>(path, options);
    } catch (err) {
      const retryable = err instanceof UpayaError && (err.status === 429 || err.status === null || err.status >= 500);
      if (!retryable || attempt >= 3) throw err;
      await sleep(err.status === 429 ? Math.min(err.retryAfter ?? 5, 20) * 1000 : 2000 * attempt);
    }
  }
}

type RawLocation = {
  id: number;
  hubName?: string;
  hub?: string;
  areas?: { id: number; name: string; searchTitle?: string }[];
};

type IndexedArea = CourierArea & { words: Set<string> };

let areaCache: { at: number; areas: IndexedArea[] } | null = null;
let areaLoad: Promise<IndexedArea[]> | null = null;

const wordsIn = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(word => word.length >= 2);

async function fetchAreas() {
  const { data } = await read<{ data: RawLocation[] }>("/locations");
  return data.flatMap(location => (location.areas ?? []).map(area => {
    const title = area.searchTitle || area.name;
    const hub = location.hubName ?? location.hub ?? null;
    return { areaId: area.id, locationId: location.id, title, hub, words: new Set(wordsIn(`${title} ${hub ?? ""}`)) };
  }));
}

/** The full list is about 2 MB, so it stays here and only matches go to the browser. */
function loadAreas(): Promise<IndexedArea[]> {
  if (areaCache && Date.now() - areaCache.at < CACHE_MS) return Promise.resolve(areaCache.areas);
  areaLoad ??= fetchAreas()
    .then(areas => {
      areaCache = { at: Date.now(), areas };
      return areas;
    })
    .catch(err => {
      if (areaCache) return areaCache.areas; // Yesterday's list beats no list.
      throw err;
    })
    .finally(() => {
      areaLoad = null;
    });
  return areaLoad;
}

const publicArea = ({ areaId, locationId, title, hub }: IndexedArea): CourierArea => ({ areaId, locationId, title, hub });

export async function searchAreas(query: string, limit = 20): Promise<CourierArea[]> {
  const typed = wordsIn(query);
  if (typed.length === 0) return [];
  const areas = await loadAreas();
  const matches = (area: IndexedArea, word: string) => [...area.words].some(w => w.startsWith(word));
  return areas
    .filter(area => typed.every(word => matches(area, word)))
    .sort((a, b) => a.title.length - b.title.length)
    .slice(0, limit)
    .map(publicArea);
}

/** Areas named in a free-text address, with rarer place names counting for more. */
export async function suggestAreas(address: string, limit = 6): Promise<CourierArea[]> {
  const words = [...new Set(wordsIn(address).filter(word => word.length >= 4))];
  if (words.length === 0) return [];
  const areas = await loadAreas();
  const weight = new Map(words.map(word => [word, 1 / Math.max(1, areas.filter(area => area.words.has(word)).length)]));
  return areas
    .map(area => ({ area, score: words.reduce((sum, word) => sum + (area.words.has(word) ? weight.get(word) ?? 0 : 0), 0) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.area.title.length - b.area.title.length)
    .slice(0, limit)
    .map(entry => publicArea(entry.area));
}

let categoryCache: { at: number; categories: CourierCategory[] } | null = null;

export async function getCategories(): Promise<CourierCategory[]> {
  if (categoryCache && Date.now() - categoryCache.at < CACHE_MS) return categoryCache.categories;
  const { data } = await read<{ data: { productCategories: Record<string, string> } }>("/productCategories");
  const categories = Object.entries(data.productCategories)
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  categoryCache = { at: Date.now(), categories };
  return categories;
}

/** An estimate only. Not retried, because nothing depends on it. */
export async function getRate(locationId: number, weight: number, serviceTypeId: number) {
  const { data } = await call<{ data: { totalDeliveryCharge?: number } }>("/order-rates", {
    method: "POST",
    timeoutMs: 10_000,
    body: { initial_weight: weight, location_id: locationId, service_type_id: serviceTypeId, order_type: "delivery_order", length: 1, breadth: 1, height: 1 },
  });
  return typeof data.totalDeliveryCharge === "number" ? data.totalDeliveryCharge : null;
}

/** Sent once only: a repeat would book a second pickup. See bookCourierOrder. */
export async function createOrder(order: Record<string, unknown>) {
  const { data } = await call<{ data: { data?: { trackingCode?: string }[] } }>("/add-order", {
    method: "POST",
    body: { orders: [order] },
  });
  const trackingCode = data.data?.[0]?.trackingCode;
  if (!trackingCode) throw new UpayaError("Upaya didn't return a tracking code.", null);
  return trackingCode;
}

const text = (value: unknown) => {
  const clean = typeof value === "string" ? value.trim() : "";
  return clean && clean !== "N/A" ? clean : null;
};

const amount = (value: unknown) => {
  const parsed = Number(value);
  return value !== null && value !== "" && Number.isFinite(parsed) ? parsed : null;
};

type RawTracking = {
  orderId: string;
  refId?: string;
  status?: string;
  createdDate?: string;
  latestUpdateDate?: string;
  areaName?: string;
  receiverHub?: string;
  codAmount?: number | string;
  codSettlementStatus?: string;
  serviceCharge?: number | string;
  serviceChargeStatus?: string;
  trackingHistory?: { createdAt?: string; status?: string; activityBy?: string; hubName?: string; actionRemarks?: string }[];
};

export async function trackOrder(trackingCode: string): Promise<CourierTracking> {
  const { data } = await read<{ data: RawTracking }>(`/track-order/${encodeURIComponent(trackingCode)}`);
  const status = text(data.status);
  return {
    trackingCode: data.orderId || trackingCode,
    referenceId: text(data.refId),
    status: status ? courierStatusSlug(status) : null,
    createdDate: text(data.createdDate),
    latestUpdate: text(data.latestUpdateDate),
    area: text(data.areaName),
    hub: text(data.receiverHub),
    codAmount: amount(data.codAmount),
    codSettlement: text(data.codSettlementStatus),
    serviceCharge: amount(data.serviceCharge),
    serviceChargeStatus: text(data.serviceChargeStatus),
    history: (data.trackingHistory ?? []).map(entry => ({
      at: text(entry.createdAt),
      status: text(entry.status),
      by: text(entry.activityBy),
      hub: text(entry.hubName),
      remarks: text(entry.actionRemarks),
    })),
  };
}

/**
 * The live order booked under a reference, or null. Upaya's keyword search is a
 * loose text match and its list doesn't include references, so each hit is
 * confirmed against its own tracking record.
 */
export async function findOrderByReference(reference: string): Promise<CourierTracking | null> {
  const list = await read<{ data?: { trackingCode: string; currentStatus?: string }[] }>(
    `/order-lists?keyword=${encodeURIComponent(reference)}`
  );
  for (const row of (list.data ?? []).filter(order => order.currentStatus !== "cancelled").slice(0, 10)) {
    const tracking = await trackOrder(row.trackingCode);
    if (sameCourierReference(tracking.referenceId, reference)) return tracking;
  }
  return null;
}
