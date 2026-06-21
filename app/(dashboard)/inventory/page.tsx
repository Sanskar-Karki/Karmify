"use client";

import { Skeleton } from "boneyard-js/react";
import { InventoryFixture } from "@/components/skeletons/fixtures";
import React, { useState, useEffect } from "react";
import { ArrowLeftRight, Plus, X, AlertTriangle, CheckCircle2, Package, ArrowRight, ArrowLeft, Wrench, RefreshCw } from "lucide-react";
import {
  getProducts, getStocks, getStockMovements, recordStockMovement,
} from "@/app/actions";
import { cn } from "@/lib/utils";
import { Pulse } from "@/components/shared/Pulse";
import { getPageCache, setPageCache } from "@/lib/pageCache";

type MovementType = "STOCK_IN" | "STOCK_OUT" | "DAMAGED" | "RETURNED" | "ADJUSTMENT";

const MOVEMENT_TYPES = [
  { value: "STOCK_IN", label: "Stock In", color: "emerald", icon: ArrowLeft },
  { value: "STOCK_OUT", label: "Stock Out", color: "blue", icon: ArrowRight },
  { value: "DAMAGED", label: "Damaged", color: "red", icon: AlertTriangle },
  { value: "ADJUSTMENT", label: "Adjustment", color: "amber", icon: Wrench },
  { value: "RETURNED", label: "Returned", color: "violet", icon: RefreshCw },
] as const;

const TYPE_STYLES: Record<string, string> = {
  STOCK_IN: "bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400",
  STOCK_OUT: "bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400",
  DAMAGED: "bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400",
  ADJUSTMENT: "bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400",
  RETURNED: "bg-violet-100 dark:bg-violet-950/30 text-violet-700 dark:text-violet-400",
};

type InventoryCache = { products: any[]; stocks: any[]; movements: any[] };
const CACHE_KEY = "inventory-page";

