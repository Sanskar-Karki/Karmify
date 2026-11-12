"use server";

import * as queries from "@/lib/queries";
import { requireTenant } from "@/lib/tenant";
import { guarded } from "@/lib/actions/result";
import type { ResourceBatch, ResourceKey } from "@/lib/types";

const LOADERS = {
  products: queries.getProducts,
  categories: queries.getCategories,
  suppliers: queries.getSuppliers,
  stocks: queries.getStocks,
  sales: queries.getSales,
  movements: queries.getStockMovements,
  orders: queries.getPurchaseOrders,
  activities: queries.getActivityLogs,
  notifications: queries.getNotifications,
} satisfies Record<ResourceKey, (storeId: string) => Promise<unknown>>;

/**
 * Loads several resources in one round trip. Server Functions are dispatched
 * one at a time by the client, so calling one per resource made a dashboard
 * load wait on a chain of requests. A failing resource is reported on its own
 * instead of failing the whole batch.
 */
export async function loadResources(keys: ResourceKey[]): Promise<ResourceBatch> {
  const known = [...new Set(keys)].filter(key => Object.hasOwn(LOADERS, key));

  const tenant = await guarded("Could not load your store.", requireTenant);
  if (!tenant.ok) {
    return Object.fromEntries(known.map(key => [key, { ok: false, message: tenant.message }])) as ResourceBatch;
  }
  const { storeId } = tenant.data;

  const settled = await Promise.allSettled(known.map(key => LOADERS[key](storeId)));

  return Object.fromEntries(
    known.map((key, i) => {
      const outcome = settled[i];
      if (outcome.status === "fulfilled") return [key, { ok: true, data: outcome.value }];
      console.error(`[resources] failed to load ${key}`, outcome.reason);
      return [key, { ok: false, message: `Could not load ${key}.` }];
    })
  ) as ResourceBatch;
}
