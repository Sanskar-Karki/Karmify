"use client";

// One product: its stock per size and colour, everything that changed that
// stock (restocks, sales, returns, adjustments) and the orders it was in.

import React, { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowLeft, ArrowDownLeft, ArrowUpRight, Check, ChevronRight, Edit2, Package, X, PackagePlus, RefreshCw, RotateCcw, Wrench,
} from "lucide-react";
import { adjustStock, getProductHistory, setVariantStock } from "@/app/actions";
import { ProductEditor } from "@/components/products/ProductEditor";
import { mutate } from "@/lib/mutate";
import { cn, formatNPR } from "@/lib/utils";
import { useResources } from "@/lib/useResources";
import { resources } from "@/lib/resources";
import { customerKey, DELIVERY_STATUSES, DELIVERY_STYLES } from "@/lib/orders";
import { lowStockLines } from "@/lib/lowStock";
import { timeAgo } from "@/lib/notifications";
import { Button } from "@/components/shared/Button";
import { Pulse } from "@/components/shared/Pulse";
import { VariantMatrix } from "@/components/shared/VariantStock";
import { RestockDialog } from "@/components/products/RestockDialog";
import type { ActionResult } from "@/lib/types";

type History = Awaited<ReturnType<typeof getProductHistory>> extends ActionResult<infer T> ? T : never;
type MovementFilter = "all" | "in" | "out" | "returns" | "adjust";

const card = "bg-card border border-border/80 rounded-2xl shadow-sm";

