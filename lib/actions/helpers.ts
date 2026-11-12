import "server-only";

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { Tenant } from "@/lib/tenant";

// Best-effort helpers used by the action modules. They run after the real work
// has committed, so they must never throw: reporting a saved sale as failed
// because its audit line didn't write would invite the user to ring it up twice.

export async function logActivity(tenant: Pick<Tenant, "storeId"> & { userId?: string }, action: string, details: string) {
  try {
    await db.activityLog.create({
      data: { storeId: tenant.storeId, action, details, userId: tenant.userId },
    });
  } catch (err) {
    console.error("[activity] failed to log", action, err);
  }
}

export async function notify(
  storeId: string,
  title: string,
  message: string,
  type: "info" | "warning" | "error"
) {
  try {
    await db.notification.create({ data: { storeId, title, message, type } });
  } catch (err) {
    console.error("[notification] failed to create", title, err);
  }
}

/**
 * Today's prefix for a document series, e.g. `INV-20260101-`. Dated in Nepal
 * time, so orders placed before 05:45 local don't carry yesterday's date.
 */
export function documentStem(series: "INV" | "PO") {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kathmandu" }).format(new Date());
  return `${series}-${today.replace(/-/g, "")}-`;
}

/**
 * Next number in a daily series. Uses the highest existing number rather than a
 * row count, because a count reissues a number that is still taken as soon as
 * any earlier document has been deleted.
 */
export function nextDocumentNumber(stem: string, existing: string[]) {
  const highest = existing.reduce((max, value) => {
    const seq = Number(value.slice(stem.length));
    return Number.isFinite(seq) && seq > max ? seq : max;
  }, 0);
  return `${stem}${String(highest + 1).padStart(3, "0")}`;
}

/**
 * Makes documents in a store number themselves one at a time, until the calling
 * transaction ends. Without this, a burst of simultaneous orders all read the
 * same "next number" and can fail after running out of retries. NO KEY UPDATE
 * doesn't block the store's other inserts, which only need the row to exist.
 */
export async function lockDocumentNumbering(tx: Pick<Prisma.TransactionClient, "$queryRaw">, storeId: string) {
  await tx.$queryRaw`SELECT 1 FROM "Store" WHERE "id" = ${storeId} FOR NO KEY UPDATE`;
}

// The app only supports a single physical location per store for now — this
// resolves (creating on demand) that store's warehouse so callers never deal
// with warehouse selection.
export async function getDefaultWarehouseIdFor(storeId: string) {
  const warehouse = await db.warehouse.findFirst({
    where: { storeId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (warehouse) return warehouse.id;

  // Upsert, so two first-time requests can't collide on the unique name.
  const created = await db.warehouse.upsert({
    where: { storeId_name: { storeId, name: "Default Warehouse" } },
    update: {},
    create: {
      storeId,
      name: "Default Warehouse",
      location: "Default location",
      description: "Auto-created default warehouse",
    },
  });
  return created.id;
}
