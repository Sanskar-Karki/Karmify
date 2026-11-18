"use client";

import React, { useId, useMemo, useState } from "react";
import { Package, Plus, Search, Trash2 } from "lucide-react";
import { Dropdown } from "@/components/shared/Dropdown";
import { useResources } from "@/lib/useResources";
import { resources } from "@/lib/resources";
import { cn, formatNPR } from "@/lib/utils";
import type { Sale } from "@/lib/types";

/** One line of the order being edited. itemId is null for a line added in this edit. */
export type EditLine = {
  key: string;
  itemId: string | null;
  productId: string;
  variantId: string | null;
  name: string;
  variantLabel: string | null;
  quantity: number;
  unitPrice: number;
  /** Units already returned: the line keeps its product and size, and can't go below this. */
  returnedQty: number;
};

export const linesFromSale = (sale: Sale): EditLine[] =>
  sale.items.map(item => ({
    key: item.id,
    itemId: item.id,
    productId: item.productId,
    variantId: item.variantId ?? null,
    name: item.product.name,
    variantLabel: item.variant ?? null,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    returnedQty: item.returnedQty ?? 0,
  }));

export const linesGoods = (lines: EditLine[]) => lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);

/**
 * The order total after an item edit, as the server works it out: it moves by the
 * change in goods and discount, so anything else in it stays (a website order's
 * total includes its delivery charge). A PR order stays free.
 */
export function editedTotal(sale: Sale, lines: EditLine[], discount: string) {
  if (sale.kind === "pr") return 0;
  const before = sale.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0) - (sale.discount ?? 0);
  const after = linesGoods(lines) - (parseFloat(discount) || 0);
  return Math.max(0, Math.round((sale.totalAmount + after - before) * 100) / 100);
}

/** The same lines, compared for "was anything changed". */
export const linesSignature = (lines: EditLine[]) =>
  JSON.stringify(lines.map(l => [l.itemId, l.productId, l.variantId, l.quantity, l.unitPrice]));

const keyOf = (productId: string, variantId: string | null) => `${productId}|${variantId ?? ""}`;

/** Units of one product + size/colour coming off or going on the order. */
export type StockChange = { key: string; name: string; label: string | null; quantity: number };

/**
 * What saving the edited lines does to stock, per product + size/colour, as the
 * server works it out: units coming off the order and units going on.
 */
export function stockChanges(sale: Sale, lines: EditLine[]) {
  const delta = new Map<string, StockChange & { change: number }>();
  const shift = (productId: string, variantId: string | null, name: string, label: string | null, change: number) => {
    const key = keyOf(productId, variantId);
    const entry = delta.get(key) ?? { key, name, label, quantity: 0, change: 0 };
    entry.change += change;
    delta.set(key, entry);
  };
  for (const item of sale.items) shift(item.productId, item.variantId ?? null, item.product.name, item.variant ?? null, -item.quantity);
  for (const l of lines) shift(l.productId, l.variantId, l.name, l.variantLabel, l.quantity);
  const all = [...delta.values()];
  return {
    removed: all.filter(d => d.change < 0).map(({ change, ...d }) => ({ ...d, quantity: -change })),
    added: all.filter(d => d.change > 0).map(({ change, ...d }) => ({ ...d, quantity: change })),
  };
}
const optionLabel = (v: { size: string; color: string }) => [v.size, v.color].filter(Boolean).join(" · ") || "One size";
const numberField = "h-9 rounded-lg border border-border bg-background px-2 text-[13px] font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

/**
 * The items of an order, editable: size/colour, quantity and price per line,
 * remove a line, add a product. Shows what's in stock for each line, counting
 * what this order already holds, since saving only takes or returns the difference.
 */
