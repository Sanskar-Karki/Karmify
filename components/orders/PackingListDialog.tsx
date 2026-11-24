"use client";

import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Building2, Check, ChevronRight, ClipboardList, MapPin, MapPinOff, Mountain, Package, Phone, Printer, Zap } from "lucide-react";
import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/shared/Button";
import { Swatch, sortVariants } from "@/components/shared/VariantStock";
import { VALLEY_LABELS, valleyOf, type Valley } from "@/lib/courier";
import { useValleyLocations } from "@/lib/useValleyLocations";
import { codToCollect, deliveryAddress, instantCourierLabel, itemOptions } from "@/lib/orders";
import { cn, formatNPR } from "@/lib/utils";
import type { Sale } from "@/lib/types";

// What to pack for the ticked orders: every product (per size and colour) added
// up across them, and each order's own contents. Units already returned and
// cancelled or returned orders are left out, since nothing goes out for them.

type PickRow = { key: string; size: string; color: string; qty: number; invoices: string[] };
type PickProduct = { productId: string; name: string; sku: string; total: number; rows: PickRow[] };
type PackOrder = { sale: Sale; lines: { id: string; name: string; size: string; color: string; qty: number }[]; pieces: number };

const SKIPPED = new Set(["CANCELLED", "RETURNED"]);

