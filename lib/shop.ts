"use client";

import { useSyncExternalStore } from "react";
import { getCached } from "@/lib/resourceCache";

// Which shop the dashboard shows: Karmalu Originals, Karmalu Living & Decor, or both.
// Karmify always opens on Originals; a switch lasts until the tab is closed
// (sessionStorage), so the next visit starts on Originals again. Pages don't filter themselves: useResources
// applies filterForShop to products, sales, stock and movements for them.

export type Shop = "all" | "originals" | "decor";
export type ShopName = Exclude<Shop, "all">;

export const SHOP_LABELS: Record<Shop, string> = { all: "All shops", originals: "Originals", decor: "Living & Decor" };
/** The product "brand" text that puts a product in a shop. */
export const SHOP_BRAND: Record<ShopName, string> = { originals: "Karmalu Originals", decor: "Karmalu Living & Decor" };

const STORAGE_KEY = "karmify_shop";
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function readShop(): Shop {
  try {
    const value = sessionStorage.getItem(STORAGE_KEY);
    return value === "all" || value === "decor" ? value : "originals";
  } catch {
    return "originals";
  }
}

export function useShop(): Shop {
  return useSyncExternalStore(subscribe, readShop, () => "originals");
}

export function setShop(shop: Shop) {
  try {
    sessionStorage.setItem(STORAGE_KEY, shop);
  } catch {
    // Storage blocked: stays on Originals.
  }
  listeners.forEach(listener => listener());
}

/** A product's shop from its brand text ("Karmalu Originals" → originals); null = not set. */
export function productShop(brand: string | null | undefined): ShopName | null {
  const b = (brand ?? "").toLowerCase();
  if (b.includes("decor") || b.includes("living")) return "decor";
  if (b.includes("original") || b.includes("activewear")) return "originals";
  return null;
}

type SaleLike = { brand?: string | null; customerAddress?: string | null; items?: { productId: string }[] };
type ProductLike = { id: string; brand?: string | null };

/** A sale's shop: stored on it, else from a website tag in the address, else from its products. */
export function saleShop(sale: SaleLike, shopOfProduct: (productId: string) => ShopName | null): ShopName | null {
  if (sale.brand === "originals" || sale.brand === "decor") return sale.brand;
  const tag = /^\[([^\]]+)\]/.exec(sale.customerAddress ?? "")?.[1];
  const fromTag = tag ? productShop(tag) : null;
  if (fromTag) return fromTag;
  for (const item of sale.items ?? []) {
    const shop = shopOfProduct(item.productId);
    if (shop) return shop;
  }
  return null;
}

/** The shop a cart's products all belong to, or null when mixed/unset. */
export function shopOfProducts(products: ProductLike[]): ShopName | null {
  const shops = new Set(products.map(p => productShop(p.brand)));
  return shops.size === 1 ? [...shops][0] : null;
}

/** Keeps only the selected shop's rows of a loaded resource (by cache key). */
export function filterForShop(key: string, raw: unknown, shop: Shop): unknown {
  if (shop === "all" || !Array.isArray(raw)) return raw;
  const products = (getCached<ProductLike[]>("products") ?? []) as ProductLike[];
  const shopById = new Map(products.map(p => [p.id, productShop(p.brand)]));
  const inShop = (productId: string) => shopById.get(productId) === shop;

  switch (key) {
    case "products":
      return (raw as ProductLike[]).filter(p => productShop(p.brand) === shop);
    case "stocks":
    case "movements":
      return (raw as { productId: string }[]).filter(row => inShop(row.productId));
    case "sales":
      return (raw as SaleLike[]).filter(sale => saleShop(sale, id => shopById.get(id) ?? null) === shop);
    default:
      return raw;
  }
}
