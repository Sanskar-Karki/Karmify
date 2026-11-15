"use client";

import React, { useState } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { returnSaleItems } from "@/app/actions";
import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/shared/Button";
import { mutate } from "@/lib/mutate";
import { itemOptionsText } from "@/lib/orders";
import { cn, formatNPR } from "@/lib/utils";
import type { Sale } from "@/lib/types";

/** Pick which items of an order came back and how many; they go back into stock. */
export function ReturnDialog({ sale, onClose, onDone }: { sale: Sale | null; onClose: () => void; onDone: () => Promise<unknown> | void }) {
  return sale ? <ReturnForm key={sale.id} sale={sale} onClose={onClose} onDone={onDone} /> : null;
}

function ReturnForm({ sale, onClose, onDone }: { sale: Sale; onClose: () => void; onDone: () => Promise<unknown> | void }) {
  const lines = sale.items.map(item => ({ item, left: item.quantity - (item.returnedQty ?? 0) }));
  const returnable = lines.filter(l => l.left > 0);
  // With a single line, it starts ticked: that's almost always what came back.
  const [picked, setPicked] = useState<Record<string, number>>(() =>
    returnable.length === 1 ? { [returnable[0].item.id]: returnable[0].left } : {}
  );
  const [markReturned, setMarkReturned] = useState(false);
  const [saving, setSaving] = useState(false);

  const units = Object.values(picked).reduce((sum, n) => sum + n, 0);
  const everything = returnable.length > 0 && returnable.every(l => (picked[l.item.id] ?? 0) >= l.left);
  const value = lines.reduce((sum, l) => sum + (picked[l.item.id] ?? 0) * l.item.unitPrice, 0);

  const toggle = (id: string, left: number) =>
    setPicked(p => {
      const next = { ...p };
      if (next[id]) delete next[id];
      else next[id] = left;
      return next;
    });
  const setQty = (id: string, qty: number, left: number) =>
    setPicked(p => {
      const next = { ...p };
      const clamped = Math.max(0, Math.min(left, qty));
      if (clamped === 0) delete next[id];
      else next[id] = clamped;
      return next;
    });

  async function save() {
    if (units === 0) return;
    setSaving(true);
    const result = await mutate(
      () => returnSaleItems(
        sale.id,
        Object.entries(picked).map(([itemId, quantity]) => ({ itemId, quantity })),
        { markReturned: everything || markReturned }
      ),
      {
        success: data =>
          data.restocked === data.units
            ? `${data.units} unit${data.units === 1 ? "" : "s"} back in stock${data.markedReturned ? ` · ${sale.invoiceNumber} marked Returned` : ""}.`
            : `Return saved. ${data.restocked} of ${data.units} went back in stock (the rest never left stock).`,
      }
    );
    setSaving(false);
    if (result.ok) {
      await onDone();
      onClose();
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      icon={RotateCcw}
      title={`Return items from ${sale.invoiceNumber}`}
      description="Tick what came back. Those units go back into stock, to the same size and colour."
      size="md"
      busy={saving}
      dirty={units > 0 && returnable.length > 1}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving} className="flex-1">Cancel</Button>
          <Button onClick={save} loading={saving} disabled={units === 0} className="flex-1">
            {saving ? "Saving…" : units > 0 ? `Return & restock ${units}` : "Choose items"}
          </Button>
        </>
      }
    >
      <div className="p-5 sm:p-6 space-y-4">
        {returnable.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Everything on this order has already been returned.</p>
        ) : (
          <ul className="divide-y divide-border/50 rounded-xl border border-border/60">
            {lines.map(({ item, left }) => {
              const qty = picked[item.id] ?? 0;
              const options = itemOptionsText(item);
              const done = left <= 0;
              return (
                <li key={item.id} className={cn("flex items-center gap-3 px-3 py-2.5", done && "opacity-50")}>
                  <input
                    type="checkbox"
                    checked={qty > 0}
                    disabled={done}
                    onChange={() => toggle(item.id, left)}
                    aria-label={`Return ${item.product.name}`}
                    className="h-4 w-4 shrink-0 accent-[var(--primary)] cursor-pointer"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-semibold">{item.product.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {[options, `${item.quantity} × ${formatNPR(item.unitPrice)}`, item.returnedQty ? `${item.returnedQty} already returned` : null].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  {!done && left > 1 && (
                    <div className="flex shrink-0 items-center gap-1">
                      <button type="button" onClick={() => setQty(item.id, qty - 1, left)} disabled={qty === 0} aria-label={`One fewer ${item.product.name}`} className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted hover:bg-muted/70 disabled:opacity-40"><Minus size={11} /></button>
                      <span className="w-10 text-center text-xs font-bold" aria-live="polite">{qty}/{left}</span>
                      <button type="button" onClick={() => setQty(item.id, qty + 1, left)} disabled={qty >= left} aria-label={`One more ${item.product.name}`} className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted hover:bg-muted/70 disabled:opacity-40"><Plus size={11} /></button>
                    </div>
                  )}
                  {done && <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">Returned</span>}
                </li>
              );
            })}
          </ul>
        )}

        {units > 0 && (
          <div className="space-y-2 rounded-xl bg-muted/40 p-3 text-xs">
            <p className="flex justify-between"><span>Going back into stock</span><span className="font-bold">{units} unit{units === 1 ? "" : "s"}</span></p>
            <p className="flex justify-between text-muted-foreground"><span>Value of returned items</span><span>{formatNPR(value)}</span></p>
            {everything ? (
              <p className="text-[11px] text-muted-foreground">Everything is coming back, so the order will be marked Returned.</p>
            ) : (
              <label className="flex items-center gap-2 text-[12px] cursor-pointer">
                <input type="checkbox" checked={markReturned} onChange={e => setMarkReturned(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--primary)]" />
                Also mark the order as Returned
              </label>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
