"use client";

import React, { useMemo, useState } from "react";
import { Pencil, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { listFutureOrders, updateFutureOrder } from "@/app/actions";
import { Button } from "@/components/shared/Button";
import { Modal } from "@/components/shared/Modal";
import { HubEditField } from "@/components/orders/HubEditField";
import { addDays, MAX_DAYS_AHEAD, nepalToday } from "@/lib/futureOrders";
import { mutate } from "@/lib/mutate";
import { DOOR_TO_DOOR, type CourierArea } from "@/lib/courier";
import { formatNPR } from "@/lib/utils";
import type { ActionResult } from "@/lib/types";

type FutureList = Awaited<ReturnType<typeof listFutureOrders>> extends ActionResult<infer T> ? T : never;
export type FutureRow = FutureList extends (infer R)[] ? R : never;

const fieldClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20";
const labelClass = "text-xs font-semibold text-muted-foreground";

const formOf = (row: FutureRow) => ({
  name: row.customerName ?? "",
  phone: row.customerPhone ?? "",
  altPhone: row.customerAltPhone ?? "",
  address: row.address ?? "",
  sendOn: row.sendOn ?? "",
  delivery: String(row.deliveryAmount),
  cod: String(row.codAmount),
});

/**
 * Edits a future order's customer, send date and delivery money. The items stay as
 * saved (their stock may already be set aside), so they're shown, not edited.
 */
export function FutureOrderEditDialog({ row, onClose, onSaved }: { row: FutureRow; onClose: () => void; onSaved: () => Promise<unknown> | void }) {
  const initial = useMemo(() => formOf(row), [row]);
  const [form, setForm] = useState(initial);
  // COD follows the delivery charge until it's typed by hand.
  const [codTouched, setCodTouched] = useState(false);
  // The hub picker works on an order's saved hub; a future order keeps it in its sale.
  const savedHub = useMemo(() => ({
    courierAreaId: row.courierArea?.areaId ?? null,
    courierLocationId: row.courierArea?.locationId ?? null,
    courierAreaTitle: row.courierArea?.title ?? null,
    courierTrackingCode: null,
    courierServiceId: row.courierServiceId ?? null,
  }), [row]);
  const [hub, setHub] = useState<CourierArea | null>(row.courierArea ? { ...row.courierArea, hub: null } : null);
  const [service, setService] = useState(row.courierServiceId ?? DOOR_TO_DOOR);
  const [saving, setSaving] = useState(false);

  const delivery = row.mode === "delivery";
  const collects = delivery && row.paymentMethod === "COD";
  const deliveryValue = parseFloat(form.delivery);
  const grand = row.goodsTotal + (Number.isFinite(deliveryValue) ? deliveryValue : row.deliveryAmount);
  const hubEdited = (hub?.locationId ?? null) !== (row.courierArea?.locationId ?? null) || service !== (row.courierServiceId ?? DOOR_TO_DOOR);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial) || (delivery && hubEdited);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [key]: e.target.value }));
  function changeDelivery(value: string) {
    setForm(f => {
      if (!collects || codTouched) return { ...f, delivery: value };
      const next = parseFloat(value);
      const cod = row.codAmount + ((Number.isFinite(next) ? next : 0) - row.deliveryAmount);
      return { ...f, delivery: value, cod: String(Math.max(0, Math.round(cod * 100) / 100)) };
    });
  }

  async function save() {
    if (!form.name.trim()) return void document.getElementById("future-edit-name")?.focus();
    setSaving(true);
    const result = await mutate(
      () => updateFutureOrder(row.id, {
        customerName: form.name,
        customerPhone: form.phone,
        customerAltPhone: form.altPhone,
        customerAddress: form.address,
        ...(row.sendOn && { sendOn: form.sendOn }),
        ...(delivery && {
          deliveryAmount: parseFloat(form.delivery) || 0,
          ...(collects && { codAmount: parseFloat(form.cod) || 0 }),
          ...(hubEdited && { courierArea: hub ? { areaId: hub.areaId, locationId: hub.locationId, title: hub.title } : null, courierServiceId: service }),
        }),
      }),
      { success: r => `Future order for ${r.customerName} saved.` }
    );
    setSaving(false);
    if (result.ok) {
      await onSaved();
      onClose();
    }
  }

  const today = nepalToday();
  const advance = collects ? Math.max(0, grand - (parseFloat(form.cod) || 0)) : 0;
  return (
    <Modal
      open
      onClose={onClose}
      title="Edit future order"
      description={row.sendOn ? "Sent on the customer's date" : "Waiting for stock"}
      icon={Pencil}
      size="lg"
      busy={saving}
      dirty={dirty}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving} className="flex-1">Cancel</Button>
          <Button onClick={() => void save()} loading={saving} disabled={!dirty} className="flex-1">{saving ? "Saving…" : "Save Changes"}</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 sm:p-6">
        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor="future-edit-name" className={labelClass}>Customer name</label>
          <input id="future-edit-name" data-autofocus value={form.name} onChange={set("name")} className={fieldClass} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="future-edit-phone" className={labelClass}>Phone</label>
          <input id="future-edit-phone" type="tel" value={form.phone} onChange={set("phone")} className={fieldClass} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="future-edit-alt" className={labelClass}>Alternative number <span className="font-normal">(optional)</span></label>
          <input id="future-edit-alt" type="tel" value={form.altPhone} onChange={set("altPhone")} className={fieldClass} />
        </div>
        {(row.mode !== "walkin" || row.address) && (
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor="future-edit-address" className={labelClass}>Address</label>
            <input id="future-edit-address" value={form.address} onChange={set("address")} className={fieldClass} />
          </div>
        )}
        {row.sendOn && (
          <div className="space-y-1.5">
            <label htmlFor="future-edit-date" className={labelClass}>Send on</label>
            <input
              id="future-edit-date"
              type="date"
              value={form.sendOn}
              min={addDays(today, 1)}
              max={addDays(today, MAX_DAYS_AHEAD)}
              onChange={set("sendOn")}
              className={fieldClass}
            />
            {form.sendOn === row.sendOn && row.sendOn <= today && (
              <p className="text-[12px] text-muted-foreground">It&apos;s due. Move it to the orders to send it, or pick a later day.</p>
            )}
          </div>
        )}
        {delivery && (
          <>
            <div className="sm:col-span-2">
              <HubEditField
                sale={savedHub} value={hub} onChange={setHub} service={service} onServiceChange={setService} address={form.address} labelClass={labelClass}
                onRate={charge => changeDelivery(String(charge))}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="future-edit-delivery" className={labelClass}>Delivery charge (Rs.)</label>
              <input id="future-edit-delivery" type="number" inputMode="decimal" min={0} step="0.01" value={form.delivery} onChange={e => changeDelivery(e.target.value)} className={fieldClass} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="future-edit-cod" className={labelClass}>COD amount (Rs.)</label>
              {collects ? (
                <>
                  <input
                    id="future-edit-cod" type="number" inputMode="decimal" min={0} step="0.01" value={form.cod}
                    onChange={e => { setCodTouched(true); set("cod")(e); }}
                    className={fieldClass}
                  />
                  <p className="text-[12px] text-muted-foreground">
                    Total {formatNPR(grand)}{advance > 0.004 ? ` · ${formatNPR(advance)} paid up front` : ""}
                  </p>
                </>
              ) : (
                <p className="rounded-xl bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">Paid in full, so nothing to collect.</p>
              )}
            </div>
          </>
        )}
        <div className="space-y-2 border-t border-border/60 pt-4 sm:col-span-2">
          <div className="flex items-center justify-between gap-2">
            <span className={labelClass}>Items</span>
            {dirty ? (
              <span className="text-[11px] text-muted-foreground">Save or cancel the changes above to edit items</span>
            ) : (
              <Link
                href={`/sales?editFuture=${encodeURIComponent(row.id)}`}
                title="Opens this order in the POS, filled in, to change its items. Saving there replaces it."
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
              >
                <ShoppingCart size={13} /> Edit items in the POS
              </Link>
            )}
          </div>
          <ul className="space-y-1 text-sm">
            {row.lines.map((line, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">{line.quantity}× {line.name}{line.variantLabel && ` (${line.variantLabel})`}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{formatNPR(line.quantity * line.unitPrice)}</span>
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-muted-foreground">
            Items are changed in the POS: it opens with this order filled in, and saving there replaces it.
            {row.setAside > 0 ? " The stock it set aside counts as available there." : ""}
          </p>
        </div>
      </div>
    </Modal>
  );
}
