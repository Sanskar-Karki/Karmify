"use client";

import React, { useState } from "react";
import { restockProduct } from "@/app/actions";
import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/shared/Button";
import { sortVariants } from "@/components/shared/VariantStock";
import { CustomerSearchField, customerNote, type PickedCustomer } from "@/components/shared/CustomerSearchField";
import { mutate } from "@/lib/mutate";

type Variant = { id: string; size: string; color: string; quantity: number };
export type RestockProduct = { id: string; name: string; sku: string; variants: Variant[] };

const input = "w-full px-3 py-2 rounded-lg border border-border/60 bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40";

/** Adds new stock: per size/colour for clothing, or one number. Opened from the catalog and the product page. */
export function RestockDialog({
  product, currentStock, onClose, onDone, mode = "restock",
}: {
  /** "return": units brought back without an order; who brought them back is optional. */
  mode?: "restock" | "return";
  /** null keeps the dialog closed. */
  product: RestockProduct | null;
  currentStock: number;
  onClose: () => void;
  onDone: () => Promise<unknown> | void;
}) {
  return product ? <RestockForm key={`${product.id}-${mode}`} product={product} currentStock={currentStock} onClose={onClose} onDone={onDone} mode={mode} /> : null;
}

function RestockForm({ product, currentStock, onClose, onDone, mode }: {
  product: RestockProduct; currentStock: number; onClose: () => void; onDone: () => Promise<unknown> | void; mode: "restock" | "return";
}) {
  const isReturn = mode === "return";
  const sized = product.variants.length > 0;
  const variants = sortVariants(product.variants);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");
  // A return only: who brought it back, if known.
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [saving, setSaving] = useState(false);

  const count = (value: string | undefined) => Math.max(0, Math.floor(Number(value) || 0));
  const total = sized ? variants.reduce((sum, v) => sum + count(amounts[v.id]), 0) : count(quantity);
  const dirty = total > 0 || notes.trim() !== "" || customer !== null;

  async function save() {
    if (total <= 0) return;
    setSaving(true);
    const result = await mutate(
      () => restockProduct({
        productId: product.id,
        ...(sized
          ? { rows: variants.map(v => ({ variantId: v.id, quantity: count(amounts[v.id]) })).filter(r => r.quantity > 0) }
          : { quantity: total }),
        notes: notes.trim() || undefined,
        ...(isReturn && customerNote(customer) && { customer: customerNote(customer) }),
        kind: mode,
      }),
      { success: isReturn ? `${total} ${product.name} returned to stock.` : `Added ${total} to ${product.name}.` }
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
      title={isReturn ? `Return ${product.name}` : `Restock ${product.name}`}
      description={`${product.sku} · ${currentStock} in stock now`}
      size="md"
      busy={saving}
      dirty={dirty}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving} className="flex-1">Cancel</Button>
          <Button onClick={save} loading={saving} disabled={total <= 0} className="flex-1">
            {saving ? "Saving…" : isReturn ? (total > 0 ? `Return ${total} to stock` : "Return to stock") : total > 0 ? `Add ${total} to stock` : "Add to stock"}
          </Button>
        </>
      }
    >
      <div className="p-5 sm:p-6 space-y-4">
        {sized ? (
          <div className="rounded-xl border border-border/60 overflow-hidden">
            <div className="grid grid-cols-[1fr_4.5rem_6rem] gap-2 px-3 py-2 bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              <span>Size / colour</span><span className="text-right">Now</span><span className="text-right">{isReturn ? "Came back" : "Adding"}</span>
            </div>
            <div className="divide-y divide-border/40 max-h-72 overflow-y-auto">
              {variants.map((v, i) => {
                const label = [v.size, v.color].filter(Boolean).join(" · ");
                const after = v.quantity + count(amounts[v.id]);
                return (
                  <div key={v.id} className="grid grid-cols-[1fr_4.5rem_6rem] gap-2 px-3 py-1.5 items-center">
                    <span className="text-sm font-medium truncate">{label}</span>
                    <span className="text-right text-xs text-muted-foreground">
                      {v.quantity}{count(amounts[v.id]) > 0 && <span className="text-emerald-600 font-semibold"> → {after}</span>}
                    </span>
                    <input
                      type="number" inputMode="numeric" min={0}
                      data-autofocus={i === 0 ? true : undefined}
                      value={amounts[v.id] ?? ""}
                      placeholder="0"
                      onChange={e => setAmounts(a => ({ ...a, [v.id]: e.target.value }))}
                      onFocus={e => e.target.select()}
                      aria-label={`Units to add for ${label}`}
                      className={`${input} text-right py-1.5`}
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between px-3 py-2 bg-muted/30 text-xs font-semibold">
              <span>{isReturn ? "Returning" : "Adding"}</span><span>{total} unit{total === 1 ? "" : "s"}</span>
            </div>
          </div>
        ) : (
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground">{isReturn ? "Units that came back" : "Units that came in"}</span>
            <input
              type="number" inputMode="numeric" min={1}
              data-autofocus
              value={quantity}
              placeholder="0"
              onChange={e => setQuantity(e.target.value)}
              className={input}
            />
            {total > 0 && <span className="block text-[11px] text-emerald-600 font-semibold">Stock becomes {currentStock + total}</span>}
          </label>
        )}
        {isReturn && <CustomerSearchField label="Customer (optional)" value={customer} onChange={setCustomer} />}
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-muted-foreground">{isReturn ? "Reason (optional)" : "Note (optional)"}</span>
          <input value={notes} onChange={e => setNotes(e.target.value)} placeholder={isReturn ? "e.g. Exchanged at the studio, wrong size" : "e.g. Batch from Shoib Garment"} className={input} />
        </label>
        <p className="text-[11px] text-muted-foreground">
          {isReturn
            ? "Put back in stock and saved in the stock history as Returned, with the customer if you add one, but no order. To return items from a customer's order, use Return on that order instead."
            : sized ? "New sizes or colours are added in Edit product." : "Saved in the product's stock history as Stock In."}
        </p>
      </div>
    </Modal>
  );
}