export default function InventoryPage() {
  const cached = getPageCache<InventoryCache>(CACHE_KEY);
  const [loading, setLoading] = useState(!cached);
  const [products, setProducts] = useState<any[]>(cached?.products ?? []);
  const [stocks, setStocks] = useState<any[]>(cached?.stocks ?? []);
  const [movements, setMovements] = useState<any[]>(cached?.movements ?? []);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    productId: "",
    type: "STOCK_IN" as MovementType,
    quantity: 1,
    notes: ""
  });

  useEffect(() => {
    refresh().then(() => setLoading(false));
  }, []);

  async function refresh() {
    const [products, stocks, movements] = await Promise.all([
      getProducts(), getStocks(), getStockMovements(),
    ]);
    setProducts(products);
    setStocks(stocks);
    setMovements(movements);
    setPageCache<InventoryCache>(CACHE_KEY, { products, stocks, movements });
  }

  function getTotalStock(productId: string) {
    return stocks.filter(s => s.productId === productId).reduce((a, s) => a + s.quantity, 0);
  }

  async function handleSubmit() {
    setError("");
    const { productId, type, quantity, notes } = form;
    if (!productId) return setError("Please select a product.");
    if (quantity <= 0) return setError("Quantity must be greater than 0.");
    if (["STOCK_OUT", "DAMAGED"].includes(type)) {
      const available = getTotalStock(productId);
      if (quantity > available) return setError(`Insufficient stock. Only ${available} units available.`);
    }

    await recordStockMovement({
      productId,
      type,
      quantity,
      notes: notes || undefined,
    });

    setShowModal(false);
    setForm({ productId: "", type: "STOCK_IN", quantity: 1, notes: "" });
    await refresh();
  }

  return (
    <Skeleton name="inventory" loading={false} fixture={<InventoryFixture />} fallback={<InventoryFixture />}>
      <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Inventory & Stock Hub</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Track and audit stock for your store</p>
        </div>
        <button onClick={() => { setShowModal(true); setError(""); }} className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold bg-primary text-primary-foreground rounded-xl shadow-md shadow-primary/10 hover:bg-primary/90 hover:scale-[1.02] transition-all cursor-pointer">
          <Plus size={16} />
          Record Movement
        </button>
      </div>

      {/* Stock Levels */}
      <div className="bg-card border border-border/80 rounded-2xl overflow-hidden shadow-sm">
        <div className="p-5 border-b border-border/60">
          <h2 className="font-bold text-base">Stock Levels</h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">Current physical unit counts</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/20 border-b border-border/40">
                <th className="text-left px-5 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wide">Product</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wide">Min Level</th>
                <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wide">Total</th>
                <th className="text-center px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wide">Health</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {loading && Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}><td colSpan={4} className="px-5 py-4"><Pulse className="h-6 w-full" /></td></tr>
              ))}
              {!loading && products.length === 0 && (
                <tr><td colSpan={4} className="text-center py-12 text-muted-foreground text-sm">No products yet.</td></tr>
              )}
              {!loading && products.map(prod => {
                const total = getTotalStock(prod.id);
                const isLow = total < prod.minStockLevel;
                return (
                  <tr key={prod.id} className="hover:bg-muted/10 transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 border border-border/40 flex items-center justify-center shrink-0">
                          <Package size={14} className="text-primary/70" />
                        </div>
                        <div>
                          <p className="font-semibold text-xs text-foreground">{prod.name}</p>
                          <p className="text-[10px] text-muted-foreground font-mono">{prod.sku}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span className="text-xs font-semibold text-muted-foreground">{prod.minStockLevel} units</span>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <span className={cn("text-sm font-extrabold", isLow ? "text-red-500" : "text-foreground")}>{total}</span>
                    </td>
                    <td className="px-4 py-4 text-center">
                      <span className={cn("inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full", isLow ? "bg-red-100 dark:bg-red-950/30 text-red-600" : "bg-emerald-100 dark:bg-emerald-950/30 text-emerald-600")}>
                        {isLow ? <AlertTriangle size={9} /> : <CheckCircle2 size={9} />}
                        {isLow ? "Low" : "OK"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Movement Log */}
      <div className="bg-card border border-border/80 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-5 border-b border-border/60">
          <h2 className="font-bold text-base">Stock Movement Ledger</h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">Full audit trail of every stock event recorded in the system</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/20 border-b border-border/40">
                <th className="text-left px-5 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wide">Type</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wide">Product</th>
                <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wide">Qty</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wide hidden lg:table-cell">Notes</th>
                <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wide">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {loading && Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}><td colSpan={5} className="px-5 py-3.5"><Pulse className="h-5 w-full" /></td></tr>
              ))}
              {!loading && movements.length === 0 && (
                <tr><td colSpan={5} className="text-center py-12 text-muted-foreground text-sm">No movements recorded yet.</td></tr>
              )}
              {!loading && movements.slice(0, 30).map(mov => {
                const prod = products.find(p => p.id === mov.productId);
                return (
                  <tr key={mov.id} className="hover:bg-muted/10 transition-colors">
                    <td className="px-5 py-3.5">
                      <span className={cn("text-[10px] font-bold uppercase px-2.5 py-1 rounded-lg", TYPE_STYLES[mov.type] ?? "bg-muted text-muted-foreground")}>
                        {mov.type.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <p className="text-xs font-semibold">{prod?.name ?? "—"}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{prod?.sku}</p>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <span className="font-bold text-sm">{mov.quantity}</span>
                    </td>
                    <td className="px-4 py-3.5 hidden lg:table-cell">
                      <p className="text-[10px] text-muted-foreground max-w-[200px] truncate">{mov.notes ?? "—"}</p>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <p className="text-[10px] text-muted-foreground">{new Date(mov.createdAt).toLocaleDateString("en-US", { day: "2-digit", month: "short" })}</p>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Stock Movement Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-border">
              <h2 className="text-lg font-bold flex items-center gap-2"><ArrowLeftRight size={18} className="text-primary" /> Record Stock Movement</h2>
              <button onClick={() => setShowModal(false)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-muted cursor-pointer"><X size={16} /></button>
            </div>
            <div className="p-6 space-y-3">
              {/* Movement Type Picker */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground">Movement Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {MOVEMENT_TYPES.map(t => (
                    <button key={t.value} onClick={() => setForm(f => ({ ...f, type: t.value as any }))} className={cn("flex flex-col items-center gap-1 py-3 rounded-xl border text-xs font-semibold transition-all cursor-pointer", form.type === t.value ? "border-primary bg-primary/5 text-primary" : "border-border bg-muted/20 text-muted-foreground hover:border-border/80 hover:text-foreground")}>
                      <t.icon size={15} />
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Product</label>
                <select value={form.productId} onChange={e => setForm(f => ({ ...f, productId: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer">
                  <option value="">Select product...</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Quantity</label>
                <input type="number" min={1} value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: parseInt(e.target.value) || 1 }))} className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </div>

              {form.productId && ["STOCK_OUT", "DAMAGED"].includes(form.type) && (
                <div className="flex items-center gap-2 p-3 bg-amber-50/50 dark:bg-amber-950/10 border border-amber-200/40 dark:border-amber-900/30 rounded-xl text-xs">
                  <AlertTriangle size={13} className="text-amber-600 shrink-0" />
                  <span className="text-amber-700 dark:text-amber-400 font-medium">
                    Available in stock: <strong>{getTotalStock(form.productId)} units</strong>
                  </span>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Notes (optional)</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="e.g. Quarterly damage audit" className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none" />
              </div>

              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950/20 border border-red-200/40 dark:border-red-900/30 rounded-xl text-xs text-red-600 dark:text-red-400 font-semibold">
                  <AlertTriangle size={13} />
                  {error}
                </div>
              )}
            </div>
            <div className="flex gap-3 p-6 border-t border-border">
              <button onClick={() => setShowModal(false)} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-semibold hover:bg-muted cursor-pointer">Cancel</button>
              <button onClick={handleSubmit} className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 cursor-pointer shadow-md shadow-primary/10">Apply Movement</button>
            </div>
          </div>
        </div>
      )}
      </div>
    </Skeleton>
  );
}

