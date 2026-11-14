"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, ArrowRight, Bell, BellOff, Check, CheckCheck, Info, PackageMinus, Ruler, ShoppingBag, Trash2, Truck, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { clearReadNotifications, markAllNotificationsRead, setNotificationsRead } from "@/app/actions";
import { Popover } from "@/components/shared/Popover";
import { fetchResource } from "@/lib/resourceCache";
import { resources } from "@/lib/resources";
import { useResources } from "@/lib/useResources";
import { cn } from "@/lib/utils";
import { WEBSITE_ORDER_NOTIFICATION } from "@/lib/orders";
import {
  dayLabel, NOTIFICATION_CATEGORIES, notificationCategory, notificationLink, timeAgo, type NotificationCategory,
} from "@/lib/notifications";

const POLL_MS = 30_000;
const LONG_MESSAGE = 140;

type Filter = "all" | "unread" | NotificationCategory;

const CATEGORY_ICON: Record<NotificationCategory, typeof Info> = {
  orders: ShoppingBag,
  stock: PackageMinus,
  products: Ruler,
  purchases: Truck,
  other: Info,
};

/** Colour follows urgency: problems first, then the kind of news. */
function toneClass(type: string, category: NotificationCategory) {
  if (type === "error") return "text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-950/40";
  if (type === "warning") return "text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/40";
  if (category === "orders") return "text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-950/40";
  return "text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-950/40";
}

function refreshNotifications(force = false) {
  const def = resources.notifications;
  return fetchResource(def.key, def.fetcher, { force }).catch(() => {});
}

