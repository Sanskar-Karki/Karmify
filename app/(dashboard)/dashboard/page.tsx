// app/(dashboard)/dashboard/page.tsx
"use client";

import React, { useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useUser } from "@clerk/nextjs";
import {
  TrendingUp,
  Package,
  AlertTriangle,
  DollarSign,
  PlusCircle,
  ShoppingCart,
  ArrowRight,
  Activity,
  Layers,
  Database,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn, formatNPR } from "@/lib/utils";
import { Pulse } from "@/components/shared/Pulse";
import { ActivityRowPlaceholder, ChartPlaceholder, DonutPlaceholder, LowStockRowPlaceholder } from "@/components/skeletons/placeholders";
import { Popover } from "@/components/shared/Popover";
import { useResources } from "@/lib/useResources";
import { resources } from "@/lib/resources";
import { countsAsSale } from "@/lib/orders";

const loadCharts = () => import("@/components/dashboard/Charts");
const chartLoading = () => <ChartPlaceholder />;
const RevenueChart = dynamic(() => loadCharts().then(m => m.RevenueChart), { ssr: false, loading: chartLoading });
const DeliveryPieChart = dynamic(() => loadCharts().then(m => m.DeliveryPieChart), { ssr: false, loading: chartLoading });
const OrderTrendChart = dynamic(() => loadCharts().then(m => m.OrderTrendChart), { ssr: false, loading: chartLoading });
const CategoryBarChart = dynamic(() => loadCharts().then(m => m.CategoryBarChart), { ssr: false, loading: chartLoading });

type RangeKey = "today" | "week" | "month" | "year" | "custom";

// Calendar days are handled as local "YYYY-MM-DD" strings. Going through
// toISOString() or new Date("YYYY-MM-DD") shifts them by the UTC offset, which
// in Nepal selects the previous day.
function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDateKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

const shortDate = (key: string) => parseDateKey(key).toLocaleDateString("en-US", { month: "short", day: "numeric" });

function buildBuckets(range: RangeKey, customStart?: Date, customEnd?: Date) {
  const now = new Date();
  if (range === "today") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
    return [{ label: "Today", start, end }];
  }
  if (range === "week") {
    return Array.from({ length: 7 }).map((_, i) => {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (6 - i));
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
      return { label: start.toLocaleDateString("en-US", { weekday: "short" }), start, end };
    });
  }
  if (range === "month") {
    return Array.from({ length: 30 }).map((_, i) => {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (29 - i));
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
      return { label: start.toLocaleDateString("en-US", { day: "2-digit", month: "short" }), start, end };
    });
  }
  if (range === "custom" && customStart && customEnd) {
    return [{ label: "Custom", start: customStart, end: new Date(customEnd.getFullYear(), customEnd.getMonth(), customEnd.getDate() + 1) }];
  }
  return Array.from({ length: 12 }).map((_, i) => {
    const start = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    return { label: start.toLocaleDateString("en-US", { month: "short" }), start, end };
  });
}

