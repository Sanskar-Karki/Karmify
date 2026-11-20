"use client";

import React, { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, ArrowUpDown, Bike, CalendarDays, CheckCircle2, ChevronRight, Gift, Globe, Megaphone, MessageSquare, Package, PackageOpen, Phone, RefreshCw, Route, Search, Truck, Undo2, X,
  type LucideIcon,
} from "lucide-react";
import { refreshCourierShipments } from "@/app/actions";
import { CourierDialog } from "@/components/shared/CourierDialog";
import { Dropdown } from "@/components/shared/Dropdown";
import { EmptyState } from "@/components/shared/EmptyState";
import { Pulse } from "@/components/shared/Pulse";
import { ShowMoreButton, useShowMore } from "@/components/shared/ShowMore";
import { upayaCod } from "@/lib/analytics";
import { commentTimeLabel, COURIER_FINAL_STATUSES, courierStatusLabel, latestCommentTime, courierStatusStyle, UPAYA_STAGES, upayaPlace, type UpayaBucket, type UpayaStage } from "@/lib/courier";
import { mutate } from "@/lib/mutate";
import { customerKey, deliveryAddress, isPR, referralLabel } from "@/lib/orders";
import { ExchangeBadge } from "@/components/orders/ExchangeInfo";
import { resources } from "@/lib/resources";
import { timeAgo } from "@/lib/notifications";
import { useCourierAutoRefresh } from "@/lib/useCourierAutoRefresh";
import { useResources } from "@/lib/useResources";
import { useUrlState } from "@/lib/useUrlState";
import { useOwnerUnlocked } from "@/lib/ownerLock";
import { DateRangeCalendar, fromDateKey, shortDay } from "@/components/shared/DateRangeCalendar";
import { cn, formatNPR } from "@/lib/utils";
import type { Sale } from "@/lib/types";

// Upaya follow-up: only the orders booked with Upaya, counted the way Upaya's own
// dashboard counts them, so staff can open "Failed pickup" or "Hold" and call
// through the list. The full order list stays on Customers & Orders.

type View = "all" | Exclude<UpayaBucket, "cancelled"> | UpayaStage;

const card = "rounded-2xl border border-border/80 bg-card shadow-sm";

/**
 * The summary across the top, as on Upaya's dashboard. Each has its own colour
 * (icon, share bar and the ring when it's the one showing). Static class names,
 * so Tailwind keeps them.
 */
const TOTALS: {
  id: View; label: string; hint: string; icon: LucideIcon;
  iconTone: string; bar: string; ring: string; tint: string;
}[] = [
  {
    id: "all", label: "Total orders", hint: "Booked with Upaya, not cancelled", icon: Package,
    iconTone: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200", bar: "bg-slate-400", ring: "ring-slate-400/60", tint: "bg-slate-50 dark:bg-slate-900/40",
  },
  {
    id: "delivered", label: "Delivered", hint: "of all orders", icon: CheckCircle2,
    iconTone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300", bar: "bg-emerald-500", ring: "ring-emerald-500/50", tint: "bg-emerald-50/70 dark:bg-emerald-950/20",
  },
  {
    id: "process", label: "In process", hint: "of all orders", icon: Truck,
    iconTone: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300", bar: "bg-amber-500", ring: "ring-amber-500/50", tint: "bg-amber-50/70 dark:bg-amber-950/20",
  },
  {
    id: "rto", label: "RTO", hint: "returned to us", icon: Undo2,
    iconTone: "bg-cyan-100 text-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-300", bar: "bg-cyan-500", ring: "ring-cyan-500/50", tint: "bg-cyan-50/70 dark:bg-cyan-950/20",
  },
  {
    id: "followup", label: "Follow up for return", hint: "need a decision", icon: AlertTriangle,
    iconTone: "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300", bar: "bg-rose-500", ring: "ring-rose-500/50", tint: "bg-rose-50/70 dark:bg-rose-950/20",
  },
];

