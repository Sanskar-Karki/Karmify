import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { logActivity, notify } from "@/lib/actions/helpers";
import { backupDayToSheets, BACKUP_ACTIVITY, nepalDateKey, sheetsBackupConfigured } from "@/lib/sheetsBackup";

// Runs once a day (vercel.json, 18:30 UTC = 00:15 in Nepal) and backs up the
// Nepal day that just ended. Vercel sends "Authorization: Bearer $CRON_SECRET".

export const maxDuration = 60;

const digest = (value: string) => createHash("sha256").update(value).digest();

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  return Boolean(secret) && timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const storeId = process.env.SHEETS_BACKUP_STORE_ID;
  if (!storeId || !sheetsBackupConfigured()) {
    return NextResponse.json({ error: "Google Sheets backup isn't set up." }, { status: 503 });
  }

  // Optional ?date=YYYY-MM-DD to re-send a particular day.
  const requested = new URL(request.url).searchParams.get("date");
  const date = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : nepalDateKey(-1);

  try {
    const result = await backupDayToSheets(storeId, date);
    await logActivity({ storeId }, BACKUP_ACTIVITY, `Daily backup of ${date}: ${result.orders} orders, ${result.customers} customers.`);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error.";
    console.error("[sheets-backup]", err);
    await logActivity({ storeId }, `${BACKUP_ACTIVITY} Failed`, `Daily backup of ${date} failed: ${message}`);
    await notify(storeId, "Google Sheets backup failed", `The daily backup of ${date} didn't go through: ${message} Open Settings → Backup to send it again.`, "error");
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
