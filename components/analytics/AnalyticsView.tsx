"use client";

// Sales analytics. The page (app/(dashboard)/analytics) loads the data; this draws it.

import React, { useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowDownRight, ArrowUpRight, CalendarDays, Minus } from "lucide-react";
import { cn, formatNPR } from "@/lib/utils";
import { DELIVERY_STATUSES, DELIVERY_STYLES } from "@/lib/orders";
import { DateRangeCalendar, fromDateKey, shortDay } from "@/components/shared/DateRangeCalendar";
import { buildAnalytics, change, periodFor, RANGES, type Ranked, type RangeKey } from "@/lib/analytics";

const SalesTrendChart = dynamic(() => import("@/components/analytics/SalesTrendChart"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-xl bg-muted/50" />,
});

const card = "bg-card border border-border/80 rounded-2xl shadow-sm p-5";
const pct = (n: number) => `${Math.round(n * 100)}%`;

/* ── Pieces ─────────────────────────────────────────────────────────── */

function Delta({ value, goodWhenUp = true, hasPrevious = false }: { value: number | null; goodWhenUp?: boolean; hasPrevious?: boolean }) {
  // null with a previous period means it went up from nothing.
  if (value === null) {
    return hasPrevious
      ? <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-bold text-muted-foreground">new</span>
      : <span className="text-[12px] text-muted-foreground">no earlier data</span>;
  }
  const flat = Math.abs(value) < 0.005;
  const good = flat ? null : (value > 0) === goodWhenUp;
  const Icon = flat ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[12px] font-bold",
        good === null ? "bg-muted text-muted-foreground" : good ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" : "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
      )}
    >
      <Icon size={12} aria-hidden />
      {flat ? "0%" : `${value > 0 ? "+" : ""}${Math.round(value * 100)}%`}
      <span className="sr-only">{good === null ? "no change" : good ? "better than before" : "worse than before"}</span>
    </span>
  );
}

function Kpi({ label, value, delta, goodWhenUp, hint, hasPrevious }: { label: string; value: string; delta: number | null; goodWhenUp?: boolean; hint?: string; hasPrevious?: boolean }) {
  return (
    <div className={cn(card, "flex flex-col gap-1.5 p-4")}>
      <p className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="whitespace-nowrap text-[17px] font-extrabold tracking-tight text-foreground sm:text-2xl">{value}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <Delta value={delta} goodWhenUp={goodWhenUp} hasPrevious={hasPrevious} />
        {hint && <span className="text-[12px] text-muted-foreground">{hint}</span>}
      </div>
    </div>
  );
}

function Section({ title, note, children, className }: { title: string; note?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn(card, "flex flex-col gap-4", className)}>
      <div>
        <h2 className="text-sm font-bold text-foreground">{title}</h2>
        {note && <p className="mt-0.5 text-[12px] text-muted-foreground">{note}</p>}
      </div>
      {children}
    </section>
  );
}

