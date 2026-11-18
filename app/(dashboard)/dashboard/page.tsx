// app/(dashboard)/dashboard/page.tsx
"use client";

// The day-to-day overview: today's numbers, what needs doing, how sales are
// going over a chosen period, and the latest orders, stock and activity.
// Deeper breakdowns live on the Analytics page.

import React, { useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useUser } from "@clerk/nextjs";
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, CheckCircle2, CircleDollarSign, Globe,
  BellRing, EyeOff, MapPinOff, PackageX, PlusCircle, ReceiptText, RotateCcw, ShoppingBag, ShoppingCart, Store, Truck, Wallet,
} from "lucide-react";
import { cn, formatNPR } from "@/lib/utils";
import { Pulse } from "@/components/shared/Pulse";
import { ActivityRowPlaceholder, ChartPlaceholder, LowStockRowPlaceholder } from "@/components/skeletons/placeholders";
import { useResources } from "@/lib/useResources";
import { resources } from "@/lib/resources";
import { countsAsSale, customerKey, DELIVERY_STATUSES, DELIVERY_STYLES, itemName } from "@/lib/orders";
import { COURIER_FINAL_STATUSES, courierCodAmount } from "@/lib/courier";
import { buildBuckets, RangeSelector, type RangeKey } from "@/components/dashboard/RangeSelector";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { lowStockLines, lowStockName, type LowStockLine } from "@/lib/lowStock";
import { setLowStockIgnored } from "@/app/actions";
import { mutate } from "@/lib/mutate";
import { InstallAppCard } from "@/components/shared/InstallAppCard";

const RevenueChart = dynamic(() => import("@/components/dashboard/Charts").then(m => m.RevenueChart), {
  ssr: false,
  loading: () => <ChartPlaceholder />,
});

const PIPELINE: { key: string; label: string; color: string }[] = [
  { key: "IN_PROCESS", label: "In process", color: "#F4A6BE" },
  { key: "DELIVERED", label: "Delivered", color: "#22c55e" },
  { key: "RETURN_PROCESS", label: "Return in process", color: "#f59e0b" },
  { key: "RETURNED", label: "Returned", color: "#ef4444" },
  { key: "CANCELLED", label: "Cancelled", color: "#a1a1aa" },
];

const RANGE_LABEL: Record<RangeKey, string> = {
  today: "today",
  week: "the last 7 days",
  month: "the last 30 days",
  year: "the last 12 months",
  custom: "the chosen dates",
};

const card = "bg-card border border-border/80 rounded-2xl shadow-sm";

function startOfDay(offsetDays = 0) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
}

