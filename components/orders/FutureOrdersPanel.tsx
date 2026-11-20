"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ArrowUpToLine, CalendarClock, CalendarDays, ChevronDown, Gift, Hourglass, MapPin, Phone, Store, Trash2, Truck } from "lucide-react";
import { deleteFutureOrder, listFutureOrders, moveFutureOrder } from "@/app/actions";
import { Button } from "@/components/shared/Button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { daysUntil, dueLabel, nepalToday, sendOnLabel } from "@/lib/futureOrders";
import { mutate } from "@/lib/mutate";
import { deliveryAddress } from "@/lib/orders";
import { cn, formatNPR } from "@/lib/utils";
import type { ActionResult } from "@/lib/types";

type FutureList = Awaited<ReturnType<typeof listFutureOrders>> extends ActionResult<infer T> ? T : never;
type Future = FutureList extends (infer R)[] ? R : never;

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

/**
 * Orders taken now and sent later, and not counted as sales until "Move to
 * orders" creates the real order (at the top of the orders table). Two kinds:
 * waiting for stock (what was in stock is set aside, the rest waits), and sent
 * on the customer's date (all its stock set aside when it was saved).
 */
export function FutureOrdersPanel({ startOpen, onMoved }: { startOpen: boolean; onMoved: () => Promise<unknown> | void }) {
  const [rows, setRows] = useState<Future[] | null>(null);
  const [open, setOpen] = useState(startOpen);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Future | null>(null);

  const load = useCallback(async () => {
    const result = await listFutureOrders();
    setRows(result.ok ? result.data : []);
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function move(row: Future) {
    setBusy(row.id);
    const result = await mutate(() => moveFutureOrder(row.id), {
      success: sale => `Order ${sale.invoiceNumber} created for ${sale.customerName ?? "the customer"}. It's at the top of the orders.`,
    });
    setBusy(null);
    if (result.ok) await Promise.all([load(), onMoved()]);
    else await load(); // stock may have changed since the list loaded
  }

  async function remove(row: Future) {
    setBusy(row.id);
    const result = await mutate(() => deleteFutureOrder(row.id), {
      success: r => `Future order for ${r.customerName ?? "the customer"} deleted.${r.putBack ? ` ${r.putBack} item${r.putBack === 1 ? " is" : "s are"} back in stock.` : ""}`,
    });
    setBusy(null);
    if (result.ok) {
      setDeleting(null);
      await load();
    }
  }

  // Nothing waiting: the section stays out of the way unless it was asked for.
  if (rows === null || (rows.length === 0 && !startOpen)) return null;
  const today = nepalToday();
  const dated = rows.filter(r => r.sendOn);
  const dueNow = dated.filter(r => daysUntil(r.sendOn!, today) <= 0).length;
  const later = dated.length - dueNow;
  const restock = rows.filter(r => !r.sendOn);
  const ready = restock.filter(r => r.ready).length;
  const waiting = restock.length - ready;
  const summary = [
    dueNow > 0 && { text: `${dueNow} due to send`, tone: "font-semibold text-amber-800 dark:text-amber-300" },
    ready > 0 && { text: `${ready} ready to send`, tone: "font-semibold text-emerald-700 dark:text-emerald-400" },
    later > 0 && { text: `${later} on a later date`, tone: "" },
    waiting > 0 && { text: `${waiting} waiting for stock`, tone: "" },
  ].filter((part): part is { text: string; tone: string } => Boolean(part));

  return (
    <section className="shrink-0 rounded-2xl border border-amber-200/80 bg-amber-50/40 dark:border-amber-900/40 dark:bg-amber-950/10" aria-label="Future orders">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left"
      >
        <CalendarClock size={15} className="shrink-0 text-amber-700 dark:text-amber-400" />
        <span className="text-[13px] font-bold text-foreground">Future orders</span>
        <span className="rounded-full bg-amber-200/70 px-2 py-0.5 text-[11px] font-extrabold tabular-nums text-amber-900 dark:bg-amber-900/50 dark:text-amber-100">{rows.length}</span>
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {rows.length === 0
            ? "None waiting. Tick “Future order” in the POS to add one."
            : summary.map((part, i) => (
                <React.Fragment key={part.text}>
                  {i > 0 && " · "}
                  <span className={part.tone}>{part.text}</span>
                </React.Fragment>
              ))}
        </span>
        <ChevronDown size={15} className={cn("ml-auto shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && rows.length > 0 && (
        <ul className="max-h-[40vh] divide-y divide-amber-200/60 overflow-y-auto border-t border-amber-200/60 dark:divide-amber-900/40 dark:border-amber-900/40">
          {rows.map(row => {
            const mode = MODES[row.mode] ?? MODES.delivery;
            const address = row.address ? deliveryAddress(row.address) : "";
            return (
              <li key={row.id} className="flex flex-wrap items-start gap-3 px-4 py-3 sm:flex-nowrap">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold text-foreground">
                    {row.customerName || "Customer"}
                    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                      <mode.icon size={10} /> {mode.label}
                    </span>
                    {row.sendOn ? (
                      <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold", dueTone(row.sendOn, today))}>
                        <CalendarDays size={11} /> Send on {sendOnLabel(row.sendOn, today)} · {dueLabel(row.sendOn, today)}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                        <Hourglass size={11} /> Waiting for stock
                      </span>
                    )}
                    <span className="text-[11px] font-medium text-muted-foreground">saved {ago(row.createdAt)}</span>
                  </p>
                  {(row.customerPhone || address) && (
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      {row.customerPhone && <span className="inline-flex items-center gap-1"><Phone size={11} />{row.customerPhone}</span>}
                      {address && <span className="inline-flex min-w-0 items-center gap-1"><MapPin size={11} className="shrink-0" /><span className="truncate">{address}</span></span>}
                    </p>
                  )}
                  <ul className="flex flex-wrap gap-1.5">
                    {row.lines.map((line, i) => (
                      <li
                        key={i}
                        title={lineStatus(line).title}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-medium",
                          line.gone
                            ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200"
                            : line.ready
                              ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-100"
                              : "border-amber-200 bg-card text-foreground dark:border-amber-900/50"
                        )}
                      >
                        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", line.gone ? "bg-red-500" : line.ready ? "bg-emerald-500" : "bg-amber-500")} aria-hidden />
                        {line.quantity}× {line.name}{line.variantLabel && ` (${line.variantLabel})`}
                        <span className="text-muted-foreground">{lineStatus(line).text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <div className="text-right">
                    <p className="text-sm font-extrabold tabular-nums text-foreground">{row.mode === "pr" ? "Free (PR)" : formatNPR(row.totalAmount)}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {row.mode === "delivery"
                        ? [row.advance > 0 && `${formatNPR(row.advance)} paid`, row.codAmount > 0 ? `COD ${formatNPR(row.codAmount)}` : row.paymentMethod === "QR" ? "paid in full" : null].filter(Boolean).join(" · ")
                        : row.mode === "walkin" ? row.paymentMethod === "QR" ? "QR" : "Cash" : null}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => void move(row)}
                      loading={busy === row.id && !deleting}
                      disabled={busy !== null || !row.ready}
                      title={
                        row.lines.some(l => l.gone)
                          ? "An item was removed from the catalog"
                          : !row.ready
                            ? "Restock the items marked in amber first"
                            : row.lines.every(l => l.setAside === l.quantity)
                              ? "Create the order now. Its stock is already set aside."
                              : row.setAside > 0
                                ? "Create the order now: it keeps the stock set aside and takes the rest"
                                : "Create the order now and take its stock"
                      }
                      className="px-3 py-1.5 text-xs rounded-lg whitespace-nowrap"
                    >
                      <ArrowUpToLine size={13} /> Move to orders
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setDeleting(row)}
                      disabled={busy !== null}
                      aria-label={`Delete the future order for ${row.customerName ?? "this customer"}`}
                      className="px-2.5 py-1.5 text-xs rounded-lg"
                    >
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

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
    </section>
  );
}
