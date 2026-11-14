"use server";

import { requireTenant } from "@/lib/tenant";
import { logActivity } from "@/lib/actions/helpers";
import { guarded, UserError } from "@/lib/actions/result";
import { backupDayToSheets, BACKUP_ACTIVITY, lastBackup, nepalDateKey, sheetsBackupConfigured } from "@/lib/sheetsBackup";

/** Whether the backup is set up for this store, and how the last one went. */
export async function getBackupStatus() {
  return guarded("Could not check the backup.", async () => {
    const tenant = await requireTenant();
    const last = await lastBackup(tenant.storeId);
    return {
      configured: sheetsBackupConfigured(),
      daily: sheetsBackupConfigured() && process.env.SHEETS_BACKUP_STORE_ID === tenant.storeId && Boolean(process.env.CRON_SECRET),
      last: last ? { ok: last.action === BACKUP_ACTIVITY, details: last.details, at: last.createdAt.toISOString() } : null,
    };
  });
}

/** Sends today (so far) or yesterday to the Google Sheet now. */
export async function backupToSheetsNow(day: "today" | "yesterday") {
  return guarded("Could not back up to Google Sheets.", async () => {
    const tenant = await requireTenant();
    if (!sheetsBackupConfigured()) {
      throw new UserError("Google Sheets backup isn't set up yet. Add SHEETS_BACKUP_URL and SHEETS_BACKUP_SECRET to the server's environment.");
    }
    const date = nepalDateKey(day === "today" ? 0 : -1);
    try {
      const result = await backupDayToSheets(tenant.storeId, date);
      await logActivity(tenant, BACKUP_ACTIVITY, `Backup of ${date} sent by hand: ${result.orders} orders, ${result.customers} customers.`);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      await logActivity(tenant, `${BACKUP_ACTIVITY} Failed`, `Backup of ${date} failed: ${message}`);
      throw new UserError(message);
    }
  });
}