/** The steps of "In process", in the order a parcel goes through them. */
const PHASES: { id: string; label: string; icon: LucideIcon; stages: View[] }[] = [
  { id: "pickup", label: "Pickup", icon: PackageOpen, stages: ["ready", "picked", "failed-pickup"] },
  { id: "transit", label: "On the way", icon: Route, stages: ["origin-hub", "transit", "dest-hub"] },
  { id: "delivery", label: "Out for delivery", icon: Bike, stages: ["with-rider", "failed-delivery", "hold"] },
  { id: "return", label: "Coming back", icon: Undo2, stages: ["return", "other", "lost"] },
];

/** Steps that mean someone should call: shown in red when they have orders. */
const NEEDS_A_CALL = new Set<View>(["failed-pickup", "failed-delivery", "hold", "lost"]);

const STAGE_LABEL: Record<string, string> = {
  ...Object.fromEntries(UPAYA_STAGES.map(s => [s.id, s.label])),
  other: "Other",
  lost: "Lost or damaged",
};

const DATE_FILTERS = [
  { value: "all", label: "Any time" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "3", label: "3 days" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
];

const SORTS = [
  { value: "oldest", label: "Oldest first" },
  { value: "newest", label: "Newest first" },
];

const DAY = 86_400_000;
const bookedAt = (sale: Sale) => new Date(sale.courierBookedAt ?? sale.createdAt);
const daysSince = (d: Date) => Math.floor((Date.now() - d.getTime()) / DAY);
const shortDate = (d: Date) => d.toLocaleDateString(undefined, { day: "numeric", month: "short" });

/** Still moving and booked this many days ago: worth a call. */
const LATE_DAYS = 3;
const VERY_LATE_DAYS = 7;

type CustomRange = { from: string; to: string };

/** The days a date filter covers, as [start, end). "all" covers everything. */
function dateRange(filter: string, custom: CustomRange | null): [Date, Date] | null {
  if (filter === "all") return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayAfter = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  if (filter === "custom") return custom ? [fromDateKey(custom.from), dayAfter(fromDateKey(custom.to))] : null;
  if (filter === "yesterday") return [new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1), today];
  const days = filter === "today" ? 1 : Number(filter);
  return [new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1)), dayAfter(today)];
}

/**
 * The day a parcel counts on: a finished one (delivered, returned) on the day it
 * finished, so "Today" shows what was delivered today whenever it was booked; a
 * moving one on the day it was booked. Karmify doesn't keep a separate finish
 * time, but a finished parcel is never checked again, so its last check is when
 * Upaya's webhook (or a refresh) told Karmify it had finished.
 */
function countsOn(sale: Sale, booked: Date) {
  const finished = COURIER_FINAL_STATUSES.includes(sale.courierStatus ?? "");
  return finished && sale.courierCheckedAt ? new Date(sale.courierCheckedAt) : booked;
}

const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

