"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpToLine, CalendarClock, CalendarDays, Gift, Hourglass, Pencil, Search, Store, Trash2, Truck } from "lucide-react";
import { deleteFutureOrder, listFutureOrders, moveFutureOrder } from "@/app/actions";
import { Button } from "@/components/shared/Button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { Pulse } from "@/components/shared/Pulse";
import { FutureOrderEditDialog } from "@/components/orders/FutureOrderEditDialog";
import { daysUntil, dueLabel, nepalToday, sendOnLabel } from "@/lib/futureOrders";
import { mutate } from "@/lib/mutate";
import { deliveryAddress } from "@/lib/orders";
import { cn, formatNPR } from "@/lib/utils";
import type { ActionResult } from "@/lib/types";

type FutureList = Awaited<ReturnType<typeof listFutureOrders>> extends ActionResult<infer T> ? T : never;
export type Future = FutureList extends (infer R)[] ? R : never;

const MODES = {
  delivery: { label: "Delivery", icon: Truck },
  walkin: { label: "Walk-in", icon: Store },
  pr: { label: "PR", icon: Gift },
} as const;

const ago = (d: Date | string) => {
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  return days === 1 ? "yesterday" : `${days} days ago`;
};

/** How a scheduled order's date reads: late in red, due today in amber, later in grey. */
function dueTone(sendOn: string, today: string) {
  const days = daysUntil(sendOn, today);
  if (days < 0) return "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200";
  if (days === 0) return "border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-800/60 dark:bg-amber-900/40 dark:text-amber-100";
  return "border-border bg-card text-foreground";
}

/** What a line says about its stock: set aside, waiting, or on the shelf. */
function lineStatus(line: Future["lines"][number]) {
  if (line.gone) return { text: "· removed", title: "This product or size was removed from the catalog" };
  if (line.setAside === line.quantity) return { text: "· set aside", title: "Taken out of stock and kept for this customer" };
  const rest = line.quantity - line.setAside;
  const shelf = line.ready ? "in stock" : `${line.inStock} in stock`;
  if (line.setAside > 0) {
    return {
      text: `· ${line.setAside} set aside · ${line.ready ? `${rest} in stock` : `${rest} waiting`}`,
      title: `${line.setAside} kept for this customer; ${rest} more ${line.ready ? "is on the shelf now" : `needed (${shelf})`}`,
    };
  }
  return { text: `· ${shelf}`, title: line.ready ? `${line.inStock} in stock` : `Only ${line.inStock} in stock` };
}

/** What's paid and what's left, under the total. */
function paymentLine(row: Future) {
  if (row.mode === "delivery") {
    return [row.advance > 0 && `${formatNPR(row.advance)} paid`, row.codAmount > 0 ? `COD ${formatNPR(row.codAmount)}` : row.paymentMethod === "QR" ? "paid in full" : null]
      .filter(Boolean).join(" · ");
  }
  if (row.mode === "walkin") return row.paymentMethod === "QR" ? "QR" : "Cash";
  return "";
}

/** The future orders, loaded once and again after each change. `null` while the first load runs. */
export function useFutureOrders() {
  const [rows, setRows] = useState<Future[] | null>(null);
  const reload = useCallback(async () => {
    const result = await listFutureOrders();
    setRows(result.ok ? result.data : []);
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => void reload(), 0);
    return () => clearTimeout(timer);
  }, [reload]);
  return { rows, reload };
}

/** How many are due, ready, on a later date, and still waiting for stock. */
export function futureCounts(rows: Future[]) {
  const today = nepalToday();
  const dated = rows.filter(r => r.sendOn);
  const dueNow = dated.filter(r => daysUntil(r.sendOn!, today) <= 0).length;
  const restock = rows.filter(r => !r.sendOn);
  const ready = restock.filter(r => r.ready).length;
  return {
    dueNow,
    ready,
    later: dated.length - dueNow,
    waiting: restock.length - ready,
    // PR orders are given free, so they add nothing.
    value: rows.reduce((total, r) => total + (r.mode === "pr" ? 0 : r.totalAmount), 0),
  };
}

const phoneDigits = (v: string) => v.replace(/\D/g, "").replace(/^977(?=\d{10}$)/, "");

