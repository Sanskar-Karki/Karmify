"use server";

import { db } from "@/lib/db";
import { getTenant, requireTenant } from "@/lib/tenant";
import { logActivity, notify } from "@/lib/actions/helpers";

// Sync Clerk user with database (kept for compatibility; tenant resolution
// happens in lib/tenant.ts and is cached per request).
export async function syncUser() {
  const tenant = await getTenant();
  if (!tenant) return null;
  return db.user.findUnique({ where: { id: tenant.userId } });
}

export async function addActivity(action: string, details: string) {
  const tenant = await requireTenant();
  await logActivity(tenant, action, details);
}

export async function addNotification(title: string, message: string, type: "info" | "warning" | "error") {
  const tenant = await requireTenant();
  await notify(tenant.storeId, title, message, type);
}

// Notifications
export async function getNotifications() {
  const tenant = await requireTenant();
  return db.notification.findMany({
    where: { storeId: tenant.storeId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function markNotificationRead(id: string) {
  const tenant = await requireTenant();
  return db.notification.update({
    where: { id, storeId: tenant.storeId },
    data: { isRead: true },
  });
}

export async function markAllNotificationsRead() {
  const tenant = await requireTenant();
  await db.notification.updateMany({
    where: { storeId: tenant.storeId, isRead: false },
    data: { isRead: true },
  });
}

// Activity Logs
export async function getActivityLogs() {
  const tenant = await requireTenant();
  return db.activityLog.findMany({
    where: { storeId: tenant.storeId },
    include: { user: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}
