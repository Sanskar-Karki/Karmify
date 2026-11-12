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
