"use server";

import { db } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { getDefaultWarehouseIdFor, logActivity } from "@/lib/actions/helpers";
import { guarded, UserError } from "@/lib/actions/result";
import { deletedWebsiteOrderIds, describeItems, importWebsiteOrder, type WebsiteOrderRow } from "@/lib/websiteOrders";
import { revalidatePath } from "next/cache";

// The karmalu website lives in its OWN Supabase project (not this app's DB),
// and its `public.orders` table has RLS locked down to the service role — so
// we read it over the Supabase REST API with a service-role key, not Prisma.
// New orders arrive by themselves at /api/website-orders; this catches up on
// any that were placed while Karmify couldn't be reached.
const KARMALU_SUPABASE_URL = process.env.KARMALU_SUPABASE_URL;
const KARMALU_SUPABASE_SERVICE_ROLE_KEY = process.env.KARMALU_SUPABASE_SERVICE_ROLE_KEY;

async function fetchKarmaluOrders(): Promise<WebsiteOrderRow[]> {
  if (!KARMALU_SUPABASE_URL || !KARMALU_SUPABASE_SERVICE_ROLE_KEY) {
    throw new UserError("Website sync isn't configured on this server yet.");
  }
  let res: Response;
  try {
    res = await fetch(
      `${KARMALU_SUPABASE_URL}/rest/v1/orders?select=*&order=created_at.asc`,
      {
        headers: {
          apikey: KARMALU_SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${KARMALU_SUPABASE_SERVICE_ROLE_KEY}`,
        },
        cache: "no-store",
      }
    );
  } catch (err) {
    console.error("[website-sync] orders request failed", err);
    throw new UserError("Could not reach the website's orders. Please try again shortly.");
  }
  if (!res.ok) {
    console.error("[website-sync] orders request failed", res.status, await res.text());
    throw new UserError("Could not reach the website's orders. Please try again shortly.");
  }
  return res.json();
}

async function getUnimportedOrders(storeId: string) {
  const [allOrders, importedSales, deletedIds] = await Promise.all([
    fetchKarmaluOrders(),
    db.sale.findMany({
      where: { storeId, externalOrderId: { not: null } },
      select: { externalOrderId: true },
    }),
    // Deleted here on purpose; the website still has its copy.
    deletedWebsiteOrderIds(storeId),
  ]);
  const importedIds = new Set(importedSales.map(s => s.externalOrderId));
  return allOrders.filter(row => !importedIds.has(row.order_id) && !deletedIds.has(row.order_id));
}

export async function syncWebsiteOrders() {
  return guarded("Failed to sync website orders.", runWebsiteOrderSync);
}

async function runWebsiteOrderSync() {
  const tenant = await requireTenant();
  const storeId = tenant.storeId;
  // The website's orders hold customers' names, phone numbers and addresses,
  // so only the store that receives them (as /api/website-orders does) may pull them.
  if (!process.env.WEBSITE_ORDERS_STORE_ID || storeId !== process.env.WEBSITE_ORDERS_STORE_ID) {
    throw new UserError("Website orders go to the shop's own store, not this one.");
  }
  const warehouseId = await getDefaultWarehouseIdFor(storeId);

  const rows = await getUnimportedOrders(storeId);

  let imported = 0;
  let unmatchedItems = 0;
  const failedOrderIds: string[] = [];

  for (const row of rows) {
    try {
      const result = await importWebsiteOrder(storeId, warehouseId, row);
      if (result) {
        imported += 1;
        unmatchedItems += result.unmatchedItems;
        // Sale items have no size/colour/note fields, so record them for packing.
        const note = row.notes?.trim() ? ` Customer note: "${row.notes.trim().slice(0, 300)}"` : "";
        await logActivity(tenant, "Website Order Received", `${row.order_id} saved as ${result.invoiceNumber}: ${describeItems(row.items)}.${note}`);
      }
    } catch (err) {
      console.error("[website-sync] failed to import order", row.order_id, err);
      failedOrderIds.push(row.order_id);
    }
  }

  if (imported > 0) {
    await logActivity(tenant, "Website Orders Synced", `Imported ${imported} website order(s)${unmatchedItems ? `, ${unmatchedItems} item(s) unmatched to a product` : ""}.`);
  }

  revalidatePath("/sales");
  revalidatePath("/customers");
  revalidatePath("/inventory");
  revalidatePath("/dashboard");

  return { imported, unmatchedItems, failedOrderIds, total: rows.length };
}