function RangeSelector({ value, onChange, showCustom = false, onCustomChange }: { value: RangeKey; onChange: (r: RangeKey) => void; showCustom?: boolean; onCustomChange?: (start: Date, end: Date) => void }) {
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [displayMonth, setDisplayMonth] = useState(new Date().getMonth());
  const [displayYear, setDisplayYear] = useState(new Date().getFullYear());
  const customButtonRef = useRef<HTMLButtonElement>(null);

  const handleDateSelect = (dateStr: string) => {
    if (!customStart) {
      // First click - set start date
      setCustomStart(dateStr);
    } else if (!customEnd) {
      // Second click - set end date
      if (dateStr < customStart) {
        // If end date is before start date, swap them
        setCustomEnd(customStart);
        setCustomStart(dateStr);
        if (onCustomChange) {
          onCustomChange(parseDateKey(dateStr), parseDateKey(customStart));
        }
      } else {
        // End date is after start date - all good
        setCustomEnd(dateStr);
        if (onCustomChange) {
          onCustomChange(parseDateKey(customStart), parseDateKey(dateStr));
        }
      }
      setShowPicker(false);
    } else {
      // Both dates already selected - reset and start over
      setCustomStart(dateStr);
      setCustomEnd("");
    }
  };

  const handlePickerClose = () => {
    if (customStart && customEnd && onCustomChange) {
      onCustomChange(parseDateKey(customStart), parseDateKey(customEnd));
    }
    setShowPicker(false);
    const now = new Date();
    setDisplayMonth(now.getMonth());
    setDisplayYear(now.getFullYear());
  };

  const generateCalendarDays = () => {
    const firstDay = new Date(displayYear, displayMonth, 1);
    const lastDay = new Date(displayYear, displayMonth + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();
    const days = [];

    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(displayYear, displayMonth, i));
    }
    return days;
  };

  const handlePrevMonth = () => {
    if (displayMonth === 0) {
      setDisplayMonth(11);
      setDisplayYear(displayYear - 1);
    } else {
      setDisplayMonth(displayMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (displayMonth === 11) {
      setDisplayMonth(0);
      setDisplayYear(displayYear + 1);
    } else {
      setDisplayMonth(displayMonth + 1);
    }
  };

  return (
    <div className="flex items-center gap-2 bg-muted p-1 rounded-lg border border-border shrink-0 flex-wrap relative">
      {(["today", "week", "month", "year"] as const).map(r => (
        <button
          key={r}
          onClick={() => {
            onChange(r);
            setCustomStart("");
            setCustomEnd("");
            setShowPicker(false);
          }}
          className={cn(
            "px-2.5 py-1 rounded-md text-[11px] font-bold uppercase transition-colors cursor-pointer",
            value === r ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {r}
        </button>
      ))}
      {showCustom && (
        <>
          <button
            ref={customButtonRef}
            onClick={() => {
              onChange("custom");
              setShowPicker(!showPicker);
            }}
            className={cn(
              "px-2.5 py-1 rounded-md text-[11px] font-bold uppercase transition-colors cursor-pointer",
              value === "custom" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            Custom
          </button>

          {value === "custom" && (
            <div className="text-[11px] text-muted-foreground px-2 py-1 bg-card rounded-md">
              {customStart && customEnd
                ? `${shortDate(customStart)} - ${shortDate(customEnd)}`
                : customStart
                  ? `From ${shortDate(customStart)}`
                  : "Pick dates"}
            </div>
          )}

          {value === "custom" && (
            <Popover
              open={showPicker}
              onClose={handlePickerClose}
              anchorRef={customButtonRef}
              align="end"
              className="bg-popover text-popover-foreground border border-border rounded-xl shadow-xl p-4 w-[calc(100vw-1rem)] max-w-72"
            >
              <div className="space-y-3">
                    <div className="text-center">
                      <div className="flex items-center justify-between gap-2">
                        <button
                          onClick={handlePrevMonth}
                          className="p-1 hover:bg-muted rounded transition-colors text-muted-foreground hover:text-foreground"
                          aria-label="Previous month"
                        >
                          <ChevronLeft size={15} />
                        </button>
                        <p className="text-xs font-bold text-foreground flex-1 text-center">
                          {new Date(displayYear, displayMonth).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                        </p>
                        <button
                          onClick={handleNextMonth}
                          className="p-1 hover:bg-muted rounded transition-colors text-muted-foreground hover:text-foreground"
                          aria-label="Next month"
                        >
                          <ChevronRight size={15} />
                        </button>
                      </div>
                      <div className="text-[11px] font-medium space-y-1">
                        {!customStart ? (
                          <p className="text-muted-foreground">Select a start date</p>
                        ) : !customEnd ? (
                          <div className="text-primary space-y-1">
                            <p>Start: {shortDate(customStart)}</p>
                            <p className="text-muted-foreground">Now select an end date</p>
                          </div>
                        ) : (
                          <p className="text-emerald-600 dark:text-emerald-400">
                            {shortDate(customStart)} - {shortDate(customEnd)}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-7 gap-1">
                      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => (
                        <div key={day} className="text-center text-[11px] font-semibold text-muted-foreground h-6 flex items-center justify-center">
                          {day}
                        </div>
                      ))}
                      {generateCalendarDays().map((date, idx) => {
                        const dateStr = date ? toDateKey(date) : "";
                        const isStart = dateStr === customStart;
                        const isEnd = dateStr === customEnd;
                        const isInRange = Boolean(dateStr && customStart && customEnd && dateStr >= customStart && dateStr <= customEnd);

                        return (
                          <button
                            key={idx}
                            type="button"
                            aria-label={date ? date.toDateString() : undefined}
                            aria-pressed={isStart || isEnd || isInRange}
                            onClick={() => date && handleDateSelect(dateStr)}
                            disabled={!date}
                            className={cn(
                              "h-7 rounded text-[11px] font-medium transition-all cursor-pointer disabled:cursor-default",
                              !date ? "invisible" : "",
                              isStart || isEnd ? "bg-primary text-primary-foreground shadow-md" : "",
                              isInRange && !isStart && !isEnd ? "bg-primary/20 text-foreground" : "",
                              !isStart && !isEnd && !isInRange ? "hover:bg-muted text-foreground" : ""
                            )}
                          >
                            {date?.getDate()}
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex gap-2 pt-2">
                      <button
                        onClick={() => {
                          setCustomStart("");
                          setCustomEnd("");
                        }}
                        className="flex-1 px-2 py-1.5 rounded text-[11px] font-semibold border border-border/60 text-foreground hover:bg-muted transition-colors"
                      >
                        Clear
                      </button>
                      <button
                        onClick={handlePickerClose}
                        disabled={!customStart || !customEnd}
                        className="flex-1 px-2 py-1.5 rounded text-[11px] font-semibold bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {!customStart ? "Select dates" : !customEnd ? "Select end" : "Done"}
                      </button>
                    </div>
                  </div>
            </Popover>
          )}
        </>
      )}
    </div>
  );
}

const DELIVERY_STATUS_META: Record<string, { label: string; color: string }> = {
  DELIVERED: { label: "Delivered", color: "#22c55e" },
  IN_PROCESS: { label: "In Process", color: "#F4A6BE" },
  RETURN_PROCESS: { label: "Return Process", color: "#f59e0b" },
  RETURNED: { label: "Returned", color: "#ef4444" },
  CANCELLED: { label: "Cancelled", color: "#a1a1aa" },
};

export default function Dashboard() {
  const { products, sales, stocks, movements, categories, activities, loading } = useResources({
    products: resources.products,
    sales: resources.sales,
    stocks: resources.stocks,
    movements: resources.movements,
    categories: resources.categories,
    activities: resources.activities,
  });
  const [trendRange, setTrendRange] = useState<RangeKey>("week");
  const [customTrendStart, setCustomTrendStart] = useState<Date | null>(null);
  const [customTrendEnd, setCustomTrendEnd] = useState<Date | null>(null);

  const { user } = useUser();

  const productById = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);

  const totals = useMemo(() => {
    let stockValue = 0;
    let units = 0;
    const lowStockAlerts: { stock: (typeof stocks)[number]; product: (typeof products)[number] }[] = [];
    for (const stock of stocks) {
      units += stock.quantity;
      const product = productById.get(stock.productId);
      if (!product) continue;
      stockValue += stock.quantity * product.costPrice;
      if (stock.quantity < product.minStockLevel) lowStockAlerts.push({ stock, product });
    }

    const todayKey = new Date().toDateString();
    return {
      revenue: sales.filter(countsAsSale).reduce((acc, s) => acc + s.totalAmount, 0),
      stockValue,
      units,
      lowStockAlerts,
      todayOrders: sales.filter(s => new Date(s.createdAt).toDateString() === todayKey).length,
      inTransit: sales.filter(s => s.deliveryStatus === "IN_PROCESS").length,
      activeProducts: products.filter(p => p.status === "active").length,
    };
  }, [sales, stocks, products, productById]);

  const { revenueTrendData, orderTrendData, deliveryStatusData } = useMemo(() => {
    const buckets = buildBuckets(trendRange, customTrendStart ?? undefined, customTrendEnd ?? undefined);
    const inBucket = (value: Date, b: (typeof buckets)[number]) => {
      const t = new Date(value);
      return t >= b.start && t < b.end;
    };

    const revenue = buckets.map(b => ({
      label: b.label,
      amount: sales.filter(s => countsAsSale(s) && inBucket(s.createdAt, b)).reduce((sum, s) => sum + s.totalAmount, 0),
    }));

    const orders = buckets.map(b => ({
      label: b.label,
      created: sales.filter(s => inBucket(s.createdAt, b)).length,
      delivered: sales.filter(s => s.deliveryStatus === "DELIVERED" && inBucket(s.updatedAt, b)).length,
      returned: sales.filter(s => (s.deliveryStatus === "RETURNED" || s.deliveryStatus === "RETURN_PROCESS") && inBucket(s.updatedAt, b)).length,
    }));

    // Covers the whole selected period, from the first bucket to the last.
    const period = { label: "", start: buckets[0].start, end: buckets[buckets.length - 1].end };
    const delivery = Object.entries(DELIVERY_STATUS_META).map(([key, meta]) => ({
      key,
      name: meta.label,
      color: meta.color,
      value: sales.filter(s => s.deliveryStatus === key && inBucket(s.createdAt, period)).length,
    }));

    return { revenueTrendData: revenue, orderTrendData: orders, deliveryStatusData: delivery };
  }, [sales, trendRange, customTrendStart, customTrendEnd]);

  const totalOrdersForDelivery = deliveryStatusData.reduce((a, d) => a + d.value, 0);

  const categoryData = useMemo(() => {
    const qtyByCategory = new Map<string, number>();
    for (const stock of stocks) {
      const categoryId = productById.get(stock.productId)?.categoryId;
      if (categoryId) qtyByCategory.set(categoryId, (qtyByCategory.get(categoryId) ?? 0) + stock.quantity);
    }
    return categories.map(cat => ({ name: cat.name, value: qtyByCategory.get(cat.id) ?? 0 }));
  }, [categories, stocks, productById]);

  const { revenue: totalSalesRevenue, stockValue: totalStockValuation, lowStockAlerts } = totals;
  const lowStockLocations = lowStockAlerts;


  return (
<>
      <div className="space-y-6 animate-fade-in">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-card border border-border rounded-2xl">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-foreground">
            Welcome back{user?.firstName ? `, ${user.firstName}` : ""}
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            High-level performance snapshot for your store.
          </p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <Link href="/sales" className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors cursor-pointer">
            <ShoppingCart size={13} />
            Express POS
          </Link>
          <Link href="/products" className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-secondary text-secondary-foreground rounded-xl border border-border hover:bg-muted transition-colors cursor-pointer">
            <PlusCircle size={13} />
            Add Product
          </Link>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* KPI 1: Revenue */}
        <div className="bg-card p-6 border border-border/80 rounded-2xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
            <DollarSign size={96} className="text-primary" />
          </div>
          <div className="flex justify-between items-start">
            <div className="space-y-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total Sales</span>
              {loading ? <Pulse className="h-8 w-28" /> : <p className="text-2xl font-black">{formatNPR(totalSalesRevenue)}</p>}
              {loading ? <Pulse className="h-5 w-24 rounded-md" /> : (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 px-2 py-0.5 rounded-md">
                <TrendingUp size={10} />
                {sales.length} orders total
              </span>
              )}
            </div>
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
              <DollarSign size={20} />
            </div>
          </div>
        </div>

        {/* KPI 2: Inventory Value */}
        <div className="bg-card p-6 border border-border/80 rounded-2xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
            <Package size={96} className="text-indigo-500" />
          </div>
          <div className="flex justify-between items-start">
            <div className="space-y-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Asset Valuation</span>
              {loading ? <Pulse className="h-8 w-28" /> : <p className="text-2xl font-black">{formatNPR(totalStockValuation)}</p>}
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-muted-foreground bg-muted px-2 py-0.5 rounded">
                <Layers size={10} />
                Cost basis valuation
              </span>
            </div>
            <div className="p-2.5 rounded-xl bg-secondary text-foreground/60">
              <Package size={20} />
            </div>
          </div>
        </div>

        {/* KPI 3: Low Stock Alerts */}
        <div className="bg-card p-6 border border-border/80 rounded-2xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
            <AlertTriangle size={96} className="text-amber-500" />
          </div>
          <div className="flex justify-between items-start">
            <div className="space-y-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Stock Alerts</span>
              {loading ? <Pulse className="h-8 w-20" /> : <p className="text-2xl font-black text-amber-600 dark:text-amber-400">{lowStockLocations.length}</p>}
              {loading ? <Pulse className="h-5 w-16 rounded" /> : (
              <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded ${lowStockLocations.length > 0 ? "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400" : "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400"}`}>
                {lowStockLocations.length > 0 ? `${lowStockLocations.length} item${lowStockLocations.length !== 1 ? "s" : ""}` : "All stable"}
              </span>
              )}
            </div>
            <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400">
              <AlertTriangle size={20} />
            </div>
          </div>
        </div>
      </div>

      {/* Quick Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Today's Orders */}
        <Link
          href="/customers?filter=today"
          className="bg-card p-4 border border-border/60 rounded-xl hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer group"
        >
          <p className="text-xs text-muted-foreground font-semibold mb-2 group-hover:text-primary transition-colors">Today&apos;s Orders</p>
          {loading ? <Pulse className="h-7 w-16" /> : (
            <p className="text-xl font-bold text-foreground">{totals.todayOrders}</p>
          )}
          <p className="text-[11px] text-muted-foreground mt-1">transactions</p>
        </Link>

        {/* Pending Deliveries */}
        <Link
          href="/customers"
          className="bg-card p-4 border border-border/60 rounded-xl hover:border-amber-400/40 hover:bg-amber-50 dark:hover:bg-amber-950/20 transition-all cursor-pointer group"
        >
          <p className="text-xs text-muted-foreground font-semibold mb-2 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">In Transit</p>
          {loading ? <Pulse className="h-7 w-16" /> : (
            <p className="text-xl font-bold text-foreground">{totals.inTransit}</p>
          )}
          <p className="text-[11px] text-muted-foreground mt-1">pending orders</p>
        </Link>

        {/* Total Inventory Units */}
        <Link
          href="/inventory"
          className="bg-card p-4 border border-border/60 rounded-xl hover:border-blue-400/40 hover:bg-blue-50 dark:hover:bg-blue-950/20 transition-all cursor-pointer group"
        >
          <p className="text-xs text-muted-foreground font-semibold mb-2 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">Inventory Units</p>
          {loading ? <Pulse className="h-7 w-16" /> : (
            <p className="text-xl font-bold text-foreground">{totals.units.toLocaleString()}</p>
          )}
          <p className="text-[11px] text-muted-foreground mt-1">total stock</p>
        </Link>

        {/* Active Products */}
        <Link
          href="/products"
          className="bg-card p-4 border border-border/60 rounded-xl hover:border-purple-400/40 hover:bg-purple-50 dark:hover:bg-purple-950/20 transition-all cursor-pointer group"
        >
          <p className="text-xs text-muted-foreground font-semibold mb-2 group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">Products</p>
          {loading ? <Pulse className="h-7 w-16" /> : (
            <p className="text-xl font-bold text-foreground">{totals.activeProducts}</p>
          )}
          <p className="text-[11px] text-muted-foreground mt-1">active catalog</p>
        </Link>
      </div>

      {/* Unified Trend Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card border border-border/60 p-4 rounded-xl">
        <div>
          <h2 className="text-sm font-bold text-foreground">Analytics Period</h2>
          <p className="text-[11px] text-muted-foreground mt-1">
            {trendRange === "custom" && customTrendStart && customTrendEnd
              ? `${customTrendStart.toLocaleDateString()} - ${customTrendEnd.toLocaleDateString()}`
              : `Viewing data by ${trendRange}`}
          </p>
        </div>
        <RangeSelector
          value={trendRange}
          onChange={setTrendRange}
          showCustom={true}
          onCustomChange={(start, end) => {
            setCustomTrendStart(start);
            setCustomTrendEnd(end);
          }}
        />
      </div>

      {/* Main Charts & Analytics Block */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Revenue Trend Area Chart */}
        <div className="bg-card border border-border/80 p-6 rounded-2xl lg:col-span-2 flex flex-col space-y-3 shadow-sm">
          <div>
            <h2 className="text-base font-bold text-foreground">Revenue Trend</h2>
            <p className="text-[11px] text-muted-foreground">Checkout value over time</p>
          </div>

          <div className="h-64 w-full text-xs">
            {loading ? <ChartPlaceholder /> : (
            <RevenueChart data={revenueTrendData} tickInterval={trendRange === "month" ? 3 : 0} />
            )}
          </div>
        </div>

        {/* Delivery Status Breakdown */}
        <div className="bg-card border border-border/80 p-6 rounded-2xl flex flex-col justify-between shadow-sm">
          <div>
            <h2 className="text-base font-bold text-foreground">Delivery Status</h2>
            <p className="text-[11px] text-muted-foreground">Order fulfillment breakdown</p>
          </div>

          {loading ? <DonutPlaceholder /> : (
          <>
          <div className="h-44 w-full flex items-center justify-center text-xs relative">
            <DeliveryPieChart data={deliveryStatusData} />
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-[11px] font-semibold text-muted-foreground">Total Orders</span>
              <span className="text-base font-bold text-foreground">{totalOrdersForDelivery.toLocaleString()}</span>
            </div>
          </div>

          {/* Legend */}
          <div className="space-y-2">
            {deliveryStatusData.map((data) => (
              <div key={data.key} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: data.color }} />
                  <span className="font-medium truncate max-w-[120px]">{data.name}</span>
                </div>
                <div className="font-bold">{data.value.toLocaleString()}</div>
              </div>
            ))}
          </div>
          </>
          )}
        </div>
      </div>

      {/* Order Activity Trend */}
      <div className="bg-card border border-border/80 p-6 rounded-2xl flex flex-col space-y-4 shadow-sm">
        <div>
          <h2 className="text-base font-bold text-foreground">Order Activity Trend</h2>
          <p className="text-[11px] text-muted-foreground">Orders created vs. delivered vs. returned</p>
        </div>

        <div className="h-64 w-full text-xs">
          {loading ? <ChartPlaceholder /> : (
          <OrderTrendChart data={orderTrendData} tickInterval={trendRange === "month" ? 3 : 0} />
          )}
        </div>
      </div>

      {/* Categories & Operations Alerts block */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Category breakdown (Bar chart) */}
        <div className="bg-card border border-border/80 p-6 rounded-2xl lg:col-span-7 flex flex-col space-y-4 shadow-sm">
          <div>
            <h2 className="text-base font-bold text-foreground">Stock Volume by Category</h2>
            <p className="text-[11px] text-muted-foreground">Total accumulated physical units stored in vaults</p>
          </div>

          <div className="h-60 w-full text-xs">
            {loading ? <ChartPlaceholder /> : (
            <CategoryBarChart data={categoryData} />
            )}
          </div>
        </div>

        {/* Action Panel: Low Stock List and Quick Audit */}
        <div className="bg-card border border-border/80 p-6 rounded-2xl lg:col-span-5 flex flex-col space-y-4 shadow-sm overflow-hidden">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-base font-bold text-foreground">Low Stock Warnings</h2>
              <p className="text-[11px] text-muted-foreground">Depleted stock levels under minimum target limits</p>
            </div>
            <Link href="/inventory" className="text-[11px] text-primary font-semibold hover:underline flex items-center gap-0.5">
              Review
              <ArrowRight size={10} />
            </Link>
          </div>

          <div className="flex-1 space-y-2.5 overflow-y-auto max-h-60">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => <LowStockRowPlaceholder key={i} />)
            ) : lowStockAlerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center space-y-2">
                <CheckCircle size={28} className="text-emerald-500" />
                <p className="text-xs font-semibold">Perfect Inventory Standing</p>
                <p className="text-[11px] text-muted-foreground max-w-[200px]">No stocks are currently running below safety levels.</p>
              </div>
            ) : (
              lowStockAlerts.map(({ stock, product }) => (
                <div key={stock.productId} className="flex items-center gap-3 p-3 bg-red-500/5 dark:bg-red-500/10 border border-red-500/10 dark:border-red-500/20 rounded-xl">
                  <div className="w-8 h-8 rounded-lg bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400 flex items-center justify-center shrink-0 font-bold text-xs uppercase">
                    !
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start gap-1">
                      <p className="text-xs font-bold text-foreground truncate">{product.name}</p>
                      <span className="text-[10px] bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-400 font-extrabold px-1.5 py-0.5 rounded uppercase tracking-tight shrink-0">{stock.quantity} Unit{stock.quantity !== 1 && "s"} left</span>
                    </div>
                    <div className="flex justify-between items-center text-[11px] text-muted-foreground mt-0.5">
                      <span>{product.sku}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Bottom Row: Recent logs & Operations Audit */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent logs */}
        <div className="bg-card border border-border/80 p-6 rounded-2xl lg:col-span-2 flex flex-col space-y-3 shadow-sm">
          <div>
            <h2 className="text-base font-bold text-foreground">Operational Audit Logs</h2>
            <p className="text-[11px] text-muted-foreground">Recent administrative events captured across POS terminal & hubs</p>
          </div>

          <div className="space-y-2.5">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => <ActivityRowPlaceholder key={i} />)
            ) : activities.slice(0, 4).map((act) => (
              <div key={act.id} className="flex gap-4 items-start text-xs border-b border-border/30 pb-3 last:border-0 last:pb-0">
                <div className="p-1.5 rounded-lg bg-muted text-muted-foreground shrink-0 mt-0.5">
                  <Activity size={12} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-foreground">{act.action}</p>
                  <p className="text-muted-foreground text-[11px] mt-0.5">{act.details}</p>
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0 whitespace-nowrap">{new Date(act.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Offline Status / local storage state indicator */}
        <div className="bg-card border border-border/80 p-6 rounded-2xl flex flex-col justify-between shadow-sm relative overflow-hidden">
          <div className="space-y-3">
            <h2 className="text-base font-bold text-foreground">Database Sync</h2>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Your session is connected to the <strong>live Postgres database</strong>. Changes made during billing checkouts, product creation, or stock adjustments persist across all sessions.
            </p>
          </div>

          <div className="flex flex-col gap-2.5 mt-4">
            <div className="flex justify-between items-center text-[11px] border-b border-border/40 pb-2">
              <span className="text-muted-foreground">Product Registry Count</span>
              {loading ? <Pulse className="h-3 w-16" /> : <span className="font-bold text-foreground">{products.length} Products</span>}
            </div>
            <div className="flex justify-between items-center text-[11px] border-b border-border/40 pb-2">
              <span className="text-muted-foreground">Stock Movements Logged</span>
              {loading ? <Pulse className="h-3 w-14" /> : <span className="font-bold text-foreground">{movements.length} Events</span>}
            </div>
            <div className="flex justify-between items-center text-[11px] pb-1">
              <span className="text-muted-foreground">Captured Transactions</span>
              {loading ? <Pulse className="h-3 w-20" /> : <span className="font-bold text-foreground">{sales.length} Sales invoices</span>}
            </div>
          </div>

          <div className="flex items-center gap-1.5 justify-center py-2 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200/40 dark:border-emerald-900/30 rounded-xl text-[11px] font-bold text-emerald-700 dark:text-emerald-400 mt-4">
            <Database size={10} />
            <span>PostgreSQL Sync Secure</span>
          </div>
        </div>
      </div>
      </div>
</>
  );
}
