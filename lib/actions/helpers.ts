import "server-only";

import { db } from "@/lib/db";
import type { Tenant } from "@/lib/tenant";

// Fire-and-forget style helpers used by the action modules. They take the
// already-resolved tenant so no action pays for a second auth/user lookup.

export async function logActivity(tenant: Tenant, action: string, details: string) {
  await db.activityLog.create({
    data: { storeId: tenant.storeId, action, details, userId: tenant.userId },
  });
}

export async function notify(
  storeId: string,
  title: string,
  message: string,
  type: "info" | "warning" | "error"
) {
  await db.notification.create({ data: { storeId, title, message, type } });
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

  const created = await db.warehouse.create({
    data: {
      storeId,
      name: "Default Warehouse",
      location: "Default location",
      description: "Auto-created default warehouse",
    },
  });
  return created.id;
}