export function OrderItemsEditor({
  sale, lines, onLinesChange, discount, onDiscountChange,
}: {
  sale: Sale;
  lines: EditLine[];
  onLinesChange: (lines: EditLine[]) => void;
  discount: string;
  onDiscountChange: (value: string) => void;
}) {
  const { products, stocks, loading } = useResources({ products: resources.products, stocks: resources.stocks });
  const [query, setQuery] = useState("");
  // Several orders can be in edit at once on a customer's page, so ids are per editor.
  const discountId = useId();
  const pr = sale.kind === "pr";

  const productById = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);
  const stockByProduct = useMemo(() => {
    const totals = new Map<string, number>();
    for (const s of stocks) totals.set(s.productId, (totals.get(s.productId) ?? 0) + s.quantity);
    return totals;
  }, [stocks]);

  // What this order already holds, per size/colour and per product: saving only moves the difference.
  const held = useMemo(() => {
    const byKey = new Map<string, number>();
    const byProduct = new Map<string, number>();
    for (const item of sale.items) {
      const out = item.quantity - (item.returnedQty ?? 0);
      byKey.set(keyOf(item.productId, item.variantId ?? null), (byKey.get(keyOf(item.productId, item.variantId ?? null)) ?? 0) + out);
      byProduct.set(item.productId, (byProduct.get(item.productId) ?? 0) + out);
    }
    return { byKey, byProduct };
  }, [sale.items]);

  /** Units this line's size/colour (or product) can have in total on this order. */
  function available(productId: string, variantId: string | null) {
    const product = productById.get(productId);
    const inStock = variantId
      ? product?.variants.find(v => v.id === variantId)?.quantity ?? 0
      : stockByProduct.get(productId) ?? 0;
    return inStock + (variantId ? held.byKey.get(keyOf(productId, variantId)) ?? 0 : held.byProduct.get(productId) ?? 0);
  }
  const wanted = new Map<string, number>();
  for (const l of lines) wanted.set(keyOf(l.productId, l.variantId), (wanted.get(keyOf(l.productId, l.variantId)) ?? 0) + l.quantity);

  const update = (key: string, patch: Partial<EditLine>) => onLinesChange(lines.map(l => (l.key === key ? { ...l, ...patch } : l)));

  function add(productId: string) {
    const product = productById.get(productId);
    if (!product) return;
    const variant = product.variants.find(v => v.quantity > 0) ?? product.variants[0] ?? null;
    const variantId = variant?.id ?? null;
    setQuery("");
    const same = lines.find(l => l.productId === productId && l.variantId === variantId && l.unitPrice === product.sellingPrice);
    if (same) return update(same.key, { quantity: same.quantity + 1 });
    onLinesChange([
      ...lines,
      {
        key: `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        itemId: null,
        productId,
        variantId,
        name: product.name,
        variantLabel: variant ? optionLabel(variant) : null,
        quantity: 1,
        unitPrice: product.sellingPrice,
        returnedQty: 0,
      },
    ]);
  }

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter(p => p.status === "active" && (p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.barcode?.toLowerCase().includes(q)))
      .slice(0, 6);
  }, [products, query]);

  const goods = linesGoods(lines);
  const discountValue = Math.max(0, parseFloat(discount) || 0);

  return (
    <div className="space-y-2.5">
      <ul className="space-y-2">
        {lines.map(line => {
          const product = productById.get(line.productId);
          const locked = line.returnedQty > 0;
          const sized = (product?.variants.length ?? 0) > 0;
          const can = available(line.productId, line.variantId);
          const short = !loading && (wanted.get(keyOf(line.productId, line.variantId)) ?? 0) > can;
          return (
            <li key={line.key} className={cn("rounded-xl border p-2.5", short ? "border-red-300 bg-red-50/50 dark:border-red-900/60 dark:bg-red-950/20" : "border-border bg-background")}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-foreground">{line.name}</p>
                  {sized && !locked ? (
                    <div className="mt-1 max-w-56">
                      <Dropdown
                        aria-label={`Size/colour of ${line.name}`}
                        value={line.variantId ?? ""}
                        onChange={v => {
                          const variant = product!.variants.find(x => x.id === v);
                          update(line.key, { variantId: v || null, variantLabel: variant ? optionLabel(variant) : null });
                        }}
                        placeholder="Choose size/colour"
                        options={product!.variants.map(v => ({
                          value: v.id,
                          label: `${optionLabel(v)} · ${available(line.productId, v.id)} available`,
                        }))}
                      />
                    </div>
                  ) : (
                    line.variantLabel && <p className="text-[11px] text-muted-foreground">{line.variantLabel}</p>
                  )}
                  <p className={cn("mt-1 text-[11px]", short ? "font-semibold text-red-600" : "text-muted-foreground")}>
                    {loading ? "Checking stock…" : short ? `Only ${can} available` : `${can} available`}
                    {locked && ` · ${line.returnedQty} returned, so it stays on the order`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onLinesChange(lines.filter(l => l.key !== line.key))}
                  disabled={locked || lines.length === 1}
                  title={locked ? "It has returns recorded" : lines.length === 1 ? "An order needs at least one item" : "Remove from the order"}
                  aria-label={`Remove ${line.name}`}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-red-600 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Qty</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={Math.max(1, line.returnedQty)}
                    value={line.quantity}
                    onChange={e => {
                      const n = Math.floor(parseFloat(e.target.value));
                      if (Number.isFinite(n)) update(line.key, { quantity: Math.max(Math.max(1, line.returnedQty), n) });
                    }}
                    onFocus={e => e.target.select()}
                    aria-label={`Quantity of ${line.name}`}
                    className={cn(numberField, "w-16 text-center")}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Price each</span>
                  <span className="relative">
                    <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">Rs</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      value={line.unitPrice}
                      onChange={e => {
                        const n = parseFloat(e.target.value);
                        update(line.key, { unitPrice: Number.isFinite(n) ? Math.max(0, n) : 0 });
                      }}
                      onFocus={e => e.target.select()}
                      aria-label={`Price of ${line.name}`}
                      className={cn(numberField, "w-28 pl-7")}
                    />
                  </span>
                </label>
                <p className="ml-auto pb-2 text-[13px] font-bold tabular-nums text-foreground">{formatNPR(line.quantity * line.unitPrice)}</p>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Add a product */}
      <div className="relative">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && matches.length > 0) {
              e.preventDefault();
              add(matches[0].id);
            }
          }}
          placeholder={loading ? "Loading products…" : "Add a product: search name or SKU"}
          aria-label="Add a product to the order"
          disabled={loading}
          className="w-full rounded-xl border border-dashed border-border bg-background py-2.5 pl-8 pr-3 text-[13px] focus:border-solid focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </div>
      {query.trim() && (
        <ul className="overflow-hidden rounded-xl border border-border bg-card" aria-label="Matching products">
          {matches.length === 0 && <li className="px-3 py-2.5 text-xs text-muted-foreground">No matching products.</li>}
          {matches.map(p => {
            const stock = p.variants.length > 0 ? p.variants.reduce((n, v) => n + v.quantity, 0) : stockByProduct.get(p.id) ?? 0;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => add(p.id)}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-primary/5"
                >
                  <Package size={14} className="shrink-0 text-primary/70" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{p.name}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{formatNPR(p.sellingPrice)} · {stock} in stock</span>
                  <Plus size={14} className="shrink-0 text-primary" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Totals */}
      <div className="space-y-1.5 rounded-xl bg-muted/40 p-3 text-xs">
        <div className="flex justify-between text-muted-foreground"><span>Items</span><span className="tabular-nums">{formatNPR(goods)}</span></div>
        {pr ? (
          <div className="flex justify-between font-bold text-foreground"><span>PR order</span><span>Free</span></div>
        ) : (<>
          <div className="flex items-center justify-between gap-2 text-muted-foreground">
            <label htmlFor={discountId}>Discount</label>
            <span className="relative">
              <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[11px]">−Rs</span>
              <input
                id={discountId}
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={discount}
                onChange={e => onDiscountChange(e.target.value)}
                onFocus={e => e.target.select()}
                className={cn(numberField, "h-8 w-28 pl-9 text-right")}
              />
            </span>
          </div>
          {discountValue > goods && <p className="text-[11px] font-medium text-red-600">The discount is more than the items are worth.</p>}
          <div className="flex justify-between border-t border-border/60 pt-1.5 text-sm font-extrabold text-foreground">
            <span>Order total <span className="text-[11px] font-medium text-muted-foreground">(before delivery)</span></span>
            <span className="tabular-nums">{formatNPR(Math.max(0, goods - discountValue))}</span>
          </div>
        </>)}
      </div>
    </div>
  );
}