/** The orders search, for future orders: every word must appear in the name, phones, address or items. */
function futureMatcher(search: string): (row: Future) => boolean {
  const words = search.replace(/(^|\s)\+?977[\s-]+(?=\d)/g, "$1").toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return () => true;
  return row => {
    const text = [
      row.customerName, row.customerPhone, phoneDigits(row.customerPhone ?? ""), row.customerAltPhone, phoneDigits(row.customerAltPhone ?? ""),
      row.address, row.courierArea?.title, ...row.lines.map(l => [l.name, l.variantLabel].filter(Boolean).join(" ")),
    ].filter(Boolean).join(" ").toLowerCase();
    return words.every(w => {
      if (text.includes(w)) return true;
      const digits = /^[\d+\-()]+$/.test(w) ? phoneDigits(w) : "";
      return digits.length >= 3 && text.includes(digits);
    });
  };
}

/** The send date badge, or "Waiting for stock". */
function SendCell({ row, today }: { row: Future; today: string }) {
  if (row.sendOn) {
    return (
      <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap", dueTone(row.sendOn, today))}>
        <CalendarDays size={11} /> {sendOnLabel(row.sendOn, today)} · {dueLabel(row.sendOn, today)}
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] font-semibold whitespace-nowrap", row.ready ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>
      <Hourglass size={11} /> {row.ready ? "Ready to send" : "Waiting for stock"}
    </span>
  );
}

function ModeChip({ row }: { row: Future }) {
  const mode = MODES[row.mode] ?? MODES.delivery;
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
      <mode.icon size={10} /> {mode.label}
    </span>
  );
}