export function NotificationBell() {
  const { notifications: raw, loading } = useResources({ notifications: resources.notifications });
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Read/unread changes show at once; the server catches up behind them.
  const [readOverride, setReadOverride] = useState<Record<string, boolean>>({});
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [ringing, setRinging] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const announced = useRef<Set<string> | null>(null);
  const lastUnread = useRef<number | null>(null);

  const notifications = useMemo(
    () =>
      raw
        .filter(n => !hidden.has(n.id))
        .map(n => ({ ...n, isRead: readOverride[n.id] ?? n.isRead, category: notificationCategory(n) })),
    [raw, hidden, readOverride]
  );
  const unread = notifications.filter(n => !n.isRead).length;

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refreshNotifications(true);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, []);

  // A short ring when something new arrives (not on the first load).
  useEffect(() => {
    if (loading) return;
    const previous = lastUnread.current;
    lastUnread.current = unread;
    if (previous === null || unread <= previous) return;
    setRinging(true);
    const timer = setTimeout(() => setRinging(false), 1200);
    return () => clearTimeout(timer);
  }, [unread, loading]);

  // Website orders arrive on their own, so the bell also brings the order list up to date.
  useEffect(() => {
    if (loading) return;
    const orders = raw.filter(n => n.title === WEBSITE_ORDER_NOTIFICATION);
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
      action: { label: "View", onClick: () => router.push(notificationLink(fresh[0])?.href ?? "/customers") },
    });
  }, [raw, loading, router]);

  const counts = useMemo(() => {
    const byCategory = new Map<NotificationCategory, number>();
    for (const n of notifications) byCategory.set(n.category, (byCategory.get(n.category) ?? 0) + 1);
    return byCategory;
  }, [notifications]);

  const visible = notifications.filter(n =>
    filter === "all" ? true : filter === "unread" ? !n.isRead : n.category === filter
  );

  // Grouped by day, newest first (the list already comes newest first).
  const groups = useMemo(() => {
    const out: { label: string; items: typeof visible }[] = [];
    for (const n of visible) {
      const label = dayLabel(n.createdAt);
      const last = out[out.length - 1];
      if (last?.label === label) last.items.push(n);
      else out.push({ label, items: [n] });
    }
    return out;
  }, [visible]);

  async function setRead(ids: string[], isRead: boolean) {
    if (ids.length === 0) return;
    setReadOverride(prev => ({ ...prev, ...Object.fromEntries(ids.map(id => [id, isRead])) }));
    const result = await setNotificationsRead(ids, isRead).catch(() => null);
    if (!result?.ok) {
      toast.error("Couldn't update notifications. Try again.");
      setReadOverride(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => !ids.includes(id))));
      return;
    }
    await refreshNotifications(true);
  }

  async function markAllRead() {
    const ids = notifications.filter(n => !n.isRead).map(n => n.id);
    if (ids.length === 0) return;
    setReadOverride(prev => ({ ...prev, ...Object.fromEntries(ids.map(id => [id, true])) }));
    const result = await markAllNotificationsRead().catch(() => null);
    if (!result?.ok) toast.error("Couldn't mark them read. Try again.");
    await refreshNotifications(true);
  }

  async function clearRead() {
    const ids = notifications.filter(n => n.isRead).map(n => n.id);
    if (ids.length === 0) return;
    setHidden(prev => new Set([...prev, ...ids]));
    const result = await clearReadNotifications().catch(() => null);
    if (!result?.ok) {
      toast.error("Couldn't clear notifications. Try again.");
      setHidden(new Set());
      return;
    }
    await refreshNotifications(true);
  }

  function openNotification(n: (typeof notifications)[number]) {
    const link = notificationLink(n);
    if (!n.isRead) void setRead([n.id], true);
    if (link) {
      setOpen(false);
      router.push(link.href);
    }
  }

  const readCount = notifications.length - unread;
  const tabs: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: "All", count: notifications.length },
    { id: "unread", label: "Unread", count: unread },
    ...NOTIFICATION_CATEGORIES.filter(c => counts.get(c.id)).map(c => ({ id: c.id as Filter, label: c.label, count: counts.get(c.id) ?? 0 })),
  ];

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setOpen(v => !v)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        className={cn(
          "relative flex items-center justify-center w-10 h-10 sm:w-8 sm:h-8 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors border border-border",
          open && "bg-muted text-foreground"
        )}
      >
        <Bell size={15} className={cn(ringing && "bell-ring")} />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-extrabold flex items-center justify-center ring-2 ring-background">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={buttonRef}
        align="end"
        className="flex w-[26rem] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2.5">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold">Notifications</p>
            {unread > 0 && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">{unread} new</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => void markAllRead()}
            disabled={unread === 0}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/10 disabled:pointer-events-none disabled:opacity-40"
          >
            <CheckCheck size={14} /> Mark all read
          </button>
        </div>

        {/* Filters */}
        {notifications.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-b border-border/60 px-4 pb-2.5" role="tablist" aria-label="Filter notifications">
            {tabs.map(tab => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={filter === tab.id}
                onClick={() => setFilter(tab.id)}
                className={cn(
                  "flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors",
                  filter === tab.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                {tab.label}
                <span className={cn("text-[10px]", filter === tab.id ? "opacity-80" : "opacity-60")}>{tab.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* List */}
        {visible.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              {filter === "unread" || notifications.length === 0 ? <BellOff size={20} /> : <Bell size={20} />}
            </span>
            <p className="mt-3 text-sm font-semibold">
              {notifications.length === 0 ? "No notifications yet" : filter === "unread" ? "You're all caught up" : "Nothing here"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {notifications.length === 0
                ? "New website orders, low stock and anything that needs fixing will show up here."
                : filter === "unread"
                  ? "Every notification has been read."
                  : "No notifications of this kind."}
            </p>
          </div>
        ) : (
          <div className="max-h-[min(65vh,34rem)] overflow-y-auto overscroll-contain">
            {groups.map(group => (
              <section key={group.label}>
                <h3 className="sticky top-0 z-10 bg-popover/95 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground backdrop-blur">
                  {group.label}
                </h3>
                <ul>
                  {group.items.map(n => {
                    const Icon = n.type === "error" ? XCircle : n.type === "warning" && n.category === "other" ? AlertTriangle : CATEGORY_ICON[n.category];
                    const link = notificationLink(n);
                    const long = n.message.length > LONG_MESSAGE;
                    const isExpanded = expanded.has(n.id);
                    return (
                      <li
                        key={n.id}
                        className={cn(
                          "group relative flex gap-3 border-l-2 px-4 py-3 transition-colors",
                          n.isRead ? "border-transparent hover:bg-muted/50" : "border-primary bg-primary/[0.04] hover:bg-primary/[0.07]"
                        )}
                      >
                        <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", toneClass(n.type, n.category))}>
                          <Icon size={15} />
                        </span>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className={cn("text-[13px] leading-snug", n.isRead ? "font-semibold text-foreground/80" : "font-bold text-foreground")}>
                              {n.title}
                            </p>
                            <time
                              dateTime={new Date(n.createdAt).toISOString()}
                              title={new Date(n.createdAt).toLocaleString()}
                              className="shrink-0 text-[11px] text-muted-foreground"
                            >
                              {timeAgo(n.createdAt)}
                            </time>
                          </div>

                          <p className={cn("mt-0.5 text-xs leading-relaxed text-muted-foreground break-words", long && !isExpanded && "line-clamp-2")}>
                            {n.message}
                          </p>

                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                            {link && (
                              <button
                                type="button"
                                onClick={() => openNotification(n)}
                                className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                              >
                                {link.label} <ArrowRight size={12} />
                              </button>
                            )}
                            {long && (
                              <button
                                type="button"
                                onClick={() =>
                                  setExpanded(prev => {
                                    const next = new Set(prev);
                                    if (next.has(n.id)) next.delete(n.id);
                                    else next.add(n.id);
                                    return next;
                                  })
                                }
                                className="text-xs font-medium text-muted-foreground hover:text-foreground"
                              >
                                {isExpanded ? "Show less" : "Show more"}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void setRead([n.id], !n.isRead)}
                              className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                            >
                              <Check size={12} /> {n.isRead ? "Mark unread" : "Mark read"}
                            </button>
                          </div>
                        </div>
                        {!n.isRead && <span className="sr-only">Unread</span>}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}

        {/* Footer */}
        {notifications.length > 0 && (
          <div className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-2.5 text-[11px] text-muted-foreground">
            <span>Latest {notifications.length}</span>
            <button
              type="button"
              onClick={() => void clearRead()}
              disabled={readCount === 0}
              className="flex items-center gap-1 rounded-md px-2 py-1 font-semibold hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              <Trash2 size={12} /> Clear {readCount > 0 ? `${readCount} read` : "read"}
            </button>
          </div>
        )}
      </Popover>
    </>
  );
}
