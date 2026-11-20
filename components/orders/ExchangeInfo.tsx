"use client";

import React, { useState } from "react";
import { ArrowLeftRight, CheckCircle2, PackageCheck } from "lucide-react";
import { markExchangeReceived } from "@/app/actions";
import { Button } from "@/components/shared/Button";
import { Modal } from "@/components/shared/Modal";
import { exchangeLineName, exchangeOf } from "@/lib/exchange";
import { mutate } from "@/lib/mutate";
import { cn, formatNPR } from "@/lib/utils";
import type { Sale } from "@/lib/types";

// The exchange side of an order (lib/exchange.ts): a badge for lists, the box on
// an exchange order that tracks the old items coming back, and the note on the
// original order saying where its items went.

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

/** "Exchange" pill: amber while the old items are on their way back, green once they're in. */
export function ExchangeBadge({ sale, className }: { sale: Sale; className?: string }) {
  const exchange = exchangeOf(sale);
  if (!exchange) return null;
  const waiting = !exchange.receivedAt && sale.deliveryStatus !== "CANCELLED";
  return (
    <span
      title={waiting ? `Exchange for ${exchange.ofInvoice}: the old items aren't back yet` : `Exchange for ${exchange.ofInvoice}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-extrabold uppercase",
        waiting
          ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
          : "bg-teal-100 text-teal-800 dark:bg-teal-950/40 dark:text-teal-300",
        className,
      )}
    >
      <ArrowLeftRight size={10} /> Exchange{waiting ? " · item due back" : ""}
    </span>
  );
}

/**
 * On an exchange order: what the customer is sending back, its credit, and the
 * "Mark received" tick that puts it back in stock (counted on the original order).
 */
export function ExchangeReturnBox({ sale, onChanged }: { sale: Sale; onChanged: () => Promise<unknown> | void }) {
  const exchange = exchangeOf(sale);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  if (!exchange) return null;
  const units = exchange.items.reduce((n, l) => n + l.quantity, 0);
  const cancelled = sale.deliveryStatus === "CANCELLED";

  async function receive() {
    setSaving(true);
    const result = await mutate(() => markExchangeReceived(sale.id), {
      success: r => r.restocked === r.units
        ? `Old item${r.units === 1 ? "" : "s"} from ${r.invoiceNumber} back in stock.`
        : `Marked received. ${r.restocked} of ${r.units} went back in stock (the rest never left stock).`,
    });
    setSaving(false);
    if (result.ok) {
      setConfirming(false);
      await onChanged();
    }
  }

  return (
    <section
      aria-label={`Exchange for ${exchange.ofInvoice}`}
      className={cn(
        "border-t px-4 py-3 sm:px-5",
        exchange.receivedAt || cancelled ? "border-border/50" : "border-amber-200 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/15",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1 text-xs">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <ArrowLeftRight size={12} /> Exchange for {exchange.ofInvoice}
          </p>
          <p className="text-foreground">
            Coming back: {exchange.items.map(l => `${l.quantity} × ${exchangeLineName(l)}`).join(", ")}
            <span className="text-muted-foreground"> · credit {formatNPR(exchange.credit)}</span>
          </p>
          {exchange.receivedAt ? (
            <p className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 size={12} /> Received {day(exchange.receivedAt)} · back in stock
            </p>
          ) : cancelled ? (
            <p className="text-muted-foreground">This exchange was cancelled, so nothing is coming back.</p>
          ) : (
            <p className="font-medium text-amber-800 dark:text-amber-300">Not back yet. Tick it received when the rider brings it in.</p>
          )}
        </div>
        {!exchange.receivedAt && !cancelled && (
          <Button onClick={() => setConfirming(true)} className="shrink-0 rounded-lg px-3 py-1.5 text-xs">
            <PackageCheck size={13} /> Mark received
          </Button>
        )}
      </div>
      <Modal open={confirming} onClose={() => setConfirming(false)} title={`Got the old item${units === 1 ? "" : "s"} back?`} size="sm" busy={saving} hideHeader>
        <div className="space-y-5 p-5 sm:p-6" style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}>
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              <PackageCheck size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-bold text-foreground">Got the old item{units === 1 ? "" : "s"} back?</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {exchange.items.map(l => `${l.quantity} × ${exchangeLineName(l)}`).join(", ")} go{units === 1 ? "es" : ""} back into stock and {units === 1 ? "is" : "are"} counted as returned on {exchange.ofInvoice}. That order stays a paid sale.
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={saving} className="flex-1" data-autofocus>Cancel</Button>
            <Button onClick={() => void receive()} loading={saving} className="flex-1">Yes, back in stock</Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

/** On an original order (inside its items list): which items were swapped, in which exchange, and whether they're back. */
export function ExchangedNote({ sale, related }: { sale: Sale; related: Sale[] }) {
  const swaps = related.filter(o => exchangeOf(o)?.ofSaleId === sale.id && o.deliveryStatus !== "CANCELLED");
  if (swaps.length === 0) return null;
  return (
    <li className="space-y-1 border-t border-border/50 pt-2 text-[11px]">
      {swaps.map(o => {
        const e = exchangeOf(o)!;
        return (
          <p key={o.id} className="flex flex-wrap items-center gap-x-1.5 text-muted-foreground">
            <ArrowLeftRight size={11} className="shrink-0" />
            <span>
              Exchanged {e.items.map(l => `${l.quantity} × ${exchangeLineName(l)}`).join(", ")} in <span className="font-mono font-semibold text-foreground">{o.invoiceNumber}</span>
              {e.receivedAt ? ` · back ${day(e.receivedAt)}` : " · not back yet"}
            </span>
          </p>
        );
      })}
    </li>
  );
}