function ItemChips({ row }: { row: Future }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {row.lines.map((line, i) => (
        <li
          key={i}
          title={lineStatus(line).title}
          className={cn(
            "flex items-start gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-medium",
            line.gone
              ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200"
              : line.ready
                ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-100"
                : "border-amber-200 bg-card text-foreground dark:border-amber-900/50"
          )}
        >
          <span className={cn("mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full", line.gone ? "bg-red-500" : line.ready ? "bg-emerald-500" : "bg-amber-500")} aria-hidden />
          {/* One run of text, so a long name wraps as a sentence rather than in two columns. */}
          <span>
            {line.quantity}× {line.name}{line.variantLabel && ` (${line.variantLabel})`}{" "}
            <span className="text-muted-foreground">{lineStatus(line).text}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

const moveTitle = (row: Future) =>
  row.lines.some(l => l.gone)
    ? "An item was removed from the catalog"
    : !row.ready
      ? "Restock the items marked in amber first"
      : row.lines.every(l => l.setAside === l.quantity)
        ? "Create the order now. Its stock is already set aside."
        : row.setAside > 0
          ? "Create the order now: it keeps the stock set aside and takes the rest"
          : "Create the order now and take its stock";

// The same look as the orders table: opaque sticky column names.
const stickyTh = "sticky top-0 z-10 bg-muted shadow-[inset_0_-1px_0_hsl(var(--border))]";
const th = cn(stickyTh, "text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground px-5 py-3");
const iconButton = "w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-60 disabled:cursor-not-allowed";
const phoneIconButton = "w-9 h-9 flex items-center justify-center rounded-lg border border-border bg-background hover:bg-muted active:scale-95 transition disabled:opacity-60";

/**
 * Orders taken now and sent later, shown in the Customers & Orders table in
 * place of the orders. They aren't sales until "Move to orders" creates the
 * real order (at the top of the orders). Two kinds: waiting for stock (what
 * was in stock is set aside, the rest waits), and sent on the customer's date
 * (all its stock set aside when it was saved).
 */
export function FutureOrdersTable({ rows, reload, search, onMoved }: {
  rows: Future[] | null;
  reload: () => Promise<void>;
  search: string;
  onMoved: () => Promise<unknown> | void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Future | null>(null);
  const [editing, setEditing] = useState<Future | null>(null);
  const shown = useMemo(() => (rows ? rows.filter(futureMatcher(search)) : []), [rows, search]);
  const today = nepalToday();

  async function move(row: Future) {
    setBusy(row.id);
    const result = await mutate(() => moveFutureOrder(row.id), {
      success: sale => `Order ${sale.invoiceNumber} created for ${sale.customerName ?? "the customer"}. It's at the top of the orders.`,
    });
    setBusy(null);
    if (result.ok) await Promise.all([reload(), onMoved()]);
    else await reload(); // stock may have changed since the list loaded
  }

  async function remove(row: Future) {
    setBusy(row.id);
    const result = await mutate(() => deleteFutureOrder(row.id), {
      success: r => `Future order for ${r.customerName ?? "the customer"} deleted.${r.putBack ? ` ${r.putBack} item${r.putBack === 1 ? " is" : "s are"} back in stock.` : ""}`,
    });
    setBusy(null);
    if (result.ok) {
      setDeleting(null);
      await reload();
    }
  }

  const name = (row: Future) => row.customerName || "Customer";
  const total = (row: Future) => (row.mode === "pr" ? "Free (PR)" : formatNPR(row.totalAmount));

  return (
    <>
      {/* Phones: one card per future order */}
      <div className="md:hidden">
        {rows === null && (
          <div className="divide-y divide-border/40" aria-hidden>
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="space-y-2 px-3.5 py-3.5">
                <Pulse className="h-4 w-1/2" />
                <Pulse className="h-3.5 w-3/4" />
                <Pulse className="h-7 w-2/3" />
              </div>
            ))}
          </div>
        )}
        <ul className="divide-y divide-border/40">
          {shown.map(row => {
            const address = row.address ? deliveryAddress(row.address) : "";
            return (
              <li key={row.id} className="space-y-2 px-3.5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold text-foreground">
                      {name(row)} <ModeChip row={row} />
                    </p>
                    {row.customerPhone && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        <a href={`tel:${row.customerPhone}`} className="font-semibold text-foreground/80 underline-offset-2 hover:underline">{row.customerPhone}</a>
                        {row.customerAltPhone && ` · alt ${row.customerAltPhone}`}
                      </p>
                    )}
                    {address && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{address}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-bold tabular-nums">{total(row)}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{paymentLine(row) || `saved ${ago(row.createdAt)}`}</p>
                  </div>
                </div>
                <SendCell row={row} today={today} />
                <ItemChips row={row} />
                <div className="flex items-center justify-between gap-2 pt-0.5">
                  <span className="text-[11px] text-muted-foreground">saved {ago(row.createdAt)}</span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button type="button" onClick={() => setEditing(row)} disabled={busy !== null} aria-label={`Edit the future order for ${name(row)}`} className={phoneIconButton}>
                      <Pencil size={15} />
                    </button>
                    <button type="button" onClick={() => setDeleting(row)} disabled={busy !== null} aria-label={`Delete the future order for ${name(row)}`} className={phoneIconButton}>
                      <Trash2 size={15} />
                    </button>
                    <Button
                      onClick={() => void move(row)}
                      loading={busy === row.id && !deleting}
                      disabled={busy !== null || !row.ready}
                      title={moveTitle(row)}
                      className="h-9 rounded-lg px-3 text-xs whitespace-nowrap"
                    >
                      <ArrowUpToLine size={14} /> Move to orders
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Tablet and up: a table like the orders one */}
      <table className="hidden w-full text-sm md:table">
        <thead>
          <tr>
            <th className={cn(th, "hidden lg:table-cell w-12")}>SN</th>
            <th className={cn(th, "hidden lg:table-cell")}>Saved</th>
            <th className={th}>Customer</th>
            <th className={cn(th, "hidden lg:table-cell")}>Phone</th>
            <th className={th}>Items</th>
            <th className={cn(th, "hidden lg:table-cell")}>Send</th>
            <th className={cn(th, "text-right")}>Total</th>
            <th className={cn(th, "text-right")}>Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {rows === null && Array.from({ length: 4 }, (_, i) => (
            <tr key={i} aria-hidden="true">
              <td className="px-5 py-3.5 hidden lg:table-cell"><Pulse className="h-3 w-4" /></td>
              <td className="px-5 py-3.5 hidden lg:table-cell"><Pulse className="h-3 w-16" /></td>
              <td className="px-5 py-3.5"><Pulse className="h-3 w-24" /></td>
              <td className="px-5 py-3.5 hidden lg:table-cell"><Pulse className="h-3 w-20" /></td>
              <td className="px-5 py-3.5"><Pulse className="h-6 w-40 rounded-lg" /></td>
              <td className="px-5 py-3.5 hidden lg:table-cell"><Pulse className="h-5 w-24 rounded-md" /></td>
              <td className="px-5 py-3.5"><Pulse className="ml-auto h-3 w-16" /></td>
              <td className="px-5 py-3.5"><Pulse className="ml-auto h-8 w-36 rounded-lg" /></td>
            </tr>
          ))}
          {shown.map((row, i) => {
            const address = row.address ? deliveryAddress(row.address) : "";
            return (
              <tr key={row.id} className="align-top">
                <td className="px-5 py-3.5 text-xs text-muted-foreground font-medium hidden lg:table-cell">{i + 1}</td>
                <td className="px-5 py-3.5 text-xs text-muted-foreground font-medium whitespace-nowrap hidden lg:table-cell">
                  {new Date(row.createdAt).toLocaleDateString()}
                  <span className="block text-[11px] font-normal">{ago(row.createdAt)}</span>
                </td>
                <td className="px-5 py-3.5 text-xs font-semibold">
                  {name(row)}
                  <p className="mt-1"><ModeChip row={row} /></p>
                  <p className="mt-1 text-[11px] font-normal text-muted-foreground lg:hidden">
                    {row.customerPhone || "—"}{row.customerAltPhone && ` · alt ${row.customerAltPhone}`}
                  </p>
                  <p className="mt-0.5 text-[11px] font-normal text-muted-foreground lg:hidden">saved {ago(row.createdAt)}</p>
                  {/* Below laptop width the send date sits here instead of its own column. */}
                  <p className="mt-1.5 lg:hidden"><SendCell row={row} today={today} /></p>
                </td>
                <td className="px-5 py-3.5 text-xs hidden lg:table-cell">
                  <span className={cn(!row.customerPhone && "text-muted-foreground italic")}>{row.customerPhone || "—"}</span>
                  {row.customerAltPhone && <p className="mt-0.5 text-[11px] text-muted-foreground" title="Alternative number">alt {row.customerAltPhone}</p>}
                  {address && <p className="mt-0.5 max-w-[160px] truncate text-[11px] text-muted-foreground" title={address}>{address}</p>}
                  {row.courierArea?.title && <p className="mt-0.5 max-w-[160px] truncate text-[11px] text-muted-foreground" title={row.courierArea.title}>Hub: {row.courierArea.title}</p>}
                </td>
                <td className="px-5 py-3.5 min-w-[12rem]"><ItemChips row={row} /></td>
                <td className="px-5 py-3.5 hidden lg:table-cell"><SendCell row={row} today={today} /></td>
                <td className="px-5 py-3.5 text-right">
                  <span className="block text-xs font-extrabold tabular-nums whitespace-nowrap">{total(row)}</span>
                  {paymentLine(row) && <span className="block text-[11px] text-muted-foreground">{paymentLine(row)}</span>}
                </td>
                <td className="px-5 py-3.5">
                  <div className="flex items-center justify-end gap-1.5">
                    <Button
                      onClick={() => void move(row)}
                      loading={busy === row.id && !deleting}
                      disabled={busy !== null || !row.ready}
                      title={moveTitle(row)}
                      className="h-8 rounded-lg px-2.5 text-xs whitespace-nowrap"
                    >
                      <ArrowUpToLine size={13} /> Move to orders
                    </Button>
                    <button type="button" onClick={() => setEditing(row)} disabled={busy !== null} aria-label={`Edit the future order for ${name(row)}`} title="Edit the customer, items, date or delivery" className={iconButton}>
                      <Pencil size={12} />
                    </button>
                    <button type="button" onClick={() => setDeleting(row)} disabled={busy !== null} aria-label={`Delete the future order for ${name(row)}`} title="Delete" className={iconButton}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {rows !== null && shown.length === 0 && (
        rows.length === 0 ? (
          <EmptyState icon={CalendarClock} title="No future orders" description="Tick “Future order” in the POS to save an order that's sent later." />
        ) : (
          <EmptyState icon={Search} title="No matching future orders" description="Try another name, phone or item." />
        )
      )}

      {editing && <FutureOrderEditDialog key={editing.id} row={editing} onClose={() => setEditing(null)} onSaved={reload} />}

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => (deleting ? remove(deleting) : undefined)}
        title={`Delete the future order for ${deleting?.customerName ?? "this customer"}?`}
        description={
          deleting?.setAside
            ? `Use this when it won't be sent (the customer cancelled, say). The ${deleting.setAside} item${deleting.setAside === 1 ? "" : "s"} set aside for it go${deleting.setAside === 1 ? "es" : ""} back into stock.`
            : "Use this when it won't be sent (the customer cancelled, say). It never took any stock, so nothing else changes."
        }
        confirmLabel="Delete future order"
      />
    </>
  );
}
