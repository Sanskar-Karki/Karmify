"use client";

import { Skeleton } from "boneyard-js/react";
import { InventoryFixture } from "@/components/skeletons/fixtures";
import React, { useState, useEffect } from "react";
import { ArrowLeftRight, Plus, X, AlertTriangle, CheckCircle2, Package, ArrowRight, ArrowLeft, Wrench, Trash2, RefreshCw } from "lucide-react";
import {
  getProducts, getStocks, getWarehouses, getStockMovements, recordStockMovement,
} from "@/app/actions";
import { cn } from "@/lib/utils";

type MovementType = "STOCK_IN" | "STOCK_OUT" | "DAMAGED" | "RETURNED" | "ADJUSTMENT" | "TRANSFER";

const MOVEMENT_TYPES = [
  { value: "STOCK_IN", label: "Stock In", color: "emerald", icon: ArrowLeft },
  { value: "STOCK_OUT", label: "Stock Out", color: "blue", icon: ArrowRight },
  { value: "TRANSFER", label: "Transfer", color: "indigo", icon: ArrowLeftRight },
  { value: "DAMAGED", label: "Damaged", color: "red", icon: AlertTriangle },
  { value: "ADJUSTMENT", label: "Adjustment", color: "amber", icon: Wrench },
  { value: "RETURNED", label: "Returned", color: "violet", icon: RefreshCw },
] as const;

const TYPE_STYLES: Record<string, string> = {
  STOCK_IN: "bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400",
  STOCK_OUT: "bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400",
  TRANSFER: "bg-indigo-100 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-400",
  DAMAGED: "bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400",
  ADJUSTMENT: "bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400",
  RETURNED: "bg-violet-100 dark:bg-violet-950/30 text-violet-700 dark:text-violet-400",
};

