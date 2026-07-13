// app/(dashboard)/dashboard/page.tsx
"use client";

import { Skeleton } from "boneyard-js/react";
import { DashboardFixture } from "@/components/skeletons/fixtures";
import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  TrendingUp,
  Package,
  AlertTriangle,
  DollarSign,
  ArrowUpRight,
  PlusCircle,
  ShoppingCart,
  ArrowRight,
  TrendingDown,
  Activity,
  Layers,
  Database,
  CheckCircle,
  Calendar,
  X
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  BarChart,
  Bar,
  Cell,
  PieChart,
  Pie,
  LineChart,
  Line,
  Legend,
} from "recharts";
import { cn, formatNPR } from "@/lib/utils";
import { Pulse } from "@/components/shared/Pulse";
import { useResources } from "@/lib/useResources";
import { resources } from "@/lib/resources";

type RangeKey = "today" | "week" | "month" | "year" | "custom";

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
    return [{ label: "Custom", start: customStart, end: new Date(customEnd.getTime() + 86400000) }];
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
  const pickerRef = useRef<HTMLDivElement>(null);

  const handleDateSelect = (dateStr: string) => {
    if (!customStart) {
      // First click - set start date
      setCustomStart(dateStr);
    } else if (!customEnd) {
      // Second click - set end date
      if (new Date(dateStr) < new Date(customStart)) {
        // If end date is before start date, swap them
        setCustomEnd(customStart);
        setCustomStart(dateStr);
        if (onCustomChange) {
          onCustomChange(new Date(dateStr), new Date(customStart));
        }
      } else {
        // End date is after start date - all good
        setCustomEnd(dateStr);
        if (onCustomChange) {
          onCustomChange(new Date(customStart), new Date(dateStr));
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
      onCustomChange(new Date(customStart), new Date(customEnd));
    }
    setShowPicker(false);
    const now = new Date();
    setDisplayMonth(now.getMonth());
    setDisplayYear(now.getFullYear());
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        handlePickerClose();
      }
    };
    if (showPicker) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showPicker, customStart, customEnd]);

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
            "px-2.5 py-1 rounded-md text-[10px] font-bold uppercase transition-colors cursor-pointer",
            value === r ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {r}
        </button>
      ))}
      {showCustom && (
        <>
          <button
            onClick={() => {
              onChange("custom");
              setShowPicker(!showPicker);
            }}
            className={cn(
              "px-2.5 py-1 rounded-md text-[10px] font-bold uppercase transition-colors cursor-pointer",
              value === "custom" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            Custom
          </button>

          {value === "custom" && (
            <>
              <div className="text-[10px] text-muted-foreground px-2 py-1 bg-card rounded-md">
                {customStart && customEnd
                  ? `${new Date(customStart).toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${new Date(customEnd).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                  : customStart
                    ? `From ${new Date(customStart).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                    : "Pick dates"}
              </div>

              {showPicker && (
                <div
                  ref={pickerRef}
                  className="absolute top-full left-0 mt-2 bg-card border border-border rounded-lg shadow-2xl p-4 z-50 w-72"
                >
                  <div className="space-y-3">
                    <div className="text-center">
                      <div className="flex items-center justify-between gap-2">
                        <button
                          onClick={handlePrevMonth}
                          className="p-1 hover:bg-muted rounded transition-colors text-muted-foreground hover:text-foreground"
                          title="Previous month"
                        >
                          ←
                        </button>
                        <p className="text-xs font-bold text-foreground flex-1 text-center">
                          {new Date(displayYear, displayMonth).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                        </p>
                        <button
                          onClick={handleNextMonth}
                          className="p-1 hover:bg-muted rounded transition-colors text-muted-foreground hover:text-foreground"
                          title="Next month"
                        >
                          →
                        </button>
                      </div>
                      <div className="text-[10px] font-medium space-y-1">
                        {!customStart ? (
                          <p className="text-muted-foreground">📅 Click start date</p>
                        ) : !customEnd ? (
                          <div className="text-primary space-y-1">
                            <p>✓ Start: {new Date(customStart).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</p>
                            <p className="text-muted-foreground">→ Now click end date</p>
                          </div>
                        ) : (
                          <p className="text-emerald-600 dark:text-emerald-400">
                            ✓ Selected: {new Date(customStart).toLocaleDateString("en-US", { month: "short", day: "numeric" })} - {new Date(customEnd).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-7 gap-1">
                      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => (
                        <div key={day} className="text-center text-[10px] font-semibold text-muted-foreground h-6 flex items-center justify-center">
                          {day}
                        </div>
                      ))}
                      {generateCalendarDays().map((date, idx) => {
                        const dateStr = date ? date.toISOString().split("T")[0] : "";
                        const isStart = dateStr === customStart;
                        const isEnd = dateStr === customEnd;
                        const isInRange = dateStr && customStart && customEnd && date! >= new Date(customStart) && date! <= new Date(customEnd);

                        return (
                          <button
                            key={idx}
                            onClick={() => date && handleDateSelect(dateStr)}
                            disabled={!date}
                            className={cn(
                              "h-7 rounded text-[10px] font-medium transition-all cursor-pointer disabled:cursor-default",
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
                        className="flex-1 px-2 py-1.5 rounded text-[10px] font-semibold border border-border/60 text-foreground hover:bg-muted transition-colors"
                      >
                        Clear
                      </button>
                      <button
                        onClick={handlePickerClose}
                        disabled={!customStart || !customEnd}
                        className="flex-1 px-2 py-1.5 rounded text-[10px] font-semibold bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {!customStart ? "Select dates" : !customEnd ? "Select end" : "Done"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
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

  // --- Calculations ---
  
  // 1. Total Sales Revenue
  const totalSalesRevenue = sales.reduce((acc, curr) => acc + curr.totalAmount, 0);

  // 2. Total Stock Valuation (Stock Qty * Cost Price)
  const totalStockValuation = stocks.reduce((acc, stock) => {
    const product = products.find(p => p.id === stock.productId);
    if (product) {
      return acc + (stock.quantity * product.costPrice);
    }
    return acc;
  }, 0);

  // 3. Low Stock Items Count
  const lowStockLocations = stocks.filter(stock => {
    const product = products.find(p => p.id === stock.productId);
    return product && stock.quantity < product.minStockLevel;
  });

  // 4. Low stock products alert board
  const lowStockAlerts = stocks.flatMap(stock => {
    const product = products.find(p => p.id === stock.productId);
    return product && stock.quantity < product.minStockLevel ? [{ stock, product }] : [];
  });

  // 5. Revenue Trend (using unified trend range)
  const revenueTrendData = buildBuckets(trendRange, customTrendStart ?? undefined, customTrendEnd ?? undefined).map(b => ({
    label: b.label,
    amount: sales
      .filter(s => { const t = new Date(s.createdAt); return t >= b.start && t < b.end; })
      .reduce((sum, s) => sum + s.totalAmount, 0),
  }));

  // 5b. Order Activity Trend: created vs. delivered vs. returned (using unified trend range)
  const orderTrendData = buildBuckets(trendRange, customTrendStart ?? undefined, customTrendEnd ?? undefined).map(b => {
    const created = sales.filter(s => { const t = new Date(s.createdAt); return t >= b.start && t < b.end; }).length;
    const delivered = sales.filter(s => s.deliveryStatus === "DELIVERED" && (() => { const t = new Date(s.updatedAt); return t >= b.start && t < b.end; })()).length;
    const returned = sales.filter(s => (s.deliveryStatus === "RETURNED" || s.deliveryStatus === "RETURN_PROCESS") && (() => { const t = new Date(s.updatedAt); return t >= b.start && t < b.end; })()).length;
    return { label: b.label, created, delivered, returned };
  });

  // 5c. Delivery Status Breakdown (filtered by unified trend range)
  const deliveryBuckets = buildBuckets(trendRange, customTrendStart ?? undefined, customTrendEnd ?? undefined);
  const deliveryDateRange = deliveryBuckets[deliveryBuckets.length - 1];
  const deliveryStatusData = Object.entries(DELIVERY_STATUS_META).map(([key, meta]) => ({
    key,
    name: meta.label,
    color: meta.color,
    value: sales.filter(s => {
      if (s.deliveryStatus !== key) return false;
      const t = new Date(s.createdAt);
      return t >= deliveryDateRange.start && t < deliveryDateRange.end;
    }).length,
  }));
  const totalOrdersForDelivery = deliveryStatusData.reduce((a, d) => a + d.value, 0);

  // 6. Category Stock Breakdown
  const categoryData = categories.map(cat => {
    const catProducts = products.filter(p => p.categoryId === cat.id);
    const totalQty = stocks
      .filter(st => catProducts.some(p => p.id === st.productId))
      .reduce((sum, st) => sum + st.quantity, 0);
    return {
      name: cat.name,
      value: totalQty
    };
  });

  const colors = ["#CB2957", "#8B1A38", "#E8699A", "#F4A6BE"];

  return (
    <Skeleton name="dashboard" loading={false} fixture={<DashboardFixture />} fallback={<DashboardFixture />}>
      <div className="space-y-6 animate-fade-in">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-card border border-border rounded-2xl">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-foreground">
            Welcome back, Sanskar
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
              {loading ? <Pulse className="h-7 w-28" /> : <h3 className="text-2xl font-black">{formatNPR(totalSalesRevenue)}</h3>}
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20 px-2 py-0.5 rounded-md">
                <TrendingUp size={10} />
                {sales.length} orders total
              </span>
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
              {loading ? <Pulse className="h-7 w-28" /> : <h3 className="text-2xl font-black">{formatNPR(totalStockValuation)}</h3>}
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-muted-foreground bg-muted px-2 py-0.5 rounded">
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
              {loading ? <Pulse className="h-7 w-20" /> : <h3 className="text-2xl font-black text-amber-600 dark:text-amber-400">{lowStockLocations.length}</h3>}
              <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded ${lowStockLocations.length > 0 ? "bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 animate-pulse" : "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400"}`}>
                {lowStockLocations.length > 0 ? `${lowStockLocations.length} item${lowStockLocations.length !== 1 ? "s" : ""}` : "All stable"}
              </span>
            </div>
            <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400">
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
          <p className="text-xs text-muted-foreground font-semibold mb-2 group-hover:text-primary transition-colors">Today's Orders</p>
          {loading ? <Pulse className="h-6 w-16" /> : (
            <p className="text-xl font-bold text-foreground">{sales.filter(s => {
              const today = new Date();
              const saleDate = new Date(s.createdAt);
              return saleDate.toDateString() === today.toDateString();
            }).length}</p>
          )}
          <p className="text-[10px] text-muted-foreground mt-1">transactions</p>
        </Link>

        {/* Pending Deliveries */}
        <Link
          href="/customers"
          className="bg-card p-4 border border-border/60 rounded-xl hover:border-amber-400/40 hover:bg-amber-50 dark:hover:bg-amber-950/20 transition-all cursor-pointer group"
        >
          <p className="text-xs text-muted-foreground font-semibold mb-2 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">In Transit</p>
          {loading ? <Pulse className="h-6 w-16" /> : (
            <p className="text-xl font-bold text-foreground">{sales.filter(s => s.deliveryStatus === "IN_PROCESS").length}</p>
          )}
          <p className="text-[10px] text-muted-foreground mt-1">pending orders</p>
        </Link>

        {/* Total Inventory Units */}
        <Link
          href="/inventory"
          className="bg-card p-4 border border-border/60 rounded-xl hover:border-blue-400/40 hover:bg-blue-50 dark:hover:bg-blue-950/20 transition-all cursor-pointer group"
        >
          <p className="text-xs text-muted-foreground font-semibold mb-2 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">Inventory Units</p>
          {loading ? <Pulse className="h-6 w-16" /> : (
            <p className="text-xl font-bold text-foreground">{stocks.reduce((sum, s) => sum + s.quantity, 0).toLocaleString()}</p>
          )}
          <p className="text-[10px] text-muted-foreground mt-1">total stock</p>
        </Link>

        {/* Active Products */}
        <Link
          href="/products"
          className="bg-card p-4 border border-border/60 rounded-xl hover:border-purple-400/40 hover:bg-purple-50 dark:hover:bg-purple-950/20 transition-all cursor-pointer group"
        >
          <p className="text-xs text-muted-foreground font-semibold mb-2 group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">Products</p>
          {loading ? <Pulse className="h-6 w-16" /> : (
            <p className="text-xl font-bold text-foreground">{products.filter(p => p.status === "active").length}</p>
          )}
          <p className="text-[10px] text-muted-foreground mt-1">active catalog</p>
        </Link>
      </div>

      {/* Unified Trend Filter */}
      <div className="flex items-center justify-between bg-card border border-border/60 p-4 rounded-xl">
        <div>
          <h3 className="text-sm font-bold text-foreground">Analytics Period</h3>
          <p className="text-[10px] text-muted-foreground mt-1">
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
            <h3 className="text-base font-bold text-foreground">Revenue Trend</h3>
            <p className="text-[10px] text-muted-foreground">Checkout value over time</p>
          </div>

          <div className="h-64 w-full text-xs">
            {loading ? <Pulse className="h-full w-full" /> : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueTrendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#CB2957" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#CB2957" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#88888820" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} interval={trendRange === "month" ? 3 : 0} />
                <YAxis tickLine={false} axisLine={false} />
                <RechartsTooltip
                  formatter={(value: any) => formatNPR(Number(value) || 0)}
                  contentStyle={{
                    backgroundColor: "var(--color-card)",
                    borderColor: "var(--color-border)",
                    borderRadius: "0.75rem",
                    boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)"
                  }}
                />
                <Area type="monotone" dataKey="amount" stroke="#CB2957" strokeWidth={2} fillOpacity={1} fill="url(#salesGrad)" />
              </AreaChart>
            </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Delivery Status Breakdown */}
        <div className="bg-card border border-border/80 p-6 rounded-2xl flex flex-col justify-between shadow-sm">
          <div>
            <h3 className="text-base font-bold text-foreground">Delivery Status</h3>
            <p className="text-[10px] text-muted-foreground">Order fulfillment breakdown</p>
          </div>

          {loading ? <Pulse className="h-44 w-full" /> : (
          <>
          <div className="h-44 w-full flex items-center justify-center text-xs relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={deliveryStatusData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={70}
                  paddingAngle={6}
                  dataKey="value"
                >
                  {deliveryStatusData.map((entry) => (
                    <Cell key={entry.key} fill={entry.color} />
                  ))}
                </Pie>
                <RechartsTooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-[10px] font-semibold text-muted-foreground">Total Orders</span>
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
          <h3 className="text-base font-bold text-foreground">Order Activity Trend</h3>
          <p className="text-[10px] text-muted-foreground">Orders created vs. delivered vs. returned</p>
        </div>

        <div className="h-64 w-full text-xs">
          {loading ? <Pulse className="h-full w-full" /> : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={orderTrendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#88888820" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} interval={trendRange === "month" ? 3 : 0} />
              <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
              <RechartsTooltip
                contentStyle={{
                  backgroundColor: "var(--color-card)",
                  borderColor: "var(--color-border)",
                  borderRadius: "0.75rem",
                  boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)"
                }}
              />
              <Legend wrapperStyle={{ fontSize: "10px" }} />
              <Line type="monotone" dataKey="created" name="Created" stroke="#CB2957" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="delivered" name="Delivered" stroke="#22c55e" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="returned" name="Returned" stroke="#ef4444" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Categories & Operations Alerts block */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Category breakdown (Bar chart) */}
        <div className="bg-card border border-border/80 p-6 rounded-2xl lg:col-span-7 flex flex-col space-y-4 shadow-sm">
          <div>
            <h3 className="text-base font-bold text-foreground">Stock Volume by Category</h3>
            <p className="text-[10px] text-muted-foreground">Total accumulated physical units stored in vaults</p>
          </div>

          <div className="h-60 w-full text-xs">
            {loading ? <Pulse className="h-full w-full" /> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#88888820" />
                <XAxis dataKey="name" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <RechartsTooltip
                  contentStyle={{
                    backgroundColor: "var(--color-card)",
                    borderColor: "var(--color-border)",
                    borderRadius: "0.75rem"
                  }}
                />
                <Bar dataKey="value" fill="#CB2957" radius={[4, 4, 0, 0]}>
                  {categoryData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={colors[(index + 1) % colors.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Action Panel: Low Stock List and Quick Audit */}
        <div className="bg-card border border-border/80 p-6 rounded-2xl lg:col-span-5 flex flex-col space-y-4 shadow-sm overflow-hidden">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-base font-bold text-foreground">Low Stock Warnings</h3>
              <p className="text-[10px] text-muted-foreground">Depleted stock levels under minimum target limits</p>
            </div>
            <Link href="/inventory" className="text-[10px] text-primary font-semibold hover:underline flex items-center gap-0.5">
              Review
              <ArrowRight size={10} />
            </Link>
          </div>

          <div className="flex-1 space-y-2.5 overflow-y-auto max-h-60">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => <Pulse key={i} className="h-14 w-full" />)
            ) : lowStockAlerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center space-y-2">
                <CheckCircle size={28} className="text-emerald-500" />
                <p className="text-xs font-semibold">Perfect Inventory Standing</p>
                <p className="text-[10px] text-muted-foreground max-w-[200px]">No stocks are currently running below safety levels.</p>
              </div>
            ) : (
              lowStockAlerts.map(({ stock, product }) => (
                <div key={stock.productId} className="flex items-center gap-3 p-3 bg-red-500/5 dark:bg-red-500/10 border border-red-500/10 dark:border-red-500/20 rounded-xl">
                  <div className="w-8 h-8 rounded-lg bg-red-100 dark:bg-red-950/30 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0 font-bold text-xs uppercase">
                    !
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start gap-1">
                      <p className="text-xs font-bold text-foreground truncate">{product.name}</p>
                      <span className="text-[9px] bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-400 font-extrabold px-1.5 py-0.5 rounded uppercase tracking-tight shrink-0">{stock.quantity} Unit{stock.quantity !== 1 && "s"} left</span>
                    </div>
                    <div className="flex justify-between items-center text-[10px] text-muted-foreground mt-0.5">
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
            <h3 className="text-base font-bold text-foreground">Operational Audit Logs</h3>
            <p className="text-[10px] text-muted-foreground">Recent administrative events captured across POS terminal & hubs</p>
          </div>

          <div className="space-y-2.5">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => <Pulse key={i} className="h-9 w-full" />)
            ) : activities.slice(0, 4).map((act) => (
              <div key={act.id} className="flex gap-4 items-start text-xs border-b border-border/30 pb-3 last:border-0 last:pb-0">
                <div className="p-1.5 rounded-lg bg-muted text-muted-foreground shrink-0 mt-0.5">
                  <Activity size={12} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-foreground">{act.action}</p>
                  <p className="text-muted-foreground text-[10px] mt-0.5">{act.details}</p>
                </div>
                <span className="text-[9px] text-muted-foreground shrink-0 whitespace-nowrap">{new Date(act.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Offline Status / local storage state indicator */}
        <div className="bg-card border border-border/80 p-6 rounded-2xl flex flex-col justify-between shadow-sm relative overflow-hidden">
          <div className="space-y-3">
            <h3 className="text-base font-bold text-foreground">Database Sync</h3>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Your session is connected to the <strong>live Postgres database</strong>. Changes made during billing checkouts, product creation, or stock adjustments persist across all sessions.
            </p>
          </div>

          <div className="flex flex-col gap-2.5 mt-4">
            <div className="flex justify-between items-center text-[10px] border-b border-border/40 pb-2">
              <span className="text-muted-foreground">Product Registry Count</span>
              <span className="font-bold text-foreground">{products.length} Products</span>
            </div>
            <div className="flex justify-between items-center text-[10px] border-b border-border/40 pb-2">
              <span className="text-muted-foreground">Stock Movements Logged</span>
              <span className="font-bold text-foreground">{movements.length} Events</span>
            </div>
            <div className="flex justify-between items-center text-[10px] pb-1">
              <span className="text-muted-foreground">Captured Transactions</span>
              <span className="font-bold text-foreground">{sales.length} Sales invoices</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 justify-center py-2 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200/40 dark:border-emerald-900/30 rounded-xl text-[10px] font-bold text-emerald-700 dark:text-emerald-400 mt-4">
            <Database size={10} className="animate-bounce" />
            <span>PostgreSQL Sync Secure</span>
          </div>
        </div>
      </div>
      </div>
    </Skeleton>
  );
}