const MOVEMENT: Record<string, { label: string; sign: 1 | -1 | 0; icon: typeof Package; tone: string; group: MovementFilter }> = {
  STOCK_IN: { label: "Stock in", sign: 1, icon: ArrowDownLeft, tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400", group: "in" },
  STOCK_OUT: { label: "Sold / out", sign: -1, icon: ArrowUpRight, tone: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400", group: "out" },
  DAMAGED: { label: "Damaged", sign: -1, icon: AlertTriangle, tone: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400", group: "out" },
  RETURNED: { label: "Returned", sign: 1, icon: RotateCcw, tone: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400", group: "returns" },
  ADJUSTMENT: { label: "Adjusted", sign: 0, icon: Wrench, tone: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400", group: "adjust" },
};

const FILTERS: { id: MovementFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "in", label: "Restocks" },
  { id: "out", label: "Sold / out" },
  { id: "returns", label: "Returns" },
  { id: "adjust", label: "Adjustments" },
];

const dateTime = (value: Date | string) =>
  new Date(value).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

export default function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { products, categories, suppliers, stocks, loading, refetch } = useResources({
    products: resources.products,
    categories: resources.categories,
    suppliers: resources.suppliers,
    stocks: resources.stocks,
  });
  const product = products.find(p => p.id === id) ?? null;

  const [history, setHistory] = useState<History | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [filter, setFilter] = useState<MovementFilter>("all");
  const [restocking, setRestocking] = useState(false);
  const [editing, setEditing] = useState(false);
  // Editing stock in place: typed numbers by size/colour row id (or "total" for a product without sizes).
  const [stockEdit, setStockEdit] = useState<Record<string, string> | null>(null);
  const [savingStock, setSavingStock] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const result = await getProductHistory(id);
      if (result.ok) {
        setHistory(result.data);
        setHistoryError(null);
      } else setHistoryError(result.message);
    } catch {
      setHistoryError("Could not reach the server. Check the connection and reload.");
    }
  }, [id]);
  useEffect(() => {
    // Loaded after the first paint so the page shell shows straight away.
    const timer = setTimeout(() => void loadHistory(), 0);
    return () => clearTimeout(timer);
  }, [loadHistory]);

  const total = useMemo(() => stocks.filter(s => s.productId === id).reduce((sum, s) => sum + s.quantity, 0), [stocks, id]);
  const low = useMemo(
    () => (product ? lowStockLines([product], new Map([[product.id, total]])).filter(l => !l.ignored) : []),
    [product, total]
  );

  const stats = useMemo(() => {
    if (!history) return null;
    let sold = 0, revenue = 0, pr = 0, returned = 0;
    for (const line of history.lines) {
      if (line.sale.deliveryStatus === "CANCELLED") continue;
      const kept = line.quantity - line.returnedQty;
      returned += line.returnedQty;
      if (line.sale.kind === "pr") pr += kept;
      else {
        sold += kept;
        revenue += kept * line.unitPrice;
      }
    }
    const lastIn = history.movements.find(m => m.type === "STOCK_IN");
    const restocked = history.movements.filter(m => m.type === "STOCK_IN").reduce((sum, m) => sum + m.quantity, 0);
    return { sold, revenue, pr, returned, lastIn: lastIn ? new Date(lastIn.createdAt) : null, restocked };
  }, [history]);

  async function afterRestock() {
    await Promise.all([refetch({ quiet: true }), loadHistory()]);
  }

  /** Saves the numbers typed into the stock table, then shows the fresh stock and history. */
  async function saveStock() {
    if (!product || !stockEdit) return;
    const count = (value: string | undefined, fallback: number) =>
      value === undefined || value.trim() === "" ? fallback : Math.floor(Number(value));
    if (Object.values(stockEdit).some(v => v.trim() !== "" && !(Number.isFinite(Number(v)) && Number(v) >= 0))) {
      return;
    }
    setSavingStock(true);
    const result = product.variants.length > 0
      ? await mutate(
          () => setVariantStock({
            productId: product.id,
            rows: product.variants.map(v => ({ variantId: v.id, quantity: count(stockEdit[v.id], v.quantity) })),
          }),
          { success: r => (r.changed ? `Stock saved (${r.changed} size${r.changed === 1 ? "" : "s"} changed).` : "Nothing changed.") }
        )
      : await mutate(
          () => adjustStock({ productId: product.id, quantity: count(stockEdit.total, total), notes: "Stock edited on the product page" }),
          { success: r => (r.change ? "Stock saved." : "Nothing changed.") }
        );
    setSavingStock(false);
    if (result.ok) {
      setStockEdit(null);
      await afterRestock();
    }
  }
  const stockInvalid = stockEdit !== null && Object.values(stockEdit).some(v => v.trim() !== "" && !(Number.isInteger(Number(v)) && Number(v) >= 0));

  if (loading) return <ProductDetailPlaceholder />;

  if (!product) {
    return (
      <div className={cn(card, "flex flex-col items-center gap-2 py-16 text-center text-muted-foreground")}>
        <Package size={36} className="opacity-30" />
        <p className="text-sm font-semibold">Product not found</p>
        <Link href="/products" className="mt-2 text-xs font-semibold text-primary hover:underline">Back to the catalog</Link>
      </div>
    );
  }

  const category = categories.find(c => c.id === product.categoryId)?.name ?? "—";
  const supplier = suppliers.find(s => s.id === product.supplierId)?.companyName ?? "—";
  const margin = product.sellingPrice > 0 ? Math.round(((product.sellingPrice - product.costPrice) / product.sellingPrice) * 100) : 0;
  const movements = history ? history.movements.filter(m => filter === "all" || MOVEMENT[m.type]?.group === filter) : [];

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Breadcrumb */}
      <div className="flex items-center gap-3">
        <Link href="/products" aria-label="Back to the product catalog" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border transition-colors hover:bg-muted">
          <ArrowLeft size={16} />
        </Link>
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <Link href="/products" className="hover:text-foreground">Product Catalog</Link>
          <ChevronRight size={12} className="shrink-0" />
          <span className="truncate font-semibold text-foreground">{product.name}</span>
        </nav>
      </div>

      {/* Header */}
      <section className={cn(card, "flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6")}>
        <div className="flex min-w-0 items-start gap-4">
          {product.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- Cloudinary/website URLs of any host
            <img src={product.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-2xl border border-border/60 object-cover" />
          ) : (
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Package size={26} /></span>
          )}
          <div className="min-w-0">
            <h1 className="break-words text-xl font-extrabold leading-tight tracking-tight sm:text-2xl">{product.name}</h1>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">{product.sku}{product.barcode ? ` · ${product.barcode}` : ""}</p>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
              <span className="rounded-md bg-secondary px-2 py-0.5 font-medium text-secondary-foreground">{category}</span>
              <span className="rounded-md bg-muted px-2 py-0.5 text-muted-foreground">Supplier: {supplier}</span>
              {product.brand && <span className="rounded-md bg-muted px-2 py-0.5 text-muted-foreground">{product.brand}</span>}
              <span className={cn("rounded-full px-2 py-0.5 font-bold uppercase", product.status === "active" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800")}>{product.status}</span>
            </div>
            <p className="mt-2 text-sm">
              <span className="font-black">{formatNPR(product.sellingPrice)}</span>
              <span className="text-[12px] text-muted-foreground"> · cost {formatNPR(product.costPrice)} · <span className="font-semibold text-emerald-700 dark:text-emerald-400">{margin}% margin</span></span>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" onClick={() => setEditing(true)}><Edit2 size={14} /> Edit</Button>
          <Button onClick={() => setRestocking(true)}><PackagePlus size={15} /> Restock</Button>
        </div>
      </section>

      {/* Numbers */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="Product summary">
        {[
          { label: "In stock", value: String(total), note: low.length ? `${low.length} low` : `Alert below ${product.minStockLevel}`, warn: low.length > 0 },
          { label: "Sold", value: stats ? String(stats.sold) : null, note: "Units, cancelled left out" },
          { label: "Revenue", value: stats ? formatNPR(stats.revenue) : null, note: "From units sold" },
          { label: "Given as PR", value: stats ? String(stats.pr) : null, note: "Free, no money in" },
          { label: "Returned", value: stats ? String(stats.returned) : null, note: "Put back in stock" },
          { label: "Last restock", value: stats ? (stats.lastIn ? timeAgo(stats.lastIn) : "Never") : null, note: stats ? `${stats.restocked} units in total` : "" },
        ].map(stat => (
          <div key={stat.label} className={cn(card, "p-3.5")}>
            <p className="text-[11px] font-semibold text-muted-foreground">{stat.label}</p>
            {stat.value === null ? <Pulse className="mt-1 h-5 w-14" /> : (
              <p className={cn("mt-0.5 text-lg font-black", stat.warn ? "text-amber-600 dark:text-amber-400" : "text-foreground")}>{stat.value}</p>
            )}
            <p className="truncate text-[10px] text-muted-foreground">{stat.note}</p>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Stock by size */}
        <section className={cn(card, "p-5 sm:p-6")} aria-labelledby="stock-title">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="stock-title" className="text-base font-bold">Stock {product.variants.length > 0 ? "by size and colour" : ""}</h2>
              <p className="text-[11px] text-muted-foreground">
                {product.variants.length > 0 ? `${product.variants.length} sizes/colours · ${total} in total` : `${total} units`} · low-stock alert below {product.minStockLevel}
              </p>
            </div>
            {stockEdit === null ? (
              <button
                type="button"
                onClick={() => setStockEdit({})}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold hover:bg-muted"
              >
                <Edit2 size={12} /> Edit stock
              </button>
            ) : (
              <div className="flex shrink-0 gap-1.5">
                <Button variant="secondary" onClick={() => setStockEdit(null)} disabled={savingStock} className="px-2.5 py-1.5 text-xs"><X size={12} /> Cancel</Button>
                <Button onClick={saveStock} loading={savingStock} disabled={stockInvalid} className="px-2.5 py-1.5 text-xs">{!savingStock && <Check size={12} />} Save</Button>
              </div>
            )}
          </div>
          <div className="mt-4">
            {product.variants.length > 0 ? (
              <VariantMatrix
                variants={product.variants}
                className="w-fit max-w-full"
                edit={stockEdit === null ? undefined : { values: stockEdit, onChange: (id, value) => setStockEdit(e => ({ ...(e ?? {}), [id]: value })) }}
              />
            ) : stockEdit !== null ? (
              <input
                type="number"
                inputMode="numeric"
                min={0}
                autoFocus
                aria-label="Units in stock"
                value={stockEdit.total ?? String(total)}
                onChange={e => setStockEdit({ total: e.target.value })}
                onKeyDown={e => { if (e.key === "Enter") void saveStock(); }}
                onFocus={e => e.target.select()}
                className="h-11 w-32 rounded-xl border border-primary bg-background px-3 text-xl font-black tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            ) : (
              <p className="text-3xl font-black">{total} <span className="text-sm font-semibold text-muted-foreground">units</span></p>
            )}
          </div>
          {stockEdit !== null && (
            <p className="mt-3 text-[11px] text-muted-foreground">
              Type what is actually on the shelf. Saved as an adjustment in the stock history. For new stock coming in, use Restock instead.
              {stockInvalid && <span className="block font-semibold text-red-600">Use whole numbers of 0 or more.</span>}
            </p>
          )}
          {low.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Running low">
              {low.map(line => (
                <li key={line.key} className={cn("rounded-md px-2 py-0.5 text-[11px] font-bold", line.quantity <= 0 ? "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400" : "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400")}>
                  {line.variant ? `${line.variant}: ` : ""}{line.quantity <= 0 ? "out" : `${line.quantity} left`}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Orders */}
        <section className={cn(card, "p-5 sm:p-6")} aria-labelledby="orders-title">
          <h2 id="orders-title" className="text-base font-bold">Orders with this product</h2>
          <p className="text-[11px] text-muted-foreground">Newest first{history && history.lines.length >= 200 ? " · last 200" : ""}</p>
          <ul className="mt-3 max-h-[26rem] divide-y divide-border/50 overflow-y-auto">
            {!history && !historyError && Array.from({ length: 4 }, (_, i) => <li key={i} className="py-2.5"><Pulse className="h-8 w-full" /></li>)}
            {history && history.lines.length === 0 && <li className="py-8 text-center text-xs text-muted-foreground">Not in any order yet.</li>}
            {history?.lines.map(line => (
              <li key={line.id}>
                <Link href={`/customers/${encodeURIComponent(customerKey(line.sale))}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-muted/50">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-xs font-semibold">{line.sale.customerName || "Walk-in"}</span>
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{line.sale.invoiceNumber}</span>
                      {line.sale.kind === "pr" && <span className="shrink-0 rounded bg-pink-100 px-1 text-[9px] font-extrabold uppercase text-pink-700 dark:bg-pink-950/40 dark:text-pink-300">PR</span>}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {[line.variant, `${line.quantity} × ${formatNPR(line.unitPrice)}`, line.returnedQty > 0 ? `${line.returnedQty} returned` : null].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className={cn("block rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase", DELIVERY_STYLES[line.sale.deliveryStatus] ?? DELIVERY_STYLES.IN_PROCESS)}>
                      {DELIVERY_STATUSES.find(d => d.value === line.sale.deliveryStatus)?.label ?? line.sale.deliveryStatus}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-muted-foreground">{new Date(line.sale.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Stock history */}
      <section className={cn(card, "overflow-hidden")} aria-labelledby="history-title">
        <div className="flex flex-col gap-3 border-b border-border/60 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="history-title" className="text-base font-bold">Stock history</h2>
            <p className="text-[11px] text-muted-foreground">Every restock, sale, return and correction{history && history.movements.length >= 300 ? " · last 300" : ""}</p>
          </div>
          <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]" role="tablist" aria-label="Filter stock history">
            {FILTERS.map(f => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cn("shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors", filter === f.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground")}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        {historyError ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-xs text-muted-foreground">
            <p>{historyError}</p>
            <button type="button" onClick={() => void loadHistory()} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"><RefreshCw size={12} /> Try again</button>
          </div>
        ) : (
          <ul className="divide-y divide-border/40">
            {!history && Array.from({ length: 5 }, (_, i) => <li key={i} className="px-5 py-3"><Pulse className="h-8 w-full" /></li>)}
            {history && movements.length === 0 && <li className="py-10 text-center text-xs text-muted-foreground">Nothing here yet.</li>}
            {movements.map(m => {
              const kind = MOVEMENT[m.type] ?? MOVEMENT.ADJUSTMENT;
              const Icon = kind.icon;
              return (
                <li key={m.id} className="data-row flex items-center gap-3 px-5 py-3">
                  <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", kind.tone)}><Icon size={14} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold">{kind.label}</span>
                    <span className="block break-words text-[11px] text-muted-foreground">{m.notes || "—"}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className={cn("block text-sm font-extrabold", kind.sign > 0 ? "text-emerald-600" : kind.sign < 0 ? "text-blue-600 dark:text-blue-400" : "text-amber-600")}>
                      {kind.sign > 0 ? "+" : kind.sign < 0 ? "−" : "±"}{m.quantity}
                    </span>
                    <span className="block text-[10px] text-muted-foreground">{dateTime(m.createdAt)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ProductEditor
        target={editing ? { mode: "edit", product } : null}
        categories={categories}
        suppliers={suppliers}
        currentStock={() => total}
        onClose={() => setEditing(false)}
        onSaved={afterRestock}
        onSuppliersChanged={() => refetch({ quiet: true })}
      />
      <RestockDialog
        product={restocking ? product : null}
        currentStock={total}
        onClose={() => setRestocking(false)}
        onDone={afterRestock}
      />
    </div>
  );
}

function ProductDetailPlaceholder() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading product">
      <Pulse className="h-9 w-64" />
      <div className={cn(card, "flex gap-4 p-6")}>
        <Pulse className="h-16 w-16 rounded-2xl" />
        <div className="flex-1 space-y-2"><Pulse className="h-6 w-56" /><Pulse className="h-3 w-32" /><Pulse className="h-4 w-48" /></div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => <div key={i} className={cn(card, "p-3.5")}><Pulse className="h-14 w-full" /></div>)}
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className={cn(card, "p-6")}><Pulse className="h-48 w-full" /></div>
        <div className={cn(card, "p-6")}><Pulse className="h-48 w-full" /></div>
      </div>
    </div>
  );
}
