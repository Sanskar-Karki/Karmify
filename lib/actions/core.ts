"use server";

import { db } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { guarded } from "@/lib/actions/result";

export async function markAllNotificationsRead() {
  return guarded("Could not update notifications.", async () => {
    const tenant = await requireTenant();
    await db.notification.updateMany({
      where: { storeId: tenant.storeId, isRead: false },
      data: { isRead: true },
    });
  });
}

/** Marks the given notifications read (or unread again). */
export async function setNotificationsRead(ids: string[], isRead = true) {
  return guarded("Could not update notifications.", async () => {
    const tenant = await requireTenant();
    if (ids.length === 0) return;
    await db.notification.updateMany({
      where: { storeId: tenant.storeId, id: { in: ids.slice(0, 200) } },
      data: { isRead },
    });
  });
}

/** Deletes notifications that have been read, to tidy the list. */
export async function clearReadNotifications() {
  return guarded("Could not clear notifications.", async () => {
    const tenant = await requireTenant();
    const { count } = await db.notification.deleteMany({ where: { storeId: tenant.storeId, isRead: true } });
    return { cleared: count };
  });
}
