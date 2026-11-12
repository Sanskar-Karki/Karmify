import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getDefaultWarehouseIdFor, logActivity, notify } from "@/lib/actions/helpers";
import { WEBSITE_ORDER_NOTIFICATION } from "@/lib/orders";
import { describeItems, importWebsiteOrder, isWebsiteOrder } from "@/lib/websiteOrders";

const digest = (value: string) => createHash("sha256").update(value).digest();

function isAuthorized(request: Request) {
  const secret = process.env.WEBSITE_ORDERS_SECRET;
  const header = request.headers.get("authorization") ?? "";
  return Boolean(secret) && timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}

/** The Karmalu website calls this when a customer places an order. */
export async function POST(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const storeId = process.env.WEBSITE_ORDERS_STORE_ID;
  if (!storeId) return NextResponse.json({ error: "No store is set up for website orders." }, { status: 503 });

  const order = await request.json().catch(() => null);
  if (!isWebsiteOrder(order)) return NextResponse.json({ error: "Invalid order." }, { status: 422 });

  try {
    const warehouseId = await getDefaultWarehouseIdFor(storeId);
    const saved = await importWebsiteOrder(storeId, warehouseId, order);
    // Safe to repeat: the website retries when it doesn't get an answer.
    if (!saved) return NextResponse.json({ ok: true, duplicate: true });

    // Sale items have no size/colour/note fields, so the order's details are
    // spelled out here for whoever packs it.
    const items = describeItems(order.items);
    const note = order.notes?.trim() ? ` Customer note: "${order.notes.trim().slice(0, 300)}"` : "";
    await logActivity(
      { storeId },
      "Website Order Received",
      `${order.order_id} saved as ${saved.invoiceNumber}: ${items}.${note}`
    );
    await notify(
      storeId,
      WEBSITE_ORDER_NOTIFICATION,
      `${order.customer_name} placed ${order.order_id} on the website: ${items}.${note}`,
      "info"
    );
    if (saved.missingSizes.length > 0) {
      await notify(
        storeId,
        "Website size not in inventory",
        `${saved.missingSizes.join(", ")} from ${order.order_id}: Karmify has no size/colour with that name, so stock wasn't reduced. Rename the size/colour in Products → Edit to match the website exactly.`,
        "warning"
      );
    }
    if (saved.unmatchedItems > 0) {
      await notify(
        storeId,
        "Website item not in inventory",
        `${saved.unmatchedNames.join(", ")} from ${order.order_id} didn't match a product, so stock wasn't reduced. Add it in Products with the same name (or with the website's URL name as SKU).`,
        "warning"
      );
    }
    return NextResponse.json({ ok: true, invoiceNumber: saved.invoiceNumber }, { status: 201 });
  } catch (err) {
    console.error("[website-orders] failed to save", order.order_id, err);
    return NextResponse.json({ error: "Could not save this order." }, { status: 500 });
  }
}
