"use client";

import React, { useMemo, useState } from "react";
import { ArrowLeftRight, Plus, AlertTriangle, CheckCircle2, Package, ArrowRight, ArrowLeft, Wrench, RefreshCw, Search } from "lucide-react";
import { recordStockMovement } from "@/app/actions";
import { cn } from "@/lib/utils";
import { MOVEMENT_COLUMNS, PlaceholderRows, STOCK_COLUMNS } from "@/components/skeletons/placeholders";
import { EmptyState } from "@/components/shared/EmptyState";
import { useResources } from "@/lib/useResources";
import { resources } from "@/lib/resources";
import { Dropdown } from "@/components/shared/Dropdown";
import { ShowMoreButton, useShowMore } from "@/components/shared/ShowMore";
import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/shared/Button";
import { mutate } from "@/lib/mutate";

type MovementType = "STOCK_IN" | "STOCK_OUT" | "DAMAGED" | "RETURNED" | "ADJUSTMENT";

const MOVEMENT_TYPES = [
  { value: "STOCK_IN", label: "Stock In", color: "emerald", icon: ArrowLeft },
  { value: "STOCK_OUT", label: "Stock Out", color: "blue", icon: ArrowRight },
  { value: "DAMAGED", label: "Damaged", color: "red", icon: AlertTriangle },
  { value: "ADJUSTMENT", label: "Adjustment", color: "amber", icon: Wrench },
  { value: "RETURNED", label: "Returned", color: "violet", icon: RefreshCw },
] as const;

const BLANK_FORM = { productId: "", type: "STOCK_IN" as MovementType, quantity: 1, notes: "" };
const BLANK_FORM_JSON = JSON.stringify(BLANK_FORM);

const TYPE_STYLES: Record<string, string> = {
  STOCK_IN: "bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400",
  STOCK_OUT: "bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400",
  DAMAGED: "bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400",
  ADJUSTMENT: "bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400",
  RETURNED: "bg-violet-100 dark:bg-violet-950/30 text-violet-700 dark:text-violet-400",
};

