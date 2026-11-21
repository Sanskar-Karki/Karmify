import { NextResponse } from "next/server";
import { getNotifications } from "@/lib/queries";
import { getTenant } from "@/lib/tenant";

/**
 * The notification bell's own feed. It is a plain GET rather than a Server
 * Action because the browser runs Server Actions one at a time: a bell check
 * would otherwise wait behind every save and every big list load.
 */
export async function GET() {
  const tenant = await getTenant().catch(() => null);
  if (!tenant) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const rows = await getNotifications(tenant.storeId);
  return NextResponse.json(rows, { headers: { "Cache-Control": "no-store" } });
}
