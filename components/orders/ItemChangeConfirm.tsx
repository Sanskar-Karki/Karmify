"use client";

import React, { useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/shared/Button";
import type { StockChange } from "@/components/orders/OrderItemsEditor";
import { cn } from "@/lib/utils";

/**
 * Asked before saving changed items: lists what comes off the order and what goes
 * on, and whether the units coming off go back in stock. That box starts unticked.
 */
export function ItemChangeConfirm({ open, invoiceNumber, changes, onClose, onConfirm }: {
  open: boolean;
  invoiceNumber: string;
  changes: { removed: StockChange[]; added: StockChange[] };
  onClose: () => void;
  /** Awaited with the dialog locked; the caller closes it when finished. */
  onConfirm: (putBack: boolean) => Promise<void> | void;
}) {
  const [putBack, setPutBack] = useState(false);
  const [busy, setBusy] = useState(false);
  // Unticked again each time it opens.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setPutBack(false);
  }

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm(putBack);
    } finally {
      setBusy(false);
    }
  }

  const removedUnits = changes.removed.reduce((n, c) => n + c.quantity, 0);

  return (
    <Modal open={open} onClose={onClose} title="Save item changes?" size="sm" busy={busy} hideHeader>
      <div className="space-y-5 p-5 sm:p-6" style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}>
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ArrowLeftRight size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-foreground">Save item changes?</h3>
            <p className="mt-1 text-sm text-muted-foreground">Here&apos;s what changes on {invoiceNumber}.</p>
          </div>
        </div>

        {changes.removed.length > 0 && (
          <section className="space-y-2">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Taken off the order</h4>
            <ChangeList items={changes.removed} sign="−" />
            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border p-3 text-sm text-foreground has-[:checked]:border-primary/40 has-[:checked]:bg-primary/5">
              <input
                type="checkbox"
                checked={putBack}
                onChange={e => setPutBack(e.target.checked)}
                disabled={busy}
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary"
              />
              <span>
                <span className="block font-semibold">Add {removedUnits === 1 ? "it" : "them"} back to stock</span>
                <span className="block text-[12px] text-muted-foreground">
                  {putBack
                    ? `${removedUnits} unit${removedUnits === 1 ? "" : "s"} go${removedUnits === 1 ? "es" : ""} back in stock.`
                    : "Left unticked, stock stays as it is."}
                </span>
              </span>
            </label>
          </section>
        )}

        {changes.added.length > 0 && (
          <section className="space-y-2">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Added to the order</h4>
            <ChangeList items={changes.added} sign="+" />
            <p className="text-[12px] text-muted-foreground">These are taken out of stock.</p>
          </section>
        )}

        <div className="flex gap-3">
          <Button variant="secondary" onClick={onClose} disabled={busy} className="flex-1" data-autofocus>
            Go back
          </Button>
          <Button onClick={confirm} loading={busy} className="flex-1">
            Save changes
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ChangeList({ items, sign }: { items: StockChange[]; sign: "+" | "−" }) {
  return (
    <ul className="divide-y divide-border rounded-xl border border-border text-sm">
      {items.map(item => (
        <li key={item.key} className="flex items-baseline gap-2.5 px-3 py-2">
          <span className={cn("w-9 shrink-0 font-bold tabular-nums", sign === "+" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
            {sign}{item.quantity}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold text-foreground">{item.name}</span>
            {item.label && <span className="block text-[12px] text-muted-foreground">{item.label}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
