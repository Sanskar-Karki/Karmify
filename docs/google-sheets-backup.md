# Google Sheets daily backup

Every night at 00:15 Nepal time, Karmify sends the day that just ended to a Google Sheet:

- **Orders** tab: one row per order (customer, phone, address, items, amounts, payment and delivery status, Upaya details). Each day's rows are added below the earlier days. Sending a day again replaces that day's rows, so nothing is duplicated.
- **Customers** tab: the full customer list (ID, contact, orders, total spent, returns, first and last order). It's rewritten on every backup.
- **Backup log** tab: one line per backup received.

Settings → Backup in Karmify shows the last backup and has **Back up now** buttons.

## Setup (once)

1. **Create the Sheet.** Make a new Google Sheet, for example "Karmify backup", in the Google account that should own the backup.
2. **Add the script.** In the Sheet, open **Extensions → Apps Script**. Delete what's there, paste the whole of `docs/google-sheets-backup.gs`, and save.
3. **Set the secret.** In Apps Script, open **Project Settings** (gear icon) → **Script properties** → **Add script property**:
   - Property: `BACKUP_SECRET`
   - Value: a long random string. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
   Optional: add `SHEET_ID` with the ID from the Sheet's address (the part between `/d/` and `/edit`) to make the script always write to that spreadsheet, even if it was created somewhere else.
4. **Deploy as a web app.** Click **Deploy → New deployment** → type **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**. Karmify has no Google login; the secret is what protects it.
   - Click **Deploy**, allow the permissions it asks for, and copy the **Web app URL** (it ends in `/exec`).
5. **Add the settings to Vercel.** In the Karmify project → Settings → Environment Variables (Production), add:

   | Name | Value |
   | --- | --- |
   | `SHEETS_BACKUP_URL` | the Web app URL from step 4 |
   | `SHEETS_BACKUP_SECRET` | the same secret as step 3 |
   | `SHEETS_BACKUP_STORE_ID` | the store to back up, the same value as `UPAYA_STORE_ID` |
   | `CRON_SECRET` | another long random string (Vercel sends it to the daily job) |

   Redeploy so the new values take effect. `vercel.json` already schedules the daily job.
6. **Test it.** In Karmify, open Settings → Backup and press **Back up today**. The Orders and Customers tabs should appear in the Sheet within a few seconds.

## If you change the script later

Use **Deploy → Manage deployments → Edit → Version: New version**. This keeps the same URL. A *new* deployment gets a new URL, which would then need updating in Vercel.

## When a backup fails

Karmify shows a notification ("Google Sheets backup failed") and logs the reason. Fix the cause, then use **Back up yesterday** in Settings → Backup.

To re-send an older day, call the job with that date and the `CRON_SECRET`:

```sh
curl -H "Authorization: Bearer YOUR_CRON_SECRET" "https://YOUR-KARMIFY-DOMAIN/api/cron/sheets-backup?date=2026-11-10"
```