export default function InventoryPage() {
  const [mounted, setMounted] = useState(false);
  const [products, setProducts] = useState<any[]>([]);
  const [stocks, setStocks] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    productId: "",
    type: "STOCK_IN" as MovementType,
    sourceWhId: "",
    destWhId: "",
    quantity: 1,
    notes: ""
  });

  useEffect(() => {
    refresh().then(() => setMounted(true));
  }, []);

  async function refresh() {
    const [products, stocks, warehouses, movements] = await Promise.all([
      getProducts(), getStocks(), getWarehouses(), getStockMovements(),
    ]);
    setProducts(products);
    setStocks(stocks);
    setWarehouses(warehouses);
    setMovements(movements);
  }

  function getStock(productId: string, warehouseId: string) {
    return stocks.find(s => s.productId === productId && s.warehouseId === warehouseId)?.quantity ?? 0;
  }

  function getTotalStock(productId: string) {
    return stocks.filter(s => s.productId === productId).reduce((a, s) => a + s.quantity, 0);
  }

  async function handleSubmit() {
    setError("");
    const { productId, type, quantity, sourceWhId, destWhId, notes } = form;
    if (!productId) return setError("Please select a product.");
    if (quantity <= 0) return setError("Quantity must be greater than 0.");
    if (type === "TRANSFER" && (!sourceWhId || !destWhId || sourceWhId === destWhId))
      return setError("Transfer requires two distinct warehouses.");
    if (["STOCK_OUT", "DAMAGED", "TRANSFER"].includes(type)) {
      const whId = type === "TRANSFER" ? sourceWhId : (sourceWhId || destWhId);
      const available = whId ? getStock(productId, whId) : getTotalStock(productId);
      if (quantity > available) return setError(`Insufficient stock. Only ${available} units available.`);
    }

    await recordStockMovement({
      productId,
      type,
      sourceWhId: sourceWhId || undefined,
      destWhId: destWhId || undefined,
      quantity,
      notes: notes || undefined,
    });

    setShowModal(false);
    setForm({ productId: "", type: "STOCK_IN", sourceWhId: "", destWhId: "", quantity: 1, notes: "" });
    await refresh();
  }

  const needsSource = ["STOCK_OUT", "DAMAGED", "TRANSFER"].includes(form.type);
  const needsDest = ["STOCK_IN", "RETURNED", "ADJUSTMENT", "TRANSFER"].includes(form.type);

  if (!mounted) return (
    <Skeleton name="inventory" loading={true} fixture={<InventoryFixture />}>
      <InventoryFixture />
    </Skeleton>
  );

  return (
    <Skeleton name="inventory" loading={false} fixture={<InventoryFixture />}>
      <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Inventory & Stock Hub</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Track, audit, and move stock across all warehouse nodes</p>
        </div>
        <button onClick={() => { setShowModal(true); setError(""); }} className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold bg-primary text-primary-foreground rounded-xl shadow-md shadow-primary/10 hover:bg-primary/90 hover:scale-[1.02] transition-all cursor-pointer">
          <Plus size={16} />
          Record Movement
        </button>
      </div>

      {/* Warehouse Grid: Stock per product per warehouse */}
      <div className="bg-card border border-border/80 rounded-2xl overflow-hidden shadow-sm">
        <div className="p-5 border-b border-border/60 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-base">Warehouse Stock Levels</h2>
            <p className="text-[10px] text-muted-foreground mt-0.5">Current physical unit counts split by depot</p>
          </div>
          <div className="flex gap-2">
            {warehouses.map(wh => (
              <span key={wh.id} className="text-[10px] font-semibold px-2.5 py-1 bg-secondary text-secondary-foreground rounded-lg">{wh.name.split(" ")[0]}</span>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/20 border-b border-border/40">
                <th className="text-left px-5 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wide">Product</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wide">Min Level</th>
                {warehouses.map(wh => (
                  <th key={wh.id} className="text-right px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wide">{wh.name.split(" ")[0]}</th>
                ))}
                <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wide">Total</th>
                <th className="text-center px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wide">Health</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {products.map(prod => {
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
                    {warehouses.map(wh => {
                      const qty = getStock(prod.id, wh.id);
                      const whLow = qty < prod.minStockLevel;
                      return (
                        <td key={wh.id} className="px-4 py-4 text-right">
                          <span className={cn("text-sm font-bold", whLow ? "text-red-500" : "text-foreground")}>{qty}</span>
                          {whLow && <span className="ml-1 text-[9px] text-red-400 font-bold">⚠</span>}
                        </td>
                      );
                    })}
                    <td className="px-4 py-4 text-right">
                      <span className="text-sm font-extrabold text-foreground">{total}</span>
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
                <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wide hidden md:table-cell">Route</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wide hidden lg:table-cell">Notes</th>
                <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wide">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {movements.slice(0, 30).map(mov => {
                const prod = products.find(p => p.id === mov.productId);
                const srcWh = warehouses.find(w => w.id === mov.sourceWhId);
                const dstWh = warehouses.find(w => w.id === mov.destWhId);
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
                    <td className="px-4 py-3.5 hidden md:table-cell">
                      <p className="text-[10px] text-muted-foreground">
                        {srcWh ? srcWh.name.split(" ")[0] : "—"} {srcWh && dstWh ? "→" : ""} {dstWh ? dstWh.name.split(" ")[0] : ""}
                      </p>
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
            <div className="p-6 space-y-4">
              {/* Movement Type Picker */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground">Movement Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {MOVEMENT_TYPES.map(t => (
                    <button key={t.value} onClick={() => setForm(f => ({ ...f, type: t.value as any, sourceWhId: "", destWhId: "" }))} className={cn("flex flex-col items-center gap-1 py-3 rounded-xl border text-xs font-semibold transition-all cursor-pointer", form.type === t.value ? "border-primary bg-primary/5 text-primary" : "border-border bg-muted/20 text-muted-foreground hover:border-border/80 hover:text-foreground")}>
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

              {needsSource && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">Source Warehouse (From)</label>
                  <select value={form.sourceWhId} onChange={e => setForm(f => ({ ...f, sourceWhId: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer">
                    <option value="">Select warehouse...</option>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
              )}

              {needsDest && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">Destination Warehouse (To)</label>
                  <select value={form.destWhId} onChange={e => setForm(f => ({ ...f, destWhId: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer">
                    <option value="">Select warehouse...</option>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Quantity</label>
                <input type="number" min={1} value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: parseInt(e.target.value) || 1 }))} className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </div>

              {form.productId && form.sourceWhId && (
                <div className="flex items-center gap-2 p-3 bg-amber-50/50 dark:bg-amber-950/10 border border-amber-200/40 dark:border-amber-900/30 rounded-xl text-xs">
                  <AlertTriangle size={13} className="text-amber-600 shrink-0" />
                  <span className="text-amber-700 dark:text-amber-400 font-medium">
                    Available in source: <strong>{getStock(form.productId, form.sourceWhId)} units</strong>
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