function buildList(orders: Sale[]) {
  const packable = orders.filter(s => !SKIPPED.has(s.deliveryStatus));
  const byKey = new Map<string, PickRow & { productId: string; name: string; sku: string }>();
  const packOrders: PackOrder[] = [];
  for (const sale of packable) {
    const lines: PackOrder["lines"] = [];
    for (const item of sale.items) {
      const qty = item.quantity - (item.returnedQty ?? 0);
      if (qty <= 0) continue;
      const { size, color } = itemOptions(item);
      lines.push({ id: item.id, name: item.product.name, size, color, qty });
      const key = `${item.productId}|${size.toLowerCase()}|${color.toLowerCase()}`;
      const row = byKey.get(key) ?? { key, productId: item.productId, name: item.product.name, sku: item.product.sku, size, color, qty: 0, invoices: [] };
      row.qty += qty;
      if (!row.invoices.includes(sale.invoiceNumber)) row.invoices.push(sale.invoiceNumber);
      byKey.set(key, row);
    }
    if (lines.length) packOrders.push({ sale, lines, pieces: lines.reduce((s, l) => s + l.qty, 0) });
  }
  const products = new Map<string, PickProduct>();
  for (const row of byKey.values()) {
    const p = products.get(row.productId) ?? { productId: row.productId, name: row.name, sku: row.sku, total: 0, rows: [] };
    p.rows.push({ key: row.key, size: row.size, color: row.color, qty: row.qty, invoices: row.invoices });
    p.total += row.qty;
    products.set(row.productId, p);
  }
  const pick = [...products.values()]
    .map(p => ({ ...p, rows: sortVariants(p.rows) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { pick, packOrders, skipped: orders.length - packOrders.length, pieces: pick.reduce((s, p) => s + p.total, 0) };
}

function Options({ size, color }: { size: string; color: string }) {
  if (!size && !color) return <span className="text-xs text-muted-foreground">One size</span>;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {size && (
        <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground">
          Size <span className="font-extrabold text-foreground">{size}</span>
        </span>
      )}
      {color && (
        <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-bold text-foreground">
          <Swatch colour={color} /> {color}
        </span>
      )}
    </span>
  );
}

/** How the order leaves: Yango, Upaya (tracking), COD to collect, or already paid. */
function sendNote(sale: Sale) {
  const via = instantCourierLabel(sale.deliveryVia);
  const parts: string[] = [];
  if (via) parts.push(`Send with ${via}`);
  else if (sale.courierTrackingCode) parts.push(`Upaya ${sale.courierTrackingCode}`);
  const due = codToCollect(sale);
  if (due > 0) parts.push(`Collect ${formatNPR(due)}`);
  else parts.push("Paid");
  return parts.join(" · ");
}

const AREA_CHOICES: { key: Valley; hint: string; icon: typeof MapPin }[] = [
  { key: "inside", hint: "Kathmandu, Lalitpur and Bhaktapur hubs, and Yango", icon: Building2 },
  { key: "outside", hint: "Every other Upaya hub", icon: Mountain },
  { key: "none", hint: "Orders without an Upaya hub location", icon: MapPinOff },
];

export function PackingListDialog({ open, onClose, orders }: { open: boolean; onClose: () => void; orders: Sale[] }) {
  const live = useValleyLocations();
  // Inside and outside the valley go out separately, so each has its own list.
  const byArea = useMemo(() => {
    const groups: Record<Valley, Sale[]> = { inside: [], outside: [], none: [] };
    for (const sale of orders) groups[valleyOf(sale, live)].push(sale);
    return groups;
  }, [orders, live]);
  const [area, setArea] = useState<Valley | "all" | null>(null);
  const chosen = useMemo(() => (area === null ? [] : area === "all" ? orders : byArea[area]), [area, orders, byArea]);
  const { pick, packOrders, skipped, pieces } = useMemo(() => buildList(chosen), [chosen]);
  const areaSummary = useMemo(
    () => Object.fromEntries((Object.keys(byArea) as Valley[]).map(key => {
      const list = buildList(byArea[key]);
      return [key, { orders: list.packOrders.length, pieces: list.pieces }];
    })) as Record<Valley, { orders: number; pieces: number }>,
    [byArea]
  );
  const [view, setView] = useState<"pick" | "orders">("pick");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [packed, setPacked] = useState<Set<string>>(new Set());
  const chooseArea = (next: Valley | "all" | null) => {
    setArea(next);
    setPicked(new Set());
    setPacked(new Set());
  };
  const areaLabel = area === null ? null : area === "all" ? "All areas" : VALLEY_LABELS[area];
  const toggle = (set: Set<string>, key: string, update: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    update(next);
  };
  const pickedUnits = pick.reduce((s, p) => s + p.rows.filter(r => picked.has(r.key)).reduce((t, r) => t + r.qty, 0), 0);
  const allPicked = pieces > 0 && pickedUnits === pieces;

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="xl"
        icon={ClipboardList}
        title={areaLabel ? `Packing list · ${areaLabel}` : "Packing list"}
        description={area === null
          ? `${orders.length} selected order${orders.length === 1 ? "" : "s"}. Choose which area to pack.`
          : `${packOrders.length} order${packOrders.length === 1 ? "" : "s"} · ${pieces} piece${pieces === 1 ? "" : "s"} · ${pick.length} product${pick.length === 1 ? "" : "s"}${skipped ? ` · ${skipped} cancelled/returned left out` : ""}`}
        footer={
          <>
            {area !== null && (
              <Button variant="secondary" onClick={() => chooseArea(null)} className="flex-1 sm:flex-none">
                <ArrowLeft size={15} /> Change area
              </Button>
            )}
            <Button variant="secondary" onClick={onClose} className="flex-1 sm:flex-none">Close</Button>
            {area !== null && (
              <Button onClick={() => window.print()} disabled={pieces === 0} className="flex-1 sm:flex-none sm:ml-auto">
                <Printer size={15} /> Print packing list
              </Button>
            )}
          </>
        }
      >
        {area === null ? (
          <div className="space-y-3 p-4 sm:p-6">
            <div className="grid gap-3 sm:grid-cols-2">
              {AREA_CHOICES.filter(c => c.key !== "none" || byArea.none.length > 0).map(({ key, hint, icon: Icon }) => {
                const sum = areaSummary[key];
                const empty = sum.orders === 0;
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={empty}
                    onClick={() => chooseArea(key)}
                    className={cn(
                      "group flex items-center gap-4 rounded-2xl border p-4 text-left transition-all",
                      empty ? "cursor-not-allowed border-border/60 opacity-50" : "border-border/80 bg-card hover:border-primary/50 hover:bg-primary/5"
                    )}
                  >
                    <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", empty ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary")}>
                      <Icon size={20} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-foreground">{VALLEY_LABELS[key]}</span>
                      <span className="block text-[11px] text-muted-foreground">{hint}</span>
                      <span className="mt-1 block text-xs font-semibold tabular-nums text-foreground">
                        {empty ? "Nothing to pack" : `${sum.orders} order${sum.orders === 1 ? "" : "s"} · ${sum.pieces} piece${sum.pieces === 1 ? "" : "s"}`}
                      </span>
                    </span>
                    {!empty && <ChevronRight size={18} className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />}
                  </button>
                );
              })}
            </div>
            <button type="button" onClick={() => chooseArea("all")} className="text-xs font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
              Or pack all {orders.length} selected order{orders.length === 1 ? "" : "s"} together
            </button>
          </div>
        ) : pieces === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center text-muted-foreground">
            <Package size={28} className="opacity-40" />
            <p className="text-sm font-semibold">Nothing to pack</p>
            <p className="text-xs">The selected orders are cancelled, returned, or already sent back.</p>
          </div>
        ) : (
          <div className="space-y-4 p-4 sm:p-6">
            {/* View switch + progress */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div role="tablist" aria-label="Packing list view" className="inline-flex rounded-xl bg-muted p-1">
                {([["pick", "To pick", pick.length], ["orders", "By order", packOrders.length]] as const).map(([key, label, count]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={view === key}
                    onClick={() => setView(key)}
                    className={cn("rounded-lg px-4 py-1.5 text-xs font-semibold transition-colors", view === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                  >
                    {label} <span className="ml-1 tabular-nums opacity-70">{count}</span>
                  </button>
                ))}
              </div>
              <div className="flex min-w-[200px] flex-1 items-center gap-3 sm:max-w-xs">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div className={cn("h-full rounded-full transition-all", allPicked ? "bg-emerald-500" : "bg-primary")} style={{ width: `${(pickedUnits / pieces) * 100}%` }} />
                </div>
                <span className={cn("whitespace-nowrap text-xs font-semibold tabular-nums", allPicked ? "text-emerald-600" : "text-muted-foreground")}>
                  {allPicked ? "All picked" : `${pickedUnits} of ${pieces} picked`}
                </span>
              </div>
            </div>

            {view === "pick" ? (
              <div className="grid gap-3 md:grid-cols-2">
                {pick.map(p => (
                  <section key={p.productId} className="rounded-2xl border border-border/80 bg-card">
                    <header className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold leading-snug text-foreground">{p.name}</h3>
                        <p className="font-mono text-[11px] text-muted-foreground">{p.sku}</p>
                      </div>
                      <span className="shrink-0 rounded-lg bg-primary/10 px-2.5 py-1 text-sm font-extrabold tabular-nums text-primary">×{p.total}</span>
                    </header>
                    <ul className="divide-y divide-border/50">
                      {p.rows.map(r => {
                        const done = picked.has(r.key);
                        return (
                          <li key={r.key}>
                            <label className={cn("flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/40", done && "bg-emerald-50/60 dark:bg-emerald-950/20")}>
                              <input type="checkbox" checked={done} onChange={() => toggle(picked, r.key, setPicked)} className="h-4 w-4 shrink-0 accent-emerald-600" aria-label={`Picked ${p.name} ${[r.size, r.color].filter(Boolean).join(" ")}`} />
                              <div className={cn("min-w-0 flex-1 space-y-1", done && "opacity-50")}>
                                <Options size={r.size} color={r.color} />
                                <p className="truncate text-[11px] text-muted-foreground" title={r.invoices.join(", ")}>
                                  For {r.invoices.length === 1 ? r.invoices[0] : `${r.invoices.length} orders`}
                                </p>
                              </div>
                              <span className={cn("shrink-0 text-xl font-black tabular-nums", done ? "text-emerald-600 line-through" : "text-foreground")}>{r.qty}</span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {packOrders.map(({ sale, lines, pieces: n }) => {
                  const done = packed.has(sale.id);
                  const address = deliveryAddress(sale.customerAddress);
                  return (
                    <section key={sale.id} className={cn("rounded-2xl border bg-card transition-colors", done ? "border-emerald-300 dark:border-emerald-800" : "border-border/80")}>
                      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
                        <div className="min-w-0 space-y-0.5">
                          <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-foreground">
                            <span className="font-mono">{sale.invoiceNumber}</span>
                            <span className="font-semibold">· {sale.customerName || "Walk-in Customer"}</span>
                            {sale.customer?.code && <span className="font-mono text-[11px] font-normal text-muted-foreground">{sale.customer.code}</span>}
                          </p>
                          {sale.customerPhone && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Phone size={11} /> {sale.customerPhone}{sale.customerAltPhone && ` · alt ${sale.customerAltPhone}`}</p>}
                          {address && <p className="flex items-start gap-1.5 text-xs text-muted-foreground"><MapPin size={11} className="mt-0.5 shrink-0" /> <span className="break-words">{address}</span></p>}
                          {sale.courierAreaTitle && !sale.deliveryVia && <p className="text-xs text-muted-foreground">Hub: <span className="font-semibold text-foreground">{sale.courierAreaTitle}</span></p>}
                          <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">{sale.deliveryVia && <Zap size={11} />}{sendNote(sale)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggle(packed, sale.id, setPacked)}
                          aria-pressed={done}
                          className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors", done ? "border-emerald-500 bg-emerald-500 text-white" : "border-border hover:bg-muted")}
                        >
                          <Check size={13} /> {done ? "Packed" : `Mark packed · ${n} pc${n === 1 ? "" : "s"}`}
                        </button>
                      </header>
                      <ul className={cn("divide-y divide-border/50", done && "opacity-50")}>
                        {lines.map(l => (
                          <li key={l.id} className="flex items-center gap-3 px-4 py-2.5">
                            <span className="w-8 shrink-0 text-lg font-black tabular-nums text-foreground">{l.qty}×</span>
                            <div className="min-w-0 flex-1 space-y-1">
                              <p className="text-sm font-semibold text-foreground">{l.name}</p>
                              <Options size={l.size} color={l.color} />
                            </div>
                          </li>
                        ))}
                      </ul>
                      {sale.notes && <p className="border-t border-border/60 px-4 py-2 text-xs text-muted-foreground">Note: {sale.notes}</p>}
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Printed copy: plain black on white, picking table first, then one block per order. */}
      {open && area !== null && pieces > 0 && typeof document !== "undefined" && createPortal(
        <div className="packing-print-root" style={{ fontFamily: "Arial, sans-serif", color: "#000", padding: "10mm", fontSize: "10pt" }}>
          <style>{"@media print { @page { size: A4; margin: 0; } }"}</style>
          <h1 style={{ fontSize: "16pt", margin: "0 0 2mm" }}>Packing list{areaLabel ? ` · ${areaLabel}` : ""}</h1>
          <p style={{ margin: "0 0 5mm" }}>{packOrders.length} orders · {pieces} pieces · {new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</p>
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "8mm" }}>
            <thead>
              <tr>{["✓", "Product", "Size", "Colour", "Qty", "Orders"].map(h => <th key={h} style={{ textAlign: "left", borderBottom: "1.5pt solid #000", padding: "2mm 1.5mm" }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {pick.flatMap(p => p.rows.map(r => (
                <tr key={r.key}>
                  <td style={{ borderBottom: "0.5pt solid #999", padding: "2mm 1.5mm", width: "8mm" }}>☐</td>
                  <td style={{ borderBottom: "0.5pt solid #999", padding: "2mm 1.5mm", fontWeight: 700 }}>{p.name}</td>
                  <td style={{ borderBottom: "0.5pt solid #999", padding: "2mm 1.5mm" }}>{r.size || "—"}</td>
                  <td style={{ borderBottom: "0.5pt solid #999", padding: "2mm 1.5mm" }}>{r.color || "—"}</td>
                  <td style={{ borderBottom: "0.5pt solid #999", padding: "2mm 1.5mm", fontWeight: 800, fontSize: "12pt" }}>{r.qty}</td>
                  <td style={{ borderBottom: "0.5pt solid #999", padding: "2mm 1.5mm", fontSize: "8.5pt" }}>{r.invoices.join(", ")}</td>
                </tr>
              )))}
            </tbody>
          </table>
          {packOrders.map(({ sale, lines }) => (
            <div key={sale.id} style={{ border: "1pt solid #000", borderRadius: "2mm", padding: "3mm", marginBottom: "4mm", breakInside: "avoid" }}>
              <p style={{ margin: 0, fontWeight: 700 }}>☐ {sale.invoiceNumber} · {sale.customerName || "Walk-in Customer"}{sale.customerPhone ? ` · ${sale.customerPhone}` : ""}{sale.customerAltPhone ? ` / ${sale.customerAltPhone}` : ""}</p>
              {deliveryAddress(sale.customerAddress) && <p style={{ margin: "1mm 0 0" }}>{deliveryAddress(sale.customerAddress)}</p>}
              {sale.courierAreaTitle && !sale.deliveryVia && <p style={{ margin: "1mm 0 0" }}>Hub: {sale.courierAreaTitle}</p>}
              <p style={{ margin: "1mm 0 2mm", fontWeight: 700 }}>{sendNote(sale)}</p>
              {lines.map(l => <p key={l.id} style={{ margin: "0.8mm 0" }}><b>{l.qty}×</b> {l.name}{l.size || l.color ? ` — ${[l.size && `Size ${l.size}`, l.color].filter(Boolean).join(", ")}` : ""}</p>)}
              {sale.notes && <p style={{ margin: "2mm 0 0", fontStyle: "italic" }}>Note: {sale.notes}</p>}
            </div>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}