/** Percent change, or null when there's nothing to compare with. */
function change(current: number, previous: number) {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

function Delta({ value, label }: { value: number | null; label: string }) {
  if (value === null) return <span className="text-[11px] text-muted-foreground">{label}</span>;
  const up = value >= 0;
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-[11px]">
      <span
        className={cn(
          "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-bold",
          up ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400" : "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400"
        )}
      >
        {up ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
        {Math.abs(value)}%
      </span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function StatCard({
  label, value, icon: Icon, tone, loading, children, href,
}: {
  label: string;
  value: string;
  icon: typeof Wallet;
  tone: string;
  loading: boolean;
  children?: React.ReactNode;
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-semibold text-muted-foreground">{label}</span>
        <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg sm:h-8 sm:w-8", tone)}>
          <Icon size={15} />
        </span>
      </div>
      {/* Phones show two cards side by side, so the numbers are a size smaller there. */}
      {loading ? <Pulse className="mt-1 h-7 w-24 sm:h-8 sm:w-28" /> : <p className="mt-1 break-words text-lg font-black tracking-tight text-foreground sm:text-2xl">{value}</p>}
      <div className="mt-1.5 min-h-5 sm:mt-2">{loading ? <Pulse className="h-4 w-24 sm:w-32" /> : children}</div>
    </>
  );
  const className = cn(card, "block p-3.5 transition-colors sm:p-5", href && "hover:border-primary/40");
  return href ? <Link href={href} className={className}>{body}</Link> : <div className={className}>{body}</div>;
}

export default function Dashboard() {
  const { products, sales, stocks, activities, loading, refetch } = useResources({
    products: resources.products,
    sales: resources.sales,
    stocks: resources.stocks,
    activities: resources.activities,
  });
  const { user } = useUser();
  const [ignoreTarget, setIgnoreTarget] = useState<LowStockLine | null>(null);
  const [showIgnored, setShowIgnored] = useState(false);
  const [range, setRange] = useState<RangeKey>("week");
  const [customStart, setCustomStart] = useState<Date | null>(null);
  const [customEnd, setCustomEnd] = useState<Date | null>(null);

  /* ── Today, yesterday and this month ── */
  const today = useMemo(() => {
    const todayStart = startOfDay();
    const yesterdayStart = startOfDay(-1);
    const nowMs = new Date().getTime();
    // Yesterday up to the same time of day, so the comparison is fair all day long.
    const yesterdaySameTime = yesterdayStart.getTime() + (nowMs - todayStart.getTime());
    const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
    const lastMonthStart = new Date(todayStart.getFullYear(), todayStart.getMonth() - 1, 1);
    const lastMonthSameDay = new Date(lastMonthStart.getFullYear(), lastMonthStart.getMonth(), todayStart.getDate() + 1);

    let todaySales = 0, todayOrders = 0, todayWebsite = 0, yesterdaySales = 0, yesterdayOrders = 0;
    let monthSales = 0, monthOrders = 0, lastMonthSales = 0;
    let codOut = 0, codOutOrders = 0;

    for (const sale of sales) {
      const t = new Date(sale.createdAt).getTime();
      const counts = countsAsSale(sale);
      if (t >= todayStart.getTime()) {
        todayOrders += 1;
        if (sale.source === "website") todayWebsite += 1;
        if (counts) todaySales += sale.totalAmount;
      } else if (t >= yesterdayStart.getTime() && t < yesterdaySameTime) {
        yesterdayOrders += 1;
        if (counts) yesterdaySales += sale.totalAmount;
      }
      if (counts && t >= monthStart.getTime()) {
        monthSales += sale.totalAmount;
        monthOrders += 1;
      }
      if (counts && t >= lastMonthStart.getTime() && t < Math.min(lastMonthSameDay.getTime(), monthStart.getTime())) {
        lastMonthSales += sale.totalAmount;
      }
      // Cash still to come in: orders on their way that collect on delivery.
      if (sale.deliveryStatus === "IN_PROCESS") {
        const cod = courierCodAmount(sale);
        if (cod > 0) {
          codOut += cod;
          codOutOrders += 1;
        }
      }
    }
    return {
      todaySales, todayOrders, todayWebsite, yesterdaySales, yesterdayOrders,
      monthSales, monthOrders, lastMonthSales, codOut, codOutOrders,
    };
  }, [sales]);

  /* ── What needs doing ── */
  const attention = useMemo(() => {
    let readyForUpaya = 0, missingHub = 0, onTheWay = 0, returns = 0, unpaidDelivered = 0, unpaidAmount = 0;
    for (const sale of sales) {
      const withCourier = Boolean(sale.courierTrackingCode) && sale.courierStatus !== "cancelled";
      if (sale.deliveryStatus === "IN_PROCESS") {
        if (withCourier) {
          if (!COURIER_FINAL_STATUSES.includes(sale.courierStatus ?? "")) onTheWay += 1;
        } else if (sale.deliveryVia) {
          // Sent with Yango: nothing to do with Upaya.
        } else if (sale.courierAreaId) readyForUpaya += 1;
        else if (sale.customerAddress) missingHub += 1;
      }
      if (sale.deliveryStatus === "RETURN_PROCESS") returns += 1;
      if (sale.deliveryStatus === "DELIVERED" && sale.paymentStatus !== "PAID") {
        unpaidDelivered += 1;
        unpaidAmount += courierCodAmount({ ...sale, paymentStatus: "UNPAID" });
      }
    }

    let outOfStock = 0;
    const qtyByProduct = new Map<string, number>();
    for (const stock of stocks) qtyByProduct.set(stock.productId, (qtyByProduct.get(stock.productId) ?? 0) + stock.quantity);
    for (const product of products) {
      if (product.status !== "active") continue;
      if ((qtyByProduct.get(product.id) ?? 0) <= 0) outOfStock += 1;
    }
    // Per size and colour, so one sold-out size shows even when the total looks fine.
    const lines = lowStockLines(products, qtyByProduct);
    const low = lines.filter(l => !l.ignored);
    const ignoredLow = lines.filter(l => l.ignored);

    return { readyForUpaya, missingHub, onTheWay, returns, unpaidDelivered, unpaidAmount, low, ignoredLow, outOfStock };
  }, [sales, stocks, products]);

  /* ── The chosen period ── */
  const period = useMemo(() => {
    const buckets = buildBuckets(range, customStart ?? undefined, customEnd ?? undefined);
    const start = buckets[0].start.getTime();
    const end = buckets[buckets.length - 1].end.getTime();
    const inPeriod = sales.filter(s => {
      const t = new Date(s.createdAt).getTime();
      return t >= start && t < end;
    });
    const counted = inPeriod.filter(countsAsSale);

    const chart = buckets.map(b => ({
      label: b.label,
      amount: counted
        .filter(s => {
          const t = new Date(s.createdAt);
          return t >= b.start && t < b.end;
        })
        .reduce((sum, s) => sum + s.totalAmount, 0),
    }));

    const revenue = counted.reduce((sum, s) => sum + s.totalAmount, 0);
    const pipeline = PIPELINE.map(p => ({ ...p, count: inPeriod.filter(s => s.deliveryStatus === p.key).length }));

    const top = new Map<string, { name: string; units: number; revenue: number }>();
    for (const sale of counted) {
      for (const item of sale.items) {
        const row = top.get(item.productId) ?? { name: item.product.name, units: 0, revenue: 0 };
        row.units += item.quantity;
        row.revenue += item.quantity * item.unitPrice;
        top.set(item.productId, row);
      }
    }
    const topProducts = [...top.values()].sort((a, b) => b.units - a.units || b.revenue - a.revenue).slice(0, 5);

    return {
      chart, revenue, orders: inPeriod.length, average: counted.length ? revenue / counted.length : 0,
      pipeline, pipelineTotal: inPeriod.length, topProducts,
    };
  }, [sales, range, customStart, customEnd]);

  const recentOrders = sales.slice(0, 6);
  const todayLabel = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kathmandu" });

  const tasks = [
    { label: "Ready to send to Upaya", note: "In process with a hub location", count: attention.readyForUpaya, icon: Truck, href: "/customers?status=IN_PROCESS&source=waiting", tone: "text-primary bg-primary/10" },
    { label: "Need a hub location", note: "Delivery orders without an Upaya area", count: attention.missingHub, icon: MapPinOff, href: "/customers?status=IN_PROCESS&source=waiting", tone: "text-amber-600 bg-amber-100 dark:text-amber-400 dark:bg-amber-950/40" },
    { label: "Returns on the way back", note: "Check them in when they arrive", count: attention.returns, icon: RotateCcw, href: "/customers?status=RETURN_PROCESS", tone: "text-orange-600 bg-orange-100 dark:text-orange-400 dark:bg-orange-950/40" },
    {
      label: "Delivered, not marked paid",
      note: attention.unpaidAmount > 0 ? `${formatNPR(attention.unpaidAmount)} to reconcile` : "Match against Upaya's COD payout",
      count: attention.unpaidDelivered, icon: Wallet, href: "/customers?status=DELIVERED", tone: "text-red-600 bg-red-100 dark:text-red-400 dark:bg-red-950/40",
    },
    { label: "Low on stock", note: "Sizes and colours below their minimum", count: attention.low.length, icon: AlertTriangle, href: "/inventory", tone: "text-amber-600 bg-amber-100 dark:text-amber-400 dark:bg-amber-950/40" },
    { label: "Out of stock", note: "Active products with nothing left", count: attention.outOfStock, icon: PackageX, href: "/inventory", tone: "text-red-600 bg-red-100 dark:text-red-400 dark:bg-red-950/40" },
  ];
  const openTasks = tasks.filter(t => t.count > 0).length;

  async function toggleIgnored(line: LowStockLine, ignore: boolean) {
    const result = await mutate(
      () => setLowStockIgnored({ productId: line.productId, variantId: line.variantId, ignore }),
      { success: ignore ? `Ignoring ${lowStockName(line)} until it's restocked.` : `Low-stock alert for ${lowStockName(line)} is back on.` }
    );
    if (result.ok) await refetch();
  }

  return (
    <div className="space-y-4 sm:space-y-5 animate-fade-in">
      {/* Phones: offer to install Karmify as an app (hidden once installed or dismissed). */}
      <InstallAppCard />

      {/* Greeting + quick actions */}
      <div className={cn(card, "flex flex-col gap-4 p-5 sm:p-6 md:flex-row md:items-center md:justify-between")}>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{todayLabel}</p>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-foreground md:text-2xl">
            {greeting()}{user?.firstName ? `, ${user.firstName}` : ""}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {loading
              ? "Loading today's numbers…"
              : openTasks === 0
                ? "Everything is up to date."
                : `${openTasks} thing${openTasks === 1 ? "" : "s"} need${openTasks === 1 ? "s" : ""} your attention today.`}
          </p>
        </div>
        {/* A 2 × 2 grid of equal buttons on phones, a row from tablet size up. */}
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <Link href="/sales" className="flex items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 sm:py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90">
            <ShoppingCart size={13} /> New sale
          </Link>
          <Link href="/customers" className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-secondary px-4 py-2.5 sm:py-2 text-xs font-semibold text-secondary-foreground transition-colors hover:bg-muted">
            <ReceiptText size={13} /> Orders
          </Link>
          <Link href="/products" className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-secondary px-4 py-2.5 sm:py-2 text-xs font-semibold text-secondary-foreground transition-colors hover:bg-muted">
            <PlusCircle size={13} /> Add product
          </Link>
          <Link href="/analytics" className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-secondary px-4 py-2.5 sm:py-2 text-xs font-semibold text-secondary-foreground transition-colors hover:bg-muted">
            <BarChart3 size={13} /> Analytics
          </Link>
        </div>
      </div>

      {/* Today at a glance */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Sales today" value={formatNPR(today.todaySales)} icon={CircleDollarSign} tone="bg-primary/10 text-primary" loading={loading} href="/customers?filter=today">
          <Delta value={change(today.todaySales, today.yesterdaySales)} label={today.yesterdaySales > 0 ? "vs this time yesterday" : "Nothing by this time yesterday"} />
        </StatCard>
        <StatCard label="Orders today" value={String(today.todayOrders)} icon={ShoppingBag} tone="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" loading={loading} href="/customers?filter=today">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Globe size={11} /> {today.todayWebsite} website</span>
            <span className="inline-flex items-center gap-1"><Store size={11} /> {today.todayOrders - today.todayWebsite} in store</span>
            <span>· {today.yesterdayOrders} by now yesterday</span>
          </span>
        </StatCard>
        <StatCard label="This month" value={formatNPR(today.monthSales)} icon={BarChart3} tone="bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400" loading={loading} href="/analytics">
          <Delta value={change(today.monthSales, today.lastMonthSales)} label={`${today.monthOrders} orders · vs same days last month`} />
        </StatCard>
        <StatCard label="COD still to collect" value={formatNPR(today.codOut)} icon={Wallet} tone="bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400" loading={loading} href="/customers?status=IN_PROCESS">
          <span className="text-[11px] text-muted-foreground">
            From {today.codOutOrders} order{today.codOutOrders === 1 ? "" : "s"} still in process
          </span>
        </StatCard>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Needs attention */}
        <section className={cn(card, "p-5 sm:p-6")} aria-labelledby="attention-title">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="attention-title" className="text-base font-bold text-foreground">Needs attention</h2>
            {!loading && openTasks === 0 && (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 size={13} /> All clear
              </span>
            )}
          </div>
          <ul className="space-y-1">
            {tasks.map(task => {
              const Icon = task.icon;
              const done = !loading && task.count === 0;
              return (
                <li key={task.label}>
                  <Link
                    href={task.href}
                    className="group flex items-center gap-3 rounded-xl px-2.5 py-2.5 transition-colors hover:bg-muted/60"
                  >
                    <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", done ? "bg-muted text-muted-foreground" : task.tone)}>
                      {done ? <CheckCircle2 size={16} /> : <Icon size={16} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-sm font-semibold", done ? "text-muted-foreground" : "text-foreground")}>{task.label}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{task.note}</span>
                    </span>
                    {loading ? (
                      <Pulse className="h-6 w-8 rounded-md" />
                    ) : (
                      <span className={cn("min-w-8 rounded-md px-2 py-0.5 text-center text-sm font-black", done ? "text-muted-foreground" : "bg-muted text-foreground")}>
                        {task.count}
                      </span>
                    )}
                    <ArrowRight size={14} className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </Link>
                </li>
              );
            })}
          </ul>
          {!loading && attention.onTheWay > 0 && (
            <p className="mt-3 flex items-center gap-1.5 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
              <Truck size={12} /> {attention.onTheWay} order{attention.onTheWay === 1 ? " is" : "s are"} with Upaya on the way.
            </p>
          )}
        </section>

        {/* Sales over the period */}
        <section className={cn(card, "flex flex-col p-5 sm:p-6 lg:col-span-2")} aria-labelledby="sales-title">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 id="sales-title" className="text-base font-bold text-foreground">Sales</h2>
              <p className="text-[11px] text-muted-foreground">Cancelled orders left out · {RANGE_LABEL[range]}</p>
            </div>
            <RangeSelector
              value={range}
              onChange={setRange}
              showCustom
              onCustomChange={(start, end) => {
                setCustomStart(start);
                setCustomEnd(end);
              }}
            />
          </div>
          <dl className="mt-4 grid grid-cols-3 gap-3">
            {[
              { label: "Revenue", value: formatNPR(period.revenue) },
              { label: "Orders", value: String(period.orders) },
              { label: "Average order", value: formatNPR(Math.round(period.average)) },
            ].map(stat => (
              <div key={stat.label} className="rounded-xl bg-muted/40 px-3 py-2.5">
                <dt className="text-[11px] text-muted-foreground">{stat.label}</dt>
                <dd className="text-sm font-black text-foreground sm:text-base">{loading ? <Pulse className="mt-1 h-5 w-16" /> : stat.value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 h-60 w-full text-xs">
            {loading ? <ChartPlaceholder /> : <RevenueChart data={period.chart} tickInterval={range === "month" ? 3 : 0} />}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Order pipeline */}
        <section className={cn(card, "p-5 sm:p-6")} aria-labelledby="pipeline-title">
          <h2 id="pipeline-title" className="text-base font-bold text-foreground">Where orders are</h2>
          <p className="text-[11px] text-muted-foreground">{period.pipelineTotal} orders placed in {RANGE_LABEL[range]}</p>
          <ul className="mt-4 space-y-3">
            {period.pipeline.map(step => {
              const pct = period.pipelineTotal ? (step.count / period.pipelineTotal) * 100 : 0;
              return (
                <li key={step.key}>
                  <Link href={`/customers?status=${step.key}`} className="block rounded-lg transition-opacity hover:opacity-80">
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2 font-medium text-foreground">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: step.color }} />
                        {step.label}
                      </span>
                      <span className="font-bold text-foreground">
                        {loading ? "–" : step.count}
                        <span className="ml-1.5 font-medium text-muted-foreground">{loading ? "" : `${Math.round(pct)}%`}</span>
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, backgroundColor: step.color }} />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Best sellers */}
        <section className={cn(card, "p-5 sm:p-6")} aria-labelledby="top-title">
          <div className="flex items-center justify-between">
            <div>
              <h2 id="top-title" className="text-base font-bold text-foreground">Best sellers</h2>
              <p className="text-[11px] text-muted-foreground">Items sold in {RANGE_LABEL[range]}</p>
            </div>
            <Link href="/analytics" className="flex items-center gap-0.5 text-[11px] font-semibold text-primary hover:underline">
              More <ArrowRight size={10} />
            </Link>
          </div>
          <ol className="mt-4 space-y-2.5">
            {loading ? (
              Array.from({ length: 4 }, (_, i) => <li key={i}><LowStockRowPlaceholder /></li>)
            ) : period.topProducts.length === 0 ? (
              <li className="py-8 text-center text-xs text-muted-foreground">No sales in this period yet.</li>
            ) : (
              period.topProducts.map((p, i) => (
                <li key={p.name + i} className="flex items-center gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-black text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-foreground">{p.name}</span>
                    <span className="block text-[11px] text-muted-foreground">{formatNPR(p.revenue)}</span>
                  </span>
                  <span className="shrink-0 text-xs font-bold text-foreground">{p.units} sold</span>
                </li>
              ))
            )}
          </ol>
        </section>

        {/* Low stock */}
        <section className={cn(card, "p-5 sm:p-6")} aria-labelledby="low-title">
          <div className="flex items-center justify-between">
            <div>
              <h2 id="low-title" className="text-base font-bold text-foreground">Low stock</h2>
              <p className="text-[11px] text-muted-foreground">Each size and colour below the minimum you set</p>
            </div>
            <Link href="/inventory" className="flex items-center gap-0.5 text-[11px] font-semibold text-primary hover:underline">
              Inventory <ArrowRight size={10} />
            </Link>
          </div>
          <ul className="mt-4 max-h-64 space-y-2 overflow-y-auto">
            {loading ? (
              Array.from({ length: 3 }, (_, i) => <li key={i}><LowStockRowPlaceholder /></li>)
            ) : attention.low.length === 0 ? (
              <li className="flex flex-col items-center gap-2 py-8 text-center">
                <CheckCircle2 size={24} className="text-emerald-500" />
                <span className="text-xs font-semibold">Nothing is running low</span>
              </li>
            ) : (
              attention.low.slice(0, 8).map(item => (
                <li key={item.key} className="flex items-center gap-1.5 rounded-xl border border-border/60 pr-1.5 transition-colors hover:bg-muted/50">
                  <Link href={`/inventory?q=${encodeURIComponent(item.name)}`} className="flex min-w-0 flex-1 items-center gap-3 py-2 pl-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-foreground">{item.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {item.variant ? <span className="font-semibold text-foreground/80">{item.variant}</span> : item.sku}
                        {" · "}min {item.min}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-extrabold uppercase",
                        item.quantity <= 0 ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400" : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                      )}
                    >
                      {item.quantity <= 0 ? "Out" : `${item.quantity} left`}
                    </span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => setIgnoreTarget(item)}
                    title="Ignore until restocked"
                    aria-label={`Ignore low stock for ${lowStockName(item)}`}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
                  >
                    <EyeOff size={13} />
                  </button>
                </li>
              ))
            )}
            {!loading && attention.low.length > 8 && (
              <li className="pt-1 text-center text-[11px] text-muted-foreground">and {attention.low.length - 8} more</li>
            )}
            {!loading && showIgnored && attention.ignoredLow.map(item => (
              <li key={item.key} className="flex items-center gap-2 rounded-xl border border-dashed border-border/60 py-1.5 pl-3 pr-1.5 opacity-70">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-foreground">{lowStockName(item)}</span>
                  <span className="block text-[11px] text-muted-foreground">Ignored · {item.quantity <= 0 ? "out" : `${item.quantity} left`} · min {item.min}</span>
                </span>
                <button
                  type="button"
                  onClick={() => toggleIgnored(item, false)}
                  title="Show this alert again"
                  aria-label={`Turn the low-stock alert back on for ${lowStockName(item)}`}
                  className="flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/10 cursor-pointer"
                >
                  <BellRing size={12} /> Restore
                </button>
              </li>
            ))}
          </ul>
          {!loading && attention.ignoredLow.length > 0 && (
            <button
              type="button"
              onClick={() => setShowIgnored(v => !v)}
              aria-expanded={showIgnored}
              className="mt-2 w-full text-center text-[11px] font-semibold text-muted-foreground hover:text-foreground cursor-pointer"
            >
              {showIgnored ? "Hide ignored" : `${attention.ignoredLow.length} ignored · show`}
            </button>
          )}
          <ConfirmDialog
            open={ignoreTarget !== null}
            onClose={() => setIgnoreTarget(null)}
            onConfirm={async () => {
              if (ignoreTarget) await toggleIgnored(ignoreTarget, true);
              setIgnoreTarget(null);
            }}
            title={`Ignore low stock for ${ignoreTarget ? lowStockName(ignoreTarget) : "this item"}?`}
            description={
              ignoreTarget
                ? `It has ${ignoreTarget.quantity <= 0 ? "none" : ignoreTarget.quantity} left (minimum ${ignoreTarget.min}). The alert will stay hidden until this ${ignoreTarget.variant ? "size/colour" : "product"} is restocked, then come back if it runs low again. You can restore it from "ignored" below the list.`
                : ""
            }
            confirmLabel="Ignore alert"
            cancelLabel="Keep alert"
          />

        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Latest orders */}
        <section className={cn(card, "p-5 sm:p-6 lg:col-span-2")} aria-labelledby="recent-title">
          <div className="flex items-center justify-between">
            <h2 id="recent-title" className="text-base font-bold text-foreground">Latest orders</h2>
            <Link href="/customers" className="flex items-center gap-0.5 text-[11px] font-semibold text-primary hover:underline">
              All orders <ArrowRight size={10} />
            </Link>
          </div>
          <ul className="mt-3 divide-y divide-border/50">
            {loading ? (
              Array.from({ length: 4 }, (_, i) => <li key={i}><ActivityRowPlaceholder /></li>)
            ) : recentOrders.length === 0 ? (
              <li className="py-8 text-center text-xs text-muted-foreground">No orders yet.</li>
            ) : (
              recentOrders.map(sale => (
                <li key={sale.id}>
                  <Link href={`/customers/${encodeURIComponent(customerKey(sale))}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/50">
                    <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", sale.source === "website" ? "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400" : "bg-muted text-muted-foreground")}>
                      {sale.source === "website" ? <Globe size={14} /> : <Store size={14} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="truncate text-xs font-semibold text-foreground">{sale.customerName || "Walk-in"}</span>
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{sale.invoiceNumber}</span>
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {sale.items.map(item => `${item.quantity} × ${itemName(item)}`).join(", ")}
                      </span>
                    </span>
                    <span className="hidden shrink-0 sm:block">
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase", DELIVERY_STYLES[sale.deliveryStatus] ?? DELIVERY_STYLES.IN_PROCESS)}>
                        {DELIVERY_STATUSES.find(d => d.value === sale.deliveryStatus)?.label ?? "In Process"}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-xs font-bold text-foreground">{formatNPR(sale.totalAmount)}</span>
                      <span className="block text-[10px] text-muted-foreground">
                        {new Date(sale.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </span>
                    </span>
                  </Link>
                </li>
              ))
            )}
          </ul>
        </section>

        {/* Recent activity */}
        <section className={cn(card, "p-5 sm:p-6")} aria-labelledby="activity-title">
          <h2 id="activity-title" className="text-base font-bold text-foreground">Recent activity</h2>
          <p className="text-[11px] text-muted-foreground">What changed in the store lately</p>
          <ol className="relative mt-4 space-y-4 before:absolute before:bottom-1 before:left-[13px] before:top-1 before:w-px before:bg-border">
            {loading ? (
              Array.from({ length: 4 }, (_, i) => <li key={i}><ActivityRowPlaceholder /></li>)
            ) : activities.length === 0 ? (
              <li className="py-6 text-center text-xs text-muted-foreground">No activity yet.</li>
            ) : (
              activities.slice(0, 6).map(act => (
                <li key={act.id} className="relative flex gap-3">
                  <span className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
                    <Activity size={12} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-xs font-bold text-foreground">{act.action}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {new Date(act.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </span>
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-[11px] text-muted-foreground">{act.details}</span>
                  </span>
                </li>
              ))
            )}
          </ol>
        </section>
      </div>
    </div>
  );
}