/** Ranked horizontal bars: one colour, the label and value in text colours, exact numbers on hover. */
function BarList({ rows, format, secondary, empty = "No sales in this period." }: {
  rows: Ranked[];
  format: (n: number) => string;
  secondary?: (row: Ranked) => string;
  empty?: string;
}) {
  if (rows.length === 0) return <p className="py-6 text-center text-xs text-muted-foreground">{empty}</p>;
  const max = Math.max(...rows.map(r => r.value), 1);
  return (
    <ul className="flex flex-col gap-1">
      {rows.map(row => {
        const body = (
          <>
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="min-w-0 truncate font-semibold text-foreground">{row.label}</span>
              <span className="shrink-0 font-bold text-foreground">
                {format(row.value)}
                {secondary && <span className="ml-1.5 font-medium text-muted-foreground">{secondary(row)}</span>}
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full rounded-full bg-muted/60">
              <div className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }} />
            </div>
          </>
        );
        const title = `${row.label}: ${format(row.value)}${secondary ? ` · ${secondary(row)}` : ""}`;
        return (
          <li key={row.key}>
            {row.href ? (
              <Link href={row.href} title={title} className="data-row block rounded-lg px-2 py-1.5">{body}</Link>
            ) : (
              <div title={title} className="data-row rounded-lg px-2 py-1.5">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Upright bars for an ordered scale (days of the week, hours of the day). */
function Columns({ rows, labelEvery = 1, unit }: { rows: Ranked[]; labelEvery?: number; unit: string }) {
  const max = Math.max(...rows.map(r => r.value), 1);
  const busiest = rows.reduce((best, r) => (r.value > best.value ? r : best), rows[0]);
  return (
    <div>
      <div className="flex h-32 items-end gap-[2px]">
        {rows.map(row => (
          <div key={row.key} title={`${row.label}: ${row.value} ${unit}${row.value === 1 ? "" : "s"}`} className="group flex h-full flex-1 items-end">
            <div
              className={cn("w-full rounded-t-[4px] transition-opacity group-hover:opacity-100", row.value === 0 ? "bg-muted" : "bg-primary", row.key === busiest?.key ? "opacity-100" : "opacity-70")}
              style={{ height: row.value === 0 ? "2px" : `${Math.max(6, (row.value / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-[2px]">
        {rows.map((row, i) => (
          <span key={row.key} className="flex-1 text-center text-[11px] text-muted-foreground">{i % labelEvery === 0 ? row.label : ""}</span>
        ))}
      </div>
      {busiest && busiest.value > 0 && (
        <p className="mt-2 text-[12px] text-muted-foreground">
          Busiest: <span className="font-semibold text-foreground">{busiest.label}</span> ({busiest.value} {unit}{busiest.value === 1 ? "" : "s"})
        </p>
      )}
    </div>
  );
}

/* ── Page ───────────────────────────────────────────────────────────── */

type ViewProps = {
  sales: Parameters<typeof buildAnalytics>[0];
  products: Parameters<typeof buildAnalytics>[1];
  categories: Parameters<typeof buildAnalytics>[2];
  loading: boolean;
};

export function AnalyticsView({ sales, products, categories, loading }: ViewProps) {
  const [range, setRange] = useState<RangeKey>("30d");
  const [custom, setCustom] = useState<{ start: string; end: string } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const customButton = useRef<HTMLButtonElement>(null);

  const data = useMemo(() => {
    const earliest = sales.length ? new Date(Math.min(...sales.map(s => new Date(s.createdAt).getTime()))) : null;
    const dates = custom ? { start: fromDateKey(custom.start), end: fromDateKey(custom.end) } : undefined;
    const period = periodFor(range, new Date(), earliest, dates);
    return { period, ...buildAnalytics(sales, products, categories, period) };
  }, [sales, products, categories, range, custom]);

  const { totals: t, previous: p } = data;
  const orders = (n: number) => `${n} order${n === 1 ? "" : "s"}`;
  const customLabel = custom ? (custom.start === custom.end ? shortDay(custom.start) : `${shortDay(custom.start)} – ${shortDay(custom.end)}`) : "";
  const rangeLabel = range === "custom" ? customLabel : RANGES.find(r => r.key === range)?.label ?? "";
  const totalOutcomes = data.outcomes.reduce((n, o) => n + o.orders, 0);

  return (
    <div className="space-y-5 pb-28">
      {/* Title and period */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground">Analytics</h1>
          <p className="text-xs text-muted-foreground">
            Sales from the shop and the website · {data.period.prevStart ? "compared with the period just before" : "all orders so far"}
          </p>
        </div>
        <div role="group" aria-label="Period" className="flex flex-wrap gap-1.5">
          {RANGES.map(r => (
            <button
              key={r.key}
              type="button"
              aria-pressed={range === r.key}
              onClick={() => setRange(r.key)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                range === r.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
              )}
            >
              {r.label}
            </button>
          ))}
          <button
            ref={customButton}
            type="button"
            aria-pressed={range === "custom"}
            aria-haspopup="dialog"
            onClick={() => setPickerOpen(open => !open)}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
              range === "custom" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
            )}
          >
            <CalendarDays size={13} aria-hidden />
            {range === "custom" && custom ? customLabel : "Custom"}
          </button>
          {pickerOpen && (
            <DateRangeCalendar
              open={pickerOpen}
              onClose={() => setPickerOpen(false)}
              anchorRef={customButton}
              initialStart={custom?.start}
              initialEnd={custom?.end}
              onApply={(start, end) => {
                setCustom({ start, end });
                setRange("custom");
                setPickerOpen(false);
              }}
            />
          )}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-muted/50" />)}
        </div>
      ) : (
        <>
          {/* Headline numbers */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi hasPrevious={Boolean(p)} label="Sales" value={formatNPR(t.sales)} delta={change(t.sales, p?.sales)} hint="products, after discounts" />
            <Kpi hasPrevious={Boolean(p)} label="Orders" value={String(t.orders)} delta={change(t.orders, p?.orders)} hint={t.cancelledOrders ? `${t.cancelledOrders} cancelled not counted` : undefined} />
            <Kpi hasPrevious={Boolean(p)} label="Average order" value={formatNPR(t.averageOrder)} delta={change(t.averageOrder, p?.averageOrder)} />
            <Kpi hasPrevious={Boolean(p)} label="Items sold" value={String(t.units)} delta={change(t.units, p?.units)} />
            <Kpi hasPrevious={Boolean(p)}
              label="Gross profit"
              value={formatNPR(t.grossProfit)}
              delta={change(t.grossProfit, p?.grossProfit)}
              hint={t.unitsWithoutCost ? `estimate: ${t.unitsWithoutCost} item${t.unitsWithoutCost === 1 ? "" : "s"} have no cost price` : `${t.sales ? pct(t.grossProfit / t.sales) : "0%"} margin`}
            />
            <Kpi hasPrevious={Boolean(p)} label="Repeat customers" value={pct(t.repeatShare)} delta={change(t.repeatShare, p?.repeatShare)} hint="of orders" />
            <Kpi hasPrevious={Boolean(p)} label="Returns" value={formatNPR(t.returns)} delta={change(t.returns, p?.returns)} goodWhenUp={false} hint={`${pct(t.returnRate)} of orders`} />
            <Kpi hasPrevious={Boolean(p)} label="Awaiting payment" value={formatNPR(t.awaitingPayment)} delta={change(t.awaitingPayment, p?.awaitingPayment)} goodWhenUp={false} hint="COD not yet paid" />
          </div>

          {/* Sales by channel: separately and in total */}
          <section className={cn(card, "flex flex-col gap-4")}>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-foreground">Sales by channel</h2>
                <p className="mt-0.5 text-[12px] text-muted-foreground">Each order counted once · products after discounts, without delivery charges</p>
              </div>
              {data.websiteViaUpaya > 0 && (
                <p className="text-[12px] text-muted-foreground">{data.websiteViaUpaya} website order{data.websiteViaUpaya === 1 ? " was" : "s were"} also delivered by Upaya</p>
              )}
            </div>
            <div className={cn("grid gap-3 sm:grid-cols-2", data.channels.length > 3 ? "lg:grid-cols-5" : "lg:grid-cols-4")}>
              {data.channels.map(ch => (
                <div key={ch.key} className="data-row flex flex-col gap-1.5 rounded-xl border border-border/70 p-3.5">
                  <p className="text-[12px] font-semibold text-foreground">{ch.label}</p>
                  <p className="text-xl font-extrabold tracking-tight text-foreground">{formatNPR(ch.sales)}</p>
                  <p className="text-[12px] text-muted-foreground">{orders(ch.orders)} · {t.sales ? pct(ch.sales / t.sales) : "0%"} of sales</p>
                  <div className="h-1.5 w-full rounded-full bg-muted">
                    <div className="h-1.5 rounded-full bg-primary" style={{ width: `${t.sales ? Math.max(ch.sales > 0 ? 2 : 0, (ch.sales / t.sales) * 100) : 0}%` }} />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Delta value={change(ch.sales, ch.previousSales)} hasPrevious={ch.previousSales !== null} />
                    <span className="text-[11px] text-muted-foreground">{ch.note}</span>
                  </div>
                </div>
              ))}
              <div className="flex flex-col gap-1.5 rounded-xl bg-primary p-3.5 text-primary-foreground">
                <p className="text-[12px] font-semibold text-primary-foreground/85">Total</p>
                <p className="text-xl font-extrabold tracking-tight">{formatNPR(t.sales)}</p>
                <p className="text-[12px] text-primary-foreground/85">{orders(t.orders)} · all channels</p>
                <div className="h-1.5 w-full rounded-full bg-primary-foreground/90" />
                <p className="text-[11px] text-primary-foreground/85">
                  {p ? `${(change(t.sales, p.sales) ?? 0) >= 0 ? "+" : ""}${Math.round((change(t.sales, p.sales) ?? 0) * 100)}% on the period before` : "All orders so far"}
                </p>
              </div>
            </div>
          </section>

          {/* Sales over time */}
          <section className={cn(card, "flex flex-col gap-3")}>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-foreground">Sales over time</h2>
                <p className="text-[12px] text-muted-foreground">
                  {rangeLabel} by {data.period.bucket} · delivery charges ({formatNPR(t.delivery)}) and discounts ({formatNPR(t.discounts)}) not included in sales
                </p>
              </div>
              <div className="flex items-center gap-4 text-[12px] text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-[#CB2957]" />This period</span>
                {data.period.prevStart && <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-[#a1a1aa]" />Previous period</span>}
              </div>
            </div>
            <div className="h-64">
              <SalesTrendChart data={data.trend} />
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Best-selling products" note="By sales, with items sold">
              <BarList rows={data.topProducts} format={formatNPR} secondary={r => `${r.secondary} sold`} />
            </Section>
            <Section title="Sales by category">
              <BarList rows={data.categories} format={formatNPR} secondary={r => `${r.secondary} sold`} />
            </Section>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="By shop">
              <BarList rows={data.brands} format={formatNPR} secondary={r => orders(r.secondary ?? 0)} />
            </Section>
            <Section title="How customers pay">
              <BarList rows={data.payment} format={formatNPR} secondary={r => orders(r.secondary ?? 0)} />
            </Section>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Busiest days" note="Orders by day of the week">
              <Columns rows={data.weekdays} unit="order" />
            </Section>
            <Section title="Busiest hours" note="Orders by time of day">
              <Columns rows={data.hours} labelEvery={3} unit="order" />
            </Section>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Section title="Delivery outcomes" note={`All ${totalOutcomes} orders placed in this period, cancelled included`}>
              {totalOutcomes === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">No orders in this period.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {data.outcomes.map(o => (
                    <li key={o.status} className="data-row flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-xs">
                      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-extrabold uppercase", DELIVERY_STYLES[o.status])}>
                        {DELIVERY_STATUSES.find(s => s.value === o.status)?.label ?? o.status}
                      </span>
                      <span className="font-bold text-foreground">
                        {o.orders}
                        <span className="ml-1.5 font-medium text-muted-foreground">{pct(o.orders / totalOutcomes)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Popular sizes" note="Items sold">
              <BarList rows={data.sizes} format={n => String(n)} empty="No sized items sold in this period." />
            </Section>
            <Section title="Popular colours" note="Items sold">
              <BarList rows={data.colours} format={n => String(n)} empty="No coloured items sold in this period." />
            </Section>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Top customers" note="By sales · click to open">
              <BarList rows={data.customers} format={formatNPR} secondary={r => orders(r.secondary ?? 0)} />
            </Section>
            <Section title="Top delivery areas" note="Upaya hub locations, by orders">
              <BarList rows={data.areas} format={orders} secondary={r => formatNPR(r.secondary ?? 0)} empty="No orders with a hub location in this period." />
            </Section>
          </div>
        </>
      )}
    </div>
  );
}
