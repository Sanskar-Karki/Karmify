import "server-only";

import { db } from "@/lib/db";
import { getSales } from "@/lib/queries";
import { countsAsSale, deliveryAddress, DELIVERY_STATUSES, groupSalesByCustomer, itemName } from "@/lib/orders";
import { courierStatusLabel } from "@/lib/courier";
import type { Sale } from "@/lib/types";

// Daily backup to a Google Sheet. Karmify posts the day's orders and the whole
// customer list to a small Apps Script web app inside the Sheet
// (docs/google-sheets-backup.gs), which writes them to an "Orders" tab (one
// block of rows per day, replaced if the day is sent again) and a "Customers"
// tab (rewritten each time).
//
// Environment:
//   SHEETS_BACKUP_URL       the Apps Script web app URL (…/exec)
//   SHEETS_BACKUP_SECRET    the same secret saved in the script's properties
//   SHEETS_BACKUP_STORE_ID  which store the daily job backs up
//   CRON_SECRET             Vercel sends it to the daily job

export const BACKUP_ACTIVITY = "Google Sheets Backup";

export const ORDER_COLUMNS = [
  "Date", "Time", "Order ID", "Website order", "Source", "Shop", "Customer ID", "Customer", "Phone", "Email", "Address",
  "Items", "Units", "Goods", "Discount", "Delivery", "Total", "COD", "Payment method", "Payment status",
  "Delivery status", "Upaya tracking", "Upaya status", "Upaya hub", "Note",
];

export const CUSTOMER_COLUMNS = [
  "Customer ID", "Name", "Phone", "Email", "Address", "Orders", "Spent", "Website orders", "Returns",
  "Cancelled", "First order", "Last order",
];

const NEPAL_OFFSET_MS = (5 * 60 + 45) * 60 * 1000;

export function sheetsBackupConfigured() {
  return Boolean(process.env.SHEETS_BACKUP_URL && process.env.SHEETS_BACKUP_SECRET);
}

/** "YYYY-MM-DD" for a day in Nepal, `offsetDays` from today. */
export function nepalDateKey(offsetDays = 0, now = new Date()) {
  return new Date(now.getTime() + NEPAL_OFFSET_MS + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/** The instants a Nepal calendar day starts and ends. */
function nepalDayBounds(dateKey: string) {
  const start = new Date(`${dateKey}T00:00:00.000Z`).getTime() - NEPAL_OFFSET_MS;
  return { start: new Date(start), end: new Date(start + 86_400_000) };
}

const nepalParts = (value: Date) => {
  const local = new Date(value.getTime() + NEPAL_OFFSET_MS).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
};

const statusLabel = (status: string) => DELIVERY_STATUSES.find(d => d.value === status)?.label ?? status;
const shopLabel = (brand: string | null) => (brand === "decor" ? "Living & Decor" : brand === "originals" ? "Originals" : "");

function orderRow(sale: Sale) {
  const { date, time } = nepalParts(new Date(sale.createdAt));
  const goods = sale.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  return [
    date, time, sale.invoiceNumber, sale.externalOrderId ?? "", sale.source === "website" ? "Website" : "In store",
    shopLabel(sale.brand), sale.customer?.code ?? "", sale.customerName ?? "", sale.customerPhone ?? "", sale.customerEmail ?? "",
    deliveryAddress(sale.customerAddress),
    sale.items.map(item => `${item.quantity} x ${itemName(item)}`).join("; "),
    sale.items.reduce((n, item) => n + item.quantity, 0),
    goods, sale.discount, sale.deliveryAmount, sale.totalAmount, sale.codAmount,
    sale.paymentMethod, sale.paymentStatus, statusLabel(sale.deliveryStatus),
    sale.courierTrackingCode ?? "", sale.courierStatus ? courierStatusLabel(sale.courierStatus) : "", sale.courierAreaTitle ?? "",
    sale.notes ?? "",
  ];
}

function customerRows(sales: Sale[]) {
  return groupSalesByCustomer(sales).map(customer => {
    const dates = customer.sales.map(s => new Date(s.createdAt).getTime());
    const counted = customer.sales.filter(countsAsSale);
    return [
      customer.code ?? "", customer.name, customer.phone ?? "", customer.email ?? "", deliveryAddress(customer.address),
      customer.orderCount,
      counted.reduce((sum, s) => sum + s.totalAmount, 0),
      customer.sales.filter(s => s.source === "website").length,
      customer.sales.filter(s => s.deliveryStatus === "RETURNED" || s.deliveryStatus === "RETURN_PROCESS").length,
      customer.sales.filter(s => s.deliveryStatus === "CANCELLED").length,
      nepalParts(new Date(Math.min(...dates))).date,
      nepalParts(new Date(Math.max(...dates))).date,
    ];
  });
}

export type BackupResult = { date: string; orders: number; customers: number };

/**
 * Sends one Nepal day's orders and the full customer list to the Sheet.
 * Sending the same day again replaces that day's rows, so a retry never
 * duplicates anything.
 */
export async function backupDayToSheets(storeId: string, dateKey: string): Promise<BackupResult> {
  const url = process.env.SHEETS_BACKUP_URL;
  const secret = process.env.SHEETS_BACKUP_SECRET;
  if (!url || !secret) throw new Error("Google Sheets backup isn't set up: add SHEETS_BACKUP_URL and SHEETS_BACKUP_SECRET.");

  const sales = (await getSales(storeId)) as Sale[];
  const { start, end } = nepalDayBounds(dateKey);
  const dayOrders = sales
    .filter(s => {
      const t = new Date(s.createdAt).getTime();
      return t >= start.getTime() && t < end.getTime();
    })
    .reverse(); // oldest first, so the sheet reads in order
  const customers = customerRows(sales);

  const body = JSON.stringify({
    secret,
    date: dateKey,
    orderColumns: ORDER_COLUMNS,
    orders: dayOrders.map(orderRow),
    customerColumns: CUSTOMER_COLUMNS,
    customers,
  });

  // Apps Script answers with a redirect to its result, which fetch follows.
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body,
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  let reply: { ok?: boolean; error?: string } | null = null;
  try {
    reply = JSON.parse(text);
  } catch {
    // An HTML page here usually means the web app isn't deployed for "Anyone".
  }
  if (!response.ok || !reply?.ok) {
    throw new Error(reply?.error ? `The Sheet said: ${reply.error}` : `The Sheet didn't accept the backup (HTTP ${response.status}). Check the web app is deployed with access "Anyone".`);
  }

  return { date: dateKey, orders: dayOrders.length, customers: customers.length };
}

/** The last backup that ran, from the activity log. */
export async function lastBackup(storeId: string) {
  return db.activityLog.findFirst({
    where: { storeId, action: { in: [BACKUP_ACTIVITY, `${BACKUP_ACTIVITY} Failed`] } },
    orderBy: { createdAt: "desc" },
    select: { action: true, details: true, createdAt: true },
  });
}
