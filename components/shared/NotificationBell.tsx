"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Bell, Info, XCircle } from "lucide-react";
import { toast } from "sonner";
import { markAllNotificationsRead } from "@/app/actions";
import { Popover } from "@/components/shared/Popover";
import { fetchResource } from "@/lib/resourceCache";
import { resources } from "@/lib/resources";
import { useResources } from "@/lib/useResources";
import { cn } from "@/lib/utils";
import { WEBSITE_ORDER_NOTIFICATION } from "@/lib/orders";

const POLL_MS = 30_000;

const TYPE_META: Record<string, { icon: typeof Info; className: string }> = {
  warning: { icon: AlertTriangle, className: "text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/30" },
  error: { icon: XCircle, className: "text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-950/30" },
  info: { icon: Info, className: "text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-950/30" },
};

function timeAgo(value: Date | string) {
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function refreshNotifications(force = false) {
  const def = resources.notifications;
  return fetchResource(def.key, def.fetcher, { force }).catch(() => {});
}

export function NotificationBell() {
  const { notifications, loading } = useResources({ notifications: resources.notifications });
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const announced = useRef<Set<string> | null>(null);

  const unread = notifications.filter(n => !n.isRead).length;

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refreshNotifications(true);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, []);

  // Website orders arrive on their own, so the bell also brings the order list up to date.
  useEffect(() => {
    if (loading) return;
    const orders = notifications.filter(n => n.title === WEBSITE_ORDER_NOTIFICATION);
    if (announced.current === null) {
      announced.current = new Set(orders.map(n => n.id));
      return;
    }
    const seen = announced.current;
    const fresh = orders.filter(n => !seen.has(n.id));
    if (fresh.length === 0) return;
    fresh.forEach(n => seen.add(n.id));

    void fetchResource(resources.sales.key, resources.sales.fetcher, { force: true }).catch(() => {});
    toast.success(fresh.length === 1 ? WEBSITE_ORDER_NOTIFICATION : `${fresh.length} new website orders`, {
      description: fresh.length === 1 ? fresh[0].message : undefined,
      action: { label: "View", onClick: () => router.push("/customers") },
    });
  }, [notifications, loading, router]);

  // Read state is cleared on close, so the highlights are visible while open.
  async function close() {
    setOpen(false);
    if (unread === 0) return;
    try {
      const result = await markAllNotificationsRead();
      if (result.ok) await refreshNotifications(true);
    } catch {
      // Non-critical: the badge simply stays until the next attempt.
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => (open ? void close() : setOpen(true))}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        className="relative flex items-center justify-center w-10 h-10 sm:w-8 sm:h-8 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors border border-border"
      >
        <Bell size={15} />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-extrabold flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      <Popover
        open={open}
        onClose={() => void close()}
        anchorRef={buttonRef}
        align="end"
        className="w-80 max-w-[calc(100vw-1rem)] rounded-2xl border border-border bg-popover text-popover-foreground shadow-xl"
      >
        <div className="px-4 py-3 border-b border-border/60">
          <p className="text-sm font-bold">Notifications</p>
        </div>
        {notifications.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <Bell size={22} className="mx-auto text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground mt-2">You&apos;re all caught up.</p>
          </div>
        ) : (
          <ul className="max-h-96 overflow-y-auto overscroll-contain divide-y divide-border/40">
            {notifications.map(n => {
              const meta = TYPE_META[n.type] ?? TYPE_META.info;
              const Icon = meta.icon;
              return (
                <li key={n.id} className={cn("flex gap-3 px-4 py-3", !n.isRead && "bg-primary/5")}>
                  <span className={cn("w-7 h-7 rounded-lg flex items-center justify-center shrink-0", meta.className)}>
                    <Icon size={13} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold">{n.title}</p>
                    <p className="text-[12px] text-muted-foreground mt-0.5 break-words">{n.message}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">{timeAgo(n.createdAt)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Popover>
    </>
  );
}