export default function UpayaPage() {
  const { sales, loading, refetch } = useResources({ sales: resources.sales });
  const [view, setView] = useUrlState("view", "process");
  const [dateFilter, setDateFilter] = useState("all");
  const [customRange, setCustomRange] = useState<CustomRange | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const customButton = useRef<HTMLButtonElement>(null);
  const [sortChoice, setSortChoice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [tracking, setTracking] = useState<{ sale: Sale; comment: boolean } | null>(null);
  const listRef = useRef<HTMLElement>(null);

  // Orders booked with Upaya (a cancelled booking doesn't count, as on Upaya's dashboard).
  const booked = useMemo(
    () => sales
      .filter(s => s.courierTrackingCode && s.courierStatus !== "cancelled")
      .map(sale => ({ sale, at: bookedAt(sale), ...upayaPlace(sale.courierStatus) })),
    [sales],
  );
  const inRange = useMemo(() => {
    const range = dateRange(dateFilter, customRange);
    if (!range) return booked;
    return booked.filter(o => { const d = countsOn(o.sale, o.at); return d >= range[0] && d < range[1]; });
  }, [booked, dateFilter, customRange]);

  const counts = useMemo(() => {
    const c = new Map<string, number>([["all", inRange.length]]);
    for (const o of inRange) {
      c.set(o.bucket, (c.get(o.bucket) ?? 0) + 1);
      if (o.stage) c.set(o.stage, (c.get(o.stage) ?? 0) + 1);
    }
    return c;
  }, [inRange]);
  const count = (id: string) => counts.get(id) ?? 0;
  const total = count("all");
  const inProcess = count("process");

  const finishedView = view === "delivered" || view === "rto" || view === "all" || view === "lost";
  const sort = sortChoice ?? (finishedView ? "newest" : "oldest");
  const query = search.trim().toLowerCase();
  const shown = useMemo(() => {
    const words = query.split(/\s+/).filter(Boolean);
    const digits = query.replace(/\D/g, "");
    const matches = inRange.filter(o => {
      if (view !== "all" && o.bucket !== view && o.stage !== view) return false;
      if (words.length === 0) return true;
      const s = o.sale;
      const text = [s.invoiceNumber, s.customerName, s.customerPhone, s.customerAddress, s.courierAreaTitle, s.courierTrackingCode, s.customer?.code]
        .filter(Boolean).join(" ").toLowerCase();
      return words.every(w => text.includes(w)) || (digits.length >= 4 && (s.customerPhone ?? "").replace(/\D/g, "").includes(digits));
    });
    // Parcels still moving: the longest-waiting first, since those need the call.
    // Finished ones (delivered, returned): the latest first.
    return matches.sort((a, b) => (sort === "oldest" ? a.at.getTime() - b.at.getTime() : b.at.getTime() - a.at.getTime()));
  }, [inRange, view, query, sort]);

  const { visible, remaining, step, showMore } = useShowMore(shown, 50);
  // The COD total is for the owner; staff (Dashboard not unlocked here) see counts only.
  const ownerUnlocked = useOwnerUnlocked();
  const codDue = shown.reduce((sum, o) => sum + upayaCod(o.sale), 0);
  const viewLabel = TOTALS.find(t => t.id === view)?.label ?? STAGE_LABEL[view] ?? "Upaya orders";

  const hasOpen = booked.some(o => !COURIER_FINAL_STATUSES.includes(o.sale.courierStatus ?? ""));
  useCourierAutoRefresh(hasOpen, () => refetch({ quiet: true }));
  // When Upaya was last asked about any of these parcels.
  const lastChecked = booked.reduce<number>((latest, o) => Math.max(latest, o.sale.courierCheckedAt ? new Date(o.sale.courierCheckedAt).getTime() : 0), 0);

  async function refresh() {
    setRefreshing(true);
    const result = await mutate(() => refreshCourierShipments(), {
      loading: "Checking Upaya for updates…",
      success: data => `Checked ${data.checked} shipment${data.checked === 1 ? "" : "s"}, ${data.updated} updated${data.failed ? `, ${data.failed} couldn't be read` : ""}.`,
    });
    setRefreshing(false);
    if (result.ok && result.data.updated > 0) await refetch();
  }

  /** Opens a box's list; on a phone, where the list is below the boxes, it scrolls into view. */
  function choose(next: View) {
    setView(next);
    setSortChoice(null);
    const list = listRef.current;
    if (list && list.getBoundingClientRect().top > window.innerHeight * 0.75) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      requestAnimationFrame(() => list.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }));
    }
  }

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Title, the way back to every order, and the page's controls */}
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/75 text-primary-foreground shadow-md shadow-primary/20">
            <Truck size={20} />
          </span>
          <div className="min-w-0">
            <nav aria-label="Orders pages" className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
              <Link href="/customers" className="hover:text-foreground">Customers &amp; Orders</Link>
              <ChevronRight size={11} aria-hidden />
              <span className="text-foreground">Upaya</span>
            </nav>
            <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">Upaya orders</h1>
            <p className="text-xs text-muted-foreground">
              Every parcel booked with Upaya, by where it is now.
              {lastChecked > 0 && <> Statuses checked {timeAgo(new Date(lastChecked)).toLowerCase()}.</>}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="When" title="Moving parcels count on the day they were booked; delivered and returned ones on the day they finished" className="flex flex-wrap items-center gap-0.5 rounded-xl border border-border/70 bg-muted/70 p-1">
            {DATE_FILTERS.map(f => (
              <button
                key={f.value}
                type="button"
                role="radio"
                aria-checked={dateFilter === f.value}
                onClick={() => setDateFilter(f.value)}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-all",
                  dateFilter === f.value ? "bg-card text-foreground shadow-sm ring-1 ring-border/60" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
              </button>
            ))}
            <button
              ref={customButton}
              type="button"
              role="radio"
              aria-checked={dateFilter === "custom"}
              onClick={() => setPickerOpen(true)}
              className={cn(
                "inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-all",
                dateFilter === "custom" ? "bg-card text-foreground shadow-sm ring-1 ring-border/60" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <CalendarDays size={12} aria-hidden />
              {dateFilter === "custom" && customRange
                ? customRange.from === customRange.to ? shortDay(customRange.from) : `${shortDay(customRange.from)} – ${shortDay(customRange.to)}`
                : "Custom"}
            </button>
          </div>
          {pickerOpen && (
            <DateRangeCalendar
              open={pickerOpen}
              onClose={() => setPickerOpen(false)}
              anchorRef={customButton}
              initialStart={customRange?.from}
              initialEnd={customRange?.to}
              onApply={(from, to) => {
                setCustomRange({ from, to });
                setDateFilter("custom");
                setPickerOpen(false);
              }}
            />
          )}
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing || !hasOpen}
            title={hasOpen ? "Ask Upaya for the latest status of every open parcel" : "Every parcel here is finished"}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-semibold shadow-sm transition-colors hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw size={13} className={cn(refreshing && "animate-spin")} /> {refreshing ? "Checking…" : "Refresh"}
          </button>
        </div>
      </header>

      {/* Summary, as on Upaya's dashboard: compact cards, each with its share along the bottom edge */}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-5" role="group" aria-label="Upaya totals">
        {TOTALS.map((box, i) => {
          const active = view === box.id;
          // A step of "In process" is showing: its box stays lightly marked.
          const parent = box.id === "process" && !active && PHASES.some(ph => ph.stages.includes(view as View) && view !== "lost");
          const n = count(box.id);
          const share = percent(n, total);
          return (
            <button
              key={box.id}
              type="button"
              aria-pressed={active}
              aria-label={`${box.label}: ${n}`}
              title={box.id === "all" ? box.hint : `${share}% ${box.hint}`}
              onClick={() => choose(box.id)}
              className={cn(
                card,
                "group relative flex items-center gap-3 overflow-hidden px-3.5 pb-3.5 pt-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                active && cn("border-transparent ring-2", box.ring, box.tint),
                parent && "border-amber-300 dark:border-amber-800/70",
                i === 0 && "col-span-2 md:col-span-1",
              )}
            >
              <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-transform group-hover:scale-105", box.iconTone)}>
                <box.icon size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">{box.label}</span>
                <span className="flex items-baseline gap-2">
                  <Count loading={loading} value={n} className="text-2xl font-extrabold leading-tight tracking-tight text-foreground" />
                  {!loading && box.id !== "all" && <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">{share}%</span>}
                </span>
              </span>
              {/* Share of all orders, along the bottom edge (Total: how they split) */}
              <span className="absolute inset-x-0 bottom-0 flex h-1 bg-muted/70" aria-hidden>
                {box.id === "all"
                  ? TOTALS.slice(1).map(part => <span key={part.id} className={cn("h-full transition-[width] duration-500", part.bar)} style={{ width: `${percent(count(part.id), total)}%` }} />)
                  : <span className={cn("h-full transition-[width] duration-500", box.bar)} style={{ width: `${share}%` }} />}
              </span>
            </button>
          );
        })}
      </div>

      {/* In process, step by step: the parcel's journey in four parts, one slim row per step */}
      <section aria-labelledby="journey-title" className={cn(card, "px-3 pb-3 pt-2.5")}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-0.5">
          <h2 id="journey-title" className="text-[13px] font-bold tracking-normal">
            Where the <Count loading={loading} value={inProcess} className="font-extrabold" /> in process are
          </h2>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-red-500" aria-hidden /> Red: call the customer
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {PHASES.map(phase => {
            const stages = phase.stages.filter(id => (id !== "other" && id !== "lost") || count(id) > 0);
            const phaseTotal = stages.reduce((sum, id) => sum + (id === "lost" ? 0 : count(id)), 0);
            return (
              <div key={phase.id} className="rounded-xl bg-muted/45 p-1.5">
                <p className="flex items-center justify-between px-2 pb-1 pt-0.5">
                  <span className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                    <phase.icon size={12} aria-hidden /> {phase.label}
                  </span>
                  <span className="rounded-full bg-card px-1.5 text-[10.5px] font-bold tabular-nums text-muted-foreground">{loading ? "…" : phaseTotal}</span>
                </p>
                <div className="space-y-0.5">
                  {stages.map(id => {
                    const n = count(id);
                    const active = view === id;
                    const alarm = NEEDS_A_CALL.has(id) && n > 0;
                    return (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={active}
                        aria-label={`${STAGE_LABEL[id]}: ${n}`}
                        title={STAGE_LABEL[id]}
                        onClick={() => choose(id)}
                        className={cn(
                          "relative flex w-full items-center justify-between gap-2 overflow-hidden rounded-lg px-2.5 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                          active ? "bg-card shadow-sm ring-1 ring-primary/40" : "bg-card/55 hover:bg-card",
                        )}
                      >
                        {/* Its share of everything in process, as a soft fill behind the row */}
                        <span
                          aria-hidden
                          className={cn("absolute inset-y-0 left-0 transition-[width] duration-500", alarm ? "bg-red-500/12" : active ? "bg-primary/12" : "bg-foreground/[0.05]")}
                          style={{ width: `${percent(n, inProcess)}%` }}
                        />
                        <span className={cn("relative flex min-w-0 items-center gap-1.5 text-[12.5px] font-semibold", n === 0 ? "text-muted-foreground" : "text-foreground")}>
                          {alarm && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" aria-hidden />}
                          <span className="truncate">{STAGE_LABEL[id]}</span>
                        </span>
                        <Count
                          loading={loading}
                          value={n}
                          className={cn("relative shrink-0 text-sm font-extrabold", alarm ? "text-red-700 dark:text-red-400" : n === 0 ? "text-muted-foreground" : "text-foreground")}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* The orders in the chosen box, numbered */}
      <section ref={listRef} aria-labelledby="list-title" className={cn(card, "scroll-mt-3 overflow-hidden")}>
        <div className="flex flex-col gap-2.5 border-b border-border/60 p-3 sm:p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h2 id="list-title" className="text-base font-extrabold tracking-normal" aria-live="polite">
              {viewLabel} <span className="font-semibold text-muted-foreground">· {shown.length.toLocaleString()} order{shown.length === 1 ? "" : "s"}</span>
            </h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
              {ownerUnlocked && codDue > 0 && <span><span className="font-semibold text-foreground">{formatNPR(codDue)}</span> COD to collect</span>}
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden /> booked {LATE_DAYS}+ days ago</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" aria-hidden /> {VERY_LATE_DAYS}+ days</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1 lg:w-72 lg:flex-none">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Name, phone, order, tracking…"
                aria-label="Search Upaya orders"
                className={cn("h-9 w-full rounded-xl border bg-background pl-8.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/20", search ? "border-primary/50 pr-8" : "border-border pr-3")}
              />
              {search && (
                <button type="button" onClick={() => setSearch("")} aria-label="Clear search" className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
                  <X size={13} />
                </button>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <ArrowUpDown size={13} className="text-muted-foreground" aria-hidden />
              <Dropdown aria-label="Sort" value={sort} onChange={setSortChoice} options={SORTS} className="w-34" triggerClassName="h-9 py-0 text-xs rounded-xl" />
            </div>
          </div>
        </div>

        {loading ? (
          <div className="space-y-2 p-3">{Array.from({ length: 5 }, (_, i) => <Pulse key={i} className="h-14 w-full rounded-xl" />)}</div>
        ) : shown.length === 0 ? (
          <EmptyState
            icon={Truck}
            title={booked.length === 0 ? "No orders booked with Upaya yet" : search ? "No orders match this search" : "Nothing here right now"}
            description={booked.length === 0 ? "Orders booked with Upaya from the POS or an order's Upaya button show up here." : "Pick another box above, or change the dates."}
          />
        ) : (
          <>
            {/* Computers: a table */}
            <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[86rem] table-fixed text-left">
              <thead>
                <tr className="bg-muted/60 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="w-14 py-2.5 pl-4 pr-2"><span className="sr-only">Row </span>#</th>
                  <th scope="col" className="w-36 px-3 py-2.5">Order</th>
                  <th scope="col" className="px-3 py-2.5">Customer</th>
                  <th scope="col" className="w-48 px-3 py-2.5">Going to</th>
                  <th scope="col" className="w-28 px-3 py-2.5">Type</th>
                  <th scope="col" className="w-40 px-3 py-2.5">Upaya status</th>
                  <th scope="col" className="w-24 px-3 py-2.5 text-right">COD</th>
                  <th scope="col" className="w-56 px-3 py-2.5">Latest comment</th>
                  <th scope="col" className="w-44 px-3 py-2.5">Tracking</th>
                  <th scope="col" className="w-28 py-2.5 pl-3 pr-4">Booked</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row, i) => <TableRow key={row.sale.id} n={i + 1} {...row} onTrack={(sale, comment) => setTracking({ sale, comment })} />)}
              </tbody>
            </table>
            </div>

            {/* Phones: numbered cards */}
            <ol className="divide-y divide-border/50 md:hidden">
              {visible.map((row, i) => <CardRow key={row.sale.id} n={i + 1} {...row} onTrack={(sale, comment) => setTracking({ sale, comment })} />)}
            </ol>
          </>
        )}
        <ShowMoreButton remaining={remaining} step={step} onClick={showMore} />
      </section>

      {tracking && (
        <CourierDialog
          key={tracking.sale.id}
          open
          onClose={() => setTracking(null)}
          sale={tracking.sale}
          focusComment={tracking.comment}
          onChanged={() => refetch({ quiet: true })}
        />
      )}
    </div>
  );
}

/** A count in the display font; a placeholder while the orders load. */
function Count({ value, loading, className }: { value: number; loading: boolean; className?: string }) {
  return loading
    ? <Pulse className={cn("inline-block h-6 w-10 align-middle", className)} />
    : <span className={cn("font-display tabular-nums", className)}>{value.toLocaleString()}</span>;
}

type RowProps = { n: number; sale: Sale; at: Date; bucket: UpayaBucket; onTrack: (sale: Sale, comment: boolean) => void };

/** What a row says about its age: still moving and old is amber, very old red. */
function age({ at, bucket }: Pick<RowProps, "at" | "bucket">) {
  const days = daysSince(at);
  const moving = bucket === "process" || bucket === "followup";
  const tone = moving && days >= VERY_LATE_DAYS ? "text-red-700 dark:text-red-400 font-bold"
    : moving && days >= LATE_DAYS ? "text-amber-700 dark:text-amber-400 font-semibold"
      : "text-foreground";
  return { days, tone, text: days === 0 ? "Today" : days === 1 ? "1 day ago" : `${days} days ago` };
}

/** The same tags as the Orders list: website order, PR, exchange, and where an ad brought it. */
function OrderTags({ sale, plain }: { sale: Sale; plain?: boolean }) {
  const ad = referralLabel(sale.referral);
  if (sale.source !== "website" && !isPR(sale) && !sale.exchange && !ad) {
    return plain ? <span className="text-xs text-muted-foreground">Regular</span> : null;
  }
  const pill = "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-extrabold uppercase";
  return (
    <span className={cn("flex flex-wrap items-center gap-1", !plain && "mt-1")}>
      {sale.source === "website" && <span className={cn(pill, "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300")}><Globe size={9} aria-hidden /> Website</span>}
      {isPR(sale) && <span className={cn(pill, "bg-pink-100 text-pink-700 dark:bg-pink-950/40 dark:text-pink-300")} title="Given free for promotion"><Gift size={9} aria-hidden /> PR</span>}
      <ExchangeBadge sale={sale} />
      {ad && <span className={cn(pill, "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300")} title={sale.referral ?? ""}><Megaphone size={9} aria-hidden /> {ad}</span>}
    </span>
  );
}

const RowNumber = ({ n }: { n: number }) => (
  <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-muted px-1.5 text-[11px] font-bold tabular-nums text-muted-foreground">{n}</span>
);

function StatusPill({ sale }: { sale: Sale }) {
  const status = sale.courierStatus ?? "unassigned-pickup";
  return <span className={cn("inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold", courierStatusStyle(status))}>{courierStatusLabel(status)}</span>;
}

function CallLink({ sale, className }: { sale: Sale; className?: string }) {
  const phone = sale.customerPhone?.trim();
  if (!phone) return null;
  return (
    <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} aria-label={`Call ${sale.customerName || "the customer"} on ${phone}`} className={className}>
      <Phone size={11} aria-hidden /> {phone}
    </a>
  );
}

/**
 * A click anywhere on a row opens the customer's page, as on Customers & Orders,
 * except on the row's own links and buttons, or while selecting text to copy.
 */
function useOpenCustomer() {
  const router = useRouter();
  return (e: React.MouseEvent<HTMLElement>, sale: Sale) => {
    const target = e.target as HTMLElement;
    if (!e.currentTarget.contains(target)) return;
    if (target.closest("a, button, input, select, textarea, label, [role='dialog']")) return;
    if (window.getSelection()?.toString()) return;
    const href = `/customers/${encodeURIComponent(customerKey(sale))}`;
    if (e.ctrlKey || e.metaKey) window.open(href, "_blank");
    else router.push(href);
  };
}

function TableRow({ n, sale, at, bucket, onTrack }: RowProps) {
  const { tone, text } = age({ at, bucket });
  const cod = upayaCod(sale);
  const address = deliveryAddress(sale.customerAddress);
  const openCustomer = useOpenCustomer();
  return (
    <tr onClick={e => openCustomer(e, sale)} className="data-row cursor-pointer border-t border-border/50 align-middle">
      <td className="py-3 pl-4 pr-2"><RowNumber n={n} /></td>
      <td className="px-3 py-3">
        <Link href={`/customers/${encodeURIComponent(customerKey(sale))}`} className="font-mono text-xs font-bold hover:text-primary">{sale.invoiceNumber}</Link>
        {sale.customer?.code && <p className="font-mono text-[10px] text-muted-foreground">{sale.customer.code}</p>}
      </td>
      <td className="px-3 py-3">
        <p className="truncate text-[13px] font-semibold text-foreground">{sale.customerName || "Customer"}</p>
        <CallLink sale={sale} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary" />
      </td>
      <td className="px-3 py-3">
        <p className="truncate text-xs text-foreground" title={address}>{address || "No address"}</p>
        {sale.courierAreaTitle && <p className="truncate text-[11px] text-muted-foreground" title={sale.courierAreaTitle}>Hub: {sale.courierAreaTitle}</p>}
      </td>
      <td className="px-3 py-3">
        <OrderTags sale={sale} plain />
      </td>
      <td className="px-3 py-3">
        <StatusPill sale={sale} />
        {sale.courierCheckedAt && <p className="mt-0.5 text-[10px] text-muted-foreground">Checked {timeAgo(sale.courierCheckedAt).toLowerCase()}</p>}
      </td>
      <td className="px-3 py-3 text-right">
        {cod > 0 ? <span className="whitespace-nowrap text-[13px] font-bold tabular-nums">{formatNPR(cod)}</span> : <span className="text-xs text-muted-foreground">No COD</span>}
      </td>
      <td className="px-3 py-3">
        <LatestComment sale={sale} onTrack={onTrack} />
      </td>
      <td className="px-3 py-3">
        <TrackButton sale={sale} onTrack={onTrack} />
      </td>
      <td className="py-3 pl-3 pr-4" title={at.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}>
        <p className={cn("text-xs", tone)}>{text}</p>
        <p className="text-[10px] text-muted-foreground">{shortDate(at)}</p>
      </td>
    </tr>
  );
}

function TrackButton({ sale, onTrack }: Pick<RowProps, "sale" | "onTrack">) {
  return (
    <button
      type="button"
      onClick={() => onTrack(sale, false)}
      title="Upaya's tracking history for this parcel"
      aria-label={`Track ${sale.invoiceNumber} (${sale.courierTrackingCode})`}
      className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-semibold transition-colors hover:border-primary/40 hover:bg-primary/5"
    >
      <Truck size={12} className="shrink-0" aria-hidden />
      <span className="truncate font-mono text-[11px]">{sale.courierTrackingCode}</span>
    </button>
  );
}

/**
 * The newest comment on the parcel (saved each time Karmify checks it with
 * Upaya), and who wrote it. Opens the full thread with the cursor in the box.
 */
function LatestComment({ sale, onTrack, className }: Pick<RowProps, "sale" | "onTrack"> & { className?: string }) {
  const comment = sale.courierComment?.trim();
  if (!comment) {
    return (
      <button
        type="button"
        onClick={() => onTrack(sale, true)}
        aria-label={`Comment to Upaya on ${sale.invoiceNumber}`}
        className={cn("inline-flex items-center gap-1 rounded-md py-1 text-xs text-muted-foreground transition-colors hover:text-primary", className)}
      >
        <MessageSquare size={12} aria-hidden /> Add comment
      </button>
    );
  }
  const by = sale.courierCommentBy ?? "Upaya";
  const ours = by === "You";
  const at = latestCommentTime(sale);
  return (
    <button
      type="button"
      onClick={() => onTrack(sale, true)}
      title={`${by}: ${comment}`}
      aria-label={`Latest comment on ${sale.invoiceNumber}, from ${by}: ${comment}. Open comments`}
      className={cn(
        "block w-full rounded-lg border px-2.5 py-1.5 text-left transition-colors hover:border-primary/40 hover:bg-primary/5",
        ours ? "border-primary/15 bg-primary/5" : "border-border bg-muted/40",
        className,
      )}
    >
      <span className={cn("flex items-center gap-1 text-[10px] font-bold", ours ? "text-primary dark:text-pink-300" : "text-muted-foreground")}>
        <MessageSquare size={10} aria-hidden /> {by}
        {at && <time dateTime={at} title={new Date(at).toLocaleString()} className="ml-auto font-medium tabular-nums">{commentTimeLabel(at)}</time>}
      </span>
      <span className="line-clamp-2 break-words text-xs text-foreground">{comment}</span>
    </button>
  );
}

function CardRow({ n, sale, at, bucket, onTrack }: RowProps) {
  const { tone, text } = age({ at, bucket });
  const cod = upayaCod(sale);
  const address = deliveryAddress(sale.customerAddress);
  const openCustomer = useOpenCustomer();
  return (
    <li onClick={e => openCustomer(e, sale)} className="data-row flex cursor-pointer gap-3 px-3 py-3.5">
      <RowNumber n={n} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <Link href={`/customers/${encodeURIComponent(customerKey(sale))}`} className="font-mono text-xs font-bold hover:text-primary">{sale.invoiceNumber}</Link>
          <span className={cn("shrink-0 text-[11px]", tone)} title={shortDate(at)}>{text === "Today" ? "Booked today" : `Booked ${text}`}</span>
        </div>
        <OrderTags sale={sale} />
        <div>
          <p className="text-[13px] font-semibold text-foreground">{sale.customerName || "Customer"}</p>
          <CallLink sale={sale} className="inline-flex items-center gap-1 py-0.5 text-xs font-medium text-primary dark:text-pink-300" />
        </div>
        <p className="text-xs text-muted-foreground">
          {address || "No address"}{sale.courierAreaTitle && <> · Hub: {sale.courierAreaTitle}</>}
        </p>
        <LatestComment sale={sale} onTrack={onTrack} />
        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill sale={sale} />
            <span className="text-xs font-semibold tabular-nums">{cod > 0 ? `COD ${formatNPR(cod)}` : <span className="font-normal text-muted-foreground">No COD</span>}</span>
          </span>
          <TrackButton sale={sale} onTrack={onTrack} />
        </div>
      </div>
    </li>
  );
}