export default function InventoryPage() {
  const { products, stocks, movements, loading, refetch } = useResources({
    products: resources.products,
    stocks: resources.stocks,
    movements: resources.movements,
  });
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(BLANK_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const [lowOnly, setLowOnly] = useState(false);

  const stockByProduct = useMemo(() => {
    const totals = new Map<string, number>();
    for (const s of stocks) totals.set(s.productId, (totals.get(s.productId) ?? 0) + s.quantity);
    return totals;
  }, [stocks]);

  const productById = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);

  const getTotalStock = (productId: string) => stockByProduct.get(productId) ?? 0;

  const visibleProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(p => {
      if (lowOnly && (stockByProduct.get(p.id) ?? 0) >= p.minStockLevel) return false;
      return !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
    });
  }, [products, search, lowOnly, stockByProduct]);

  const { visible: displayedProducts, remaining, step, showMore } = useShowMore(visibleProducts);

  const lowCount = useMemo(
    () => products.filter(p => (stockByProduct.get(p.id) ?? 0) < p.minStockLevel).length,
    [products, stockByProduct]
  );

  async function handleSubmit() {
    setError("");
    const { productId, type, quantity, notes } = form;
    if (!productId) return setError("Please select a product.");
    if (quantity <= 0) return setError("Quantity must be greater than 0.");
    if (["STOCK_OUT", "DAMAGED"].includes(type)) {
      const available = getTotalStock(productId);
      if (quantity > available) return setError(`Insufficient stock. Only ${available} units available.`);
    }

    setSubmitting(true);
    const result = await mutate(
      () => recordStockMovement({ productId, type, quantity, notes: notes.trim() || undefined }),
      { success: `${MOVEMENT_TYPES.find(t => t.value === type)?.label} of ${quantity} recorded for ${productById.get(productId)?.name ?? "product"}.` }
    );
    if (result.ok) {
      setShowModal(false);
      setForm(BLANK_FORM);
      await refetch();
    }
    setSubmitting(false);
  }

  return (
<>
      <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Inventory & Stock Hub</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Track and audit stock for your store</p>
        </div>
        <Button onClick={() => { setShowModal(true); setError(""); }} className="shrink-0">
          <Plus size={16} />
          Record Movement
        </Button>
      </div>

      {/* Stock Levels */}
      <div className="bg-card border border-border/80 rounded-2xl overflow-hidden shadow-sm">
        <div className="p-5 border-b border-border/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-base">Stock Levels</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">Current physical unit counts</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:w-56">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or SKU..." aria-label="Search stock levels" className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
            <button type="button" aria-pressed={lowOnly} onClick={() => setLowOnly(v => !v)} className={cn("flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border whitespace-nowrap transition-colors", lowOnly ? "bg-red-600 text-white border-red-600" : "bg-background text-muted-foreground border-border hover:bg-muted")}>
              <AlertTriangle size={12} /> Low{!loading && ` (${lowCount})`}
            </button>
          </div>
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
              {loading && <PlaceholderRows columns={STOCK_COLUMNS} rows={8} cellClassName="px-5 py-4" />}
              {!loading && products.length === 0 && (
                <EmptyState colSpan={4} icon={Package} title="No products yet" description="Add products in the catalog to start tracking their stock levels here." />
              )}
              {!loading && products.length > 0 && visibleProducts.length === 0 && (
                <EmptyState colSpan={4} icon={Search} title="No matching products" description="Try a different search or turn off the low stock filter." />
              )}
              {!loading && displayedProducts.map(prod => {
                const total = getTotalStock(prod.id);
                const isLow = total < prod.minStockLevel;
                return (
                  <tr key={prod.id} className="data-row">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 border border-border/40 flex items-center justify-center shrink-0">
                          <Package size={14} className="text-primary/70" />
                        </div>
                        <div>
                          <p className="font-semibold text-xs text-foreground">{prod.name}</p>
                          <p className="text-[11px] text-muted-foreground font-mono">{prod.sku}</p>
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
                      <span className={cn("inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full", isLow ? "bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400" : "bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400")}>
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
        {!loading && <ShowMoreButton remaining={remaining} step={step} onClick={showMore} />}
      </div>

      {/* Movement Log */}
      <div className="bg-card border border-border/80 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-5 border-b border-border/60">
          <h2 className="font-bold text-base">Stock Movement Ledger</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">Full audit trail of every stock event recorded in the system</p>
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
              {loading && <PlaceholderRows columns={MOVEMENT_COLUMNS} rows={5} />}
              {!loading && movements.length === 0 && (
                <EmptyState colSpan={5} icon={ArrowLeftRight} title="No stock movements yet" description="Record a stock-in, stock-out, or adjustment and it will appear in this ledger." />
              )}
              {!loading && movements.slice(0, 30).map(mov => {
                const prod = productById.get(mov.productId);
                return (
                  <tr key={mov.id} className="data-row">
                    <td className="px-5 py-3.5">
                      <span className={cn("text-[11px] font-bold uppercase px-2.5 py-1 rounded-lg", TYPE_STYLES[mov.type] ?? "bg-muted text-muted-foreground")}>
                        {mov.type.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <p className="text-xs font-semibold">{prod?.name ?? "—"}</p>
                      <p className="text-[11px] text-muted-foreground font-mono">{prod?.sku}</p>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <span className="font-bold text-sm">{mov.quantity}</span>
                    </td>
                    <td className="px-4 py-3.5 hidden lg:table-cell">
                      <p className="text-[11px] text-muted-foreground max-w-[200px] truncate">{mov.notes ?? "—"}</p>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <p className="text-[11px] text-muted-foreground">{new Date(mov.createdAt).toLocaleDateString("en-US", { day: "2-digit", month: "short" })}</p>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Stock Movement Modal */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title="Record Stock Movement"
        icon={ArrowLeftRight}
        busy={submitting}
        dirty={JSON.stringify(form) !== BLANK_FORM_JSON}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowModal(false)} disabled={submitting} className="flex-1">Cancel</Button>
            <Button onClick={handleSubmit} loading={submitting} className="flex-1">{submitting ? "Applying…" : "Apply Movement"}</Button>
          </>
        }
      >
            <div className="p-5 sm:p-6 space-y-3">
              {/* Movement Type Picker */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground">Movement Type</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {MOVEMENT_TYPES.map(t => (
                    <button key={t.value} type="button" aria-pressed={form.type === t.value} onClick={() => setForm(f => ({ ...f, type: t.value }))} className={cn("flex flex-col items-center gap-1 py-3 rounded-xl border text-xs font-semibold transition-all", form.type === t.value ? "border-primary bg-primary/5 text-primary" : "border-border bg-muted/20 text-muted-foreground hover:border-border/80 hover:text-foreground")}>
                      <t.icon size={15} />
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Product</label>
                <Dropdown
                  aria-label="Product"
                  value={form.productId}
                  onChange={v => setForm(f => ({ ...f, productId: v }))}
                  placeholder="Select product..."
                  options={products.map(p => ({ value: p.id, label: `${p.name} (${p.sku})` }))}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="movement-qty" className="text-xs font-semibold text-muted-foreground">Quantity</label>
                <input id="movement-qty" type="number" inputMode="numeric" min={1} value={form.quantity || ""} onChange={e => setForm(f => ({ ...f, quantity: Math.max(0, parseInt(e.target.value) || 0) }))} className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
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
                <label htmlFor="movement-notes" className="text-xs font-semibold text-muted-foreground">Notes (optional)</label>
                <textarea id="movement-notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="e.g. Quarterly damage audit" className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none" />
              </div>

              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950/20 border border-red-200/40 dark:border-red-900/30 rounded-xl text-xs text-red-600 dark:text-red-400 font-semibold">
                  <AlertTriangle size={13} />
                  {error}
                </div>
              )}
            </div>
      </Modal>
      </div>
</>
  );
}

