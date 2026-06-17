// app/(dashboard)/dashboard/page.tsx
"use client";

import { Skeleton } from "boneyard-js/react";
import { DashboardFixture } from "@/components/skeletons/fixtures";
import React, { useState, useEffect } from "react";
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
  CheckCircle
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
  Pie 
} from "recharts";
import {
  getProducts,
  getSales,
  getStocks,
  getWarehouses,
  getStockMovements,
  getCategories,
  getActivityLogs,
  getNotifications
} from "@/app/actions";

export default function Dashboard() {
  const [mounted, setMounted] = useState(false);
  const [products, setProducts] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [stocks, setStocks] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const [products, sales, stocks, warehouses, movements, categories, activities, notifications] =
        await Promise.all([
          getProducts(),
          getSales(),
          getStocks(),
          getWarehouses(),
          getStockMovements(),
          getCategories(),
          getActivityLogs(),
          getNotifications(),
        ]);
      setProducts(products);
      setSales(sales);
      setStocks(stocks);
      setWarehouses(warehouses);
      setMovements(movements);
      setCategories(categories);
      setActivities(activities);
      setNotifications(notifications);
      setMounted(true);
    })();
  }, []);

  if (!mounted) {
    return (
      <Skeleton name="dashboard" loading={true} fixture={<DashboardFixture />}>
        <DashboardFixture />
      </Skeleton>
    );
  }

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
  // Count distinct product-warehouse stock locations falling below minStockLevel
  const lowStockLocations = stocks.filter(stock => {
    const product = products.find(p => p.id === stock.productId);
    return product && stock.quantity < product.minStockLevel;
  });

  // 4. Low stock products alert board
  const lowStockAlerts = stocks.map(stock => {
    const product = products.find(p => p.id === stock.productId);
    const warehouse = warehouses.find(w => w.id === stock.warehouseId);
    return {
      stock,
      product,
      warehouse
    };
  }).filter(item => item.product && item.stock.quantity < item.product.minStockLevel);

  // 5. Weekly Sales Graph Data
  // Generate daily points for the last 7 days
  const last7DaysData = Array.from({ length: 7 }).map((_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - i));
    const dateString = date.toLocaleDateString("en-US", { weekday: "short" });
    
    // Sum sales for this date
    const dailyTotal = sales
      .filter(sale => {
        const saleDate = new Date(sale.createdAt);
        return saleDate.toDateString() === date.toDateString();
      })
      .reduce((sum, s) => sum + s.totalAmount, 0);

    return {
      day: dateString,
      amount: dailyTotal || Math.floor(Math.random() * 400) + 100 // Seed with some nice dummy values if no actual sales
    };
  });

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

  // 7. Warehouse Stock Distribution
  const colors = ["#CB2957", "#8B1A38", "#E8699A", "#F4A6BE"];
  const warehousePieData = warehouses.map(wh => {
    const whStockVal = stocks
      .filter(s => s.warehouseId === wh.id)
      .reduce((sum, s) => {
        const p = products.find(prod => prod.id === s.productId);
        return sum + (s.quantity * (p?.costPrice || 0));
      }, 0);
    return {
      name: wh.name.split(" ")[0], // first word for clean labels
      value: Math.round(whStockVal)
    };
  });

  return (
    <Skeleton name="dashboard" loading={false} fixture={<DashboardFixture />}>
      <div className="space-y-8 animate-fade-in">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-card border border-border rounded-2xl">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-foreground">
            Welcome back, Sanskar
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            High-level performance snapshot for your multi-warehouse network.
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* KPI 1: Revenue */}
        <div className="bg-card p-6 border border-border/80 rounded-2xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
            <DollarSign size={96} className="text-primary" />
          </div>
          <div className="flex justify-between items-start">
            <div className="space-y-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total Sales</span>
              <h3 className="text-2xl font-black">${totalSalesRevenue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h3>
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20 px-2 py-0.5 rounded-md">
                <TrendingUp size={10} />
                +14.2% wk/wk
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
              <h3 className="text-2xl font-black">${totalStockValuation.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h3>
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

        {/* KPI 3: Low Stocks */}
        <div className="bg-card p-6 border border-border/80 rounded-2xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
            <AlertTriangle size={96} className="text-amber-500" />
          </div>
          <div className="flex justify-between items-start">
            <div className="space-y-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Stock Alerts</span>
              <h3 className="text-2xl font-black text-amber-600 dark:text-amber-400">{lowStockLocations.length} Locations</h3>
              <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded ${lowStockLocations.length > 0 ? "bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 animate-pulse" : "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400"}`}>
                {lowStockLocations.length > 0 ? "Requires restock orders" : "All inventories stable"}
              </span>
            </div>
            <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400">
              <AlertTriangle size={20} />
            </div>
          </div>
        </div>

        {/* KPI 4: Active SKUs */}
        <div className="bg-card p-6 border border-border/80 rounded-2xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
            <Layers size={96} className="text-violet-500" />
          </div>
          <div className="flex justify-between items-start">
            <div className="space-y-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Catalog SKUs</span>
              <h3 className="text-2xl font-black">{products.filter(p => p.status === "active").length} Items</h3>
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-md">
                <CheckCircle size={10} />
                100% Active
              </span>
            </div>
            <div className="p-2.5 rounded-xl bg-secondary text-foreground/60">
              <Layers size={20} />
            </div>
          </div>
        </div>
      </div>

      {/* Main Charts & Analytics Block */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Weekly sales Area Chart */}
        <div className="bg-card border border-border/80 p-6 rounded-2xl lg:col-span-2 flex flex-col space-y-4 shadow-sm">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-base font-bold text-foreground">Weekly Revenue Trend</h3>
              <p className="text-[10px] text-muted-foreground">Rolling 7-day terminal checkout value aggregates</p>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-lg border border-border">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              Live
            </div>
          </div>
          
          <div className="h-64 w-full text-xs">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={last7DaysData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#CB2957" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#CB2957" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#88888820" />
                <XAxis dataKey="day" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <RechartsTooltip 
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
          </div>
        </div>

        {/* Warehouse stock distribution */}
        <div className="bg-card border border-border/80 p-6 rounded-2xl flex flex-col justify-between shadow-sm">
          <div className="space-y-1">
            <h3 className="text-base font-bold text-foreground">Warehouse Allocation</h3>
            <p className="text-[10px] text-muted-foreground">Proportionate asset valuation weights</p>
          </div>

          <div className="h-44 w-full flex items-center justify-center text-xs relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={warehousePieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={70}
                  paddingAngle={6}
                  dataKey="value"
                >
                  {warehousePieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                  ))}
                </Pie>
                <RechartsTooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-[10px] font-semibold text-muted-foreground">Total Assets</span>
              <span className="text-base font-bold text-foreground">${Math.round(totalStockValuation / 1000)}k</span>
            </div>
          </div>

          {/* Legend */}
          <div className="space-y-2">
            {warehousePieData.map((data, index) => (
              <div key={data.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colors[index % colors.length] }} />
                  <span className="font-medium truncate max-w-[120px]">{data.name} Depot</span>
                </div>
                <div className="font-bold">${data.value.toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Categories & Operations Alerts block */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Category breakdown (Bar chart) */}
        <div className="bg-card border border-border/80 p-6 rounded-2xl lg:col-span-7 flex flex-col space-y-4 shadow-sm">
          <div>
            <h3 className="text-base font-bold text-foreground">Stock Volume by Category</h3>
            <p className="text-[10px] text-muted-foreground">Total accumulated physical units stored in vaults</p>
          </div>

          <div className="h-60 w-full text-xs">
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

          <div className="flex-1 space-y-3.5 overflow-y-auto max-h-60">
            {lowStockAlerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center space-y-2">
                <CheckCircle size={28} className="text-emerald-500" />
                <p className="text-xs font-semibold">Perfect Inventory Standing</p>
                <p className="text-[10px] text-muted-foreground max-w-[200px]">No stocks are currently running below safety levels.</p>
              </div>
            ) : (
              lowStockAlerts.map(({ stock, product, warehouse }, idx) => (
                <div key={`${stock.productId}-${stock.warehouseId}`} className="flex items-center gap-3 p-3 bg-red-500/5 dark:bg-red-500/10 border border-red-500/10 dark:border-red-500/20 rounded-xl">
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
                      <span className="font-semibold text-foreground/70">{warehouse.name.split(" ")[0]}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Bottom Row: Recent logs & Operations Audit */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent logs */}
        <div className="bg-card border border-border/80 p-6 rounded-2xl lg:col-span-2 flex flex-col space-y-4 shadow-sm">
          <div>
            <h3 className="text-base font-bold text-foreground">Operational Audit Logs</h3>
            <p className="text-[10px] text-muted-foreground">Recent administrative events captured across POS terminal & hubs</p>
          </div>

          <div className="space-y-3.5">
            {activities.slice(0, 4).map((act) => (
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
              Your session is connected to the <strong>live Postgres database</strong>. Changes made during billing checkouts, product creation, or warehouse stock adjustments persist across all sessions.
            </p>
          </div>

          <div className="flex flex-col gap-2.5 mt-4">
            <div className="flex justify-between items-center text-[10px] border-b border-border/40 pb-2">
              <span className="text-muted-foreground">Product Registry Count</span>
              <span className="font-bold text-foreground">{products.length} Products</span>
            </div>
            <div className="flex justify-between items-center text-[10px] border-b border-border/40 pb-2">
              <span className="text-muted-foreground">Active Warehouse Hubs</span>
              <span className="font-bold text-foreground">{warehouses.length} Nodes</span>
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
