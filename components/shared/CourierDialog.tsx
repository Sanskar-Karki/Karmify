"use client";

import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Copy, MapPin, Search, Truck, X } from "lucide-react";
import { toast } from "sonner";
import { estimateCourierRate, getCourierSetup, getCourierTracking, searchCourierAreas, sendOrderToCourier } from "@/app/actions";
import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/shared/Button";
import { Dropdown } from "@/components/shared/Dropdown";
import { Pulse } from "@/components/shared/Pulse";
import { cn, formatNPR } from "@/lib/utils";
import { mutate } from "@/lib/mutate";
import { itemName } from "@/lib/orders";
import {
  COURIER_SERVICES, courierMobile, courierStatusLabel, courierStatusStyle, splitCourierAddress,
  type CourierArea, type CourierCategory, type CourierTracking,
} from "@/lib/courier";
import type { Sale } from "@/lib/types";

const CATEGORY_STORAGE_KEY = "karmify_upaya_category";

const fieldClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20";
const labelClass = "text-xs font-semibold text-muted-foreground";

function savedCategory() {
  try {
    return localStorage.getItem(CATEGORY_STORAGE_KEY) ?? "1";
  } catch {
    return "1";
  }
}

function initialForm(sale: Sale) {
  const { address, landmark } = splitCourierAddress(sale.customerAddress);
  const goods = sale.items.reduce((total, item) => total + item.quantity * item.unitPrice, 0) - sale.discount;
  return {
    name: sale.customerName ?? "",
    phone: courierMobile(sale.customerPhone) ?? sale.customerPhone ?? "",
    address,
    landmark,
    description: sale.items.map(item => `${item.quantity} x ${itemName(item)}`).join(", ").slice(0, 2500),
    declaredValue: String(Math.max(1, Math.round(goods))),
    // Website imports don't record a COD amount; the order total is what's due.
    cod: sale.paymentMethod === "QR" ? "0" : String(sale.codAmount || sale.totalAmount),
    weight: "1",
    // The customer's own note from the website (e.g. "call before delivery"); editable before booking.
    note: (sale.notes ?? "").slice(0, 250),
    service: "3",
    category: savedCategory(),
  };
}

function Notice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="p-5 sm:p-6">
      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 p-4 text-sm">
        <AlertCircle size={16} className="text-muted-foreground shrink-0 mt-0.5" />
        <div className="min-w-0 break-words">
          <p>{message}</p>
          {onRetry && <button type="button" onClick={onRetry} className="mt-2 text-xs font-semibold text-primary hover:underline">Try again</button>}
        </div>
      </div>
    </div>
  );
}

function SendForm({ sale, onClose, onBooked }: { sale: Sale; onClose: () => void; onBooked: () => void }) {
  const [form, setForm] = useState(() => initialForm(sale));
  const [categories, setCategories] = useState<CourierCategory[] | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [suggestions, setSuggestions] = useState<CourierArea[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CourierArea[]>([]);
  const [searching, setSearching] = useState(false);
  // A website customer has already chosen their area at checkout.
  const [area, setArea] = useState<CourierArea | null>(
    sale.courierAreaId && sale.courierLocationId
      ? { areaId: sale.courierAreaId, locationId: sale.courierLocationId, title: sale.courierAreaTitle ?? `Area ${sale.courierAreaId}`, hub: null }
      : null
  );
  const [rate, setRate] = useState<{ loading: boolean; charge: number | null }>({ loading: false, charge: null });
  const [sending, setSending] = useState(false);
  const latestSearch = useRef(0);

  const update = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }));

  useEffect(() => {
    let current = true;
    getCourierSetup(sale.customerAddress ?? "")
      .then(result => {
        if (!current) return;
        if (result.ok) {
          setCategories(result.data.categories);
          setSuggestions(result.data.suggestions);
        } else {
          setSetupError(result.message);
        }
      })
      .catch(() => { if (current) setSetupError("Could not reach the server. Check your connection."); });
    return () => { current = false; };
  }, [sale.customerAddress, attempt]);

  useEffect(() => {
    const id = ++latestSearch.current;
    if (query.trim().length < 2) return;
    const timer = setTimeout(async () => {
      setSearching(true);
      const result = await searchCourierAreas(query).catch(() => null);
      if (id !== latestSearch.current) return;
      setSearching(false);
      setResults(result?.ok ? result.data : []);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const weight = parseFloat(form.weight);
  const locationId = area?.locationId;
  useEffect(() => {
    if (!locationId || !(weight > 0)) return;
    let current = true;
    const timer = setTimeout(async () => {
      setRate({ loading: true, charge: null });
      const result = await estimateCourierRate(locationId, weight, Number(form.service)).catch(() => null);
      if (current) setRate({ loading: false, charge: result?.ok ? result.data : null });
    }, 400);
    return () => { current = false; clearTimeout(timer); };
  }, [locationId, weight, form.service]);

  async function book() {
    if (!area) {
      toast.error("Choose a delivery area first.");
      return;
    }
    setSending(true);
    const result = await mutate(
      () => sendOrderToCourier(sale.id, {
        receiverName: form.name,
        receiverPhone: form.phone,
        address: form.address,
        landmark: form.landmark,
        areaId: area.areaId,
        serviceTypeId: Number(form.service),
        categoryId: Number(form.category),
        description: form.description,
        declaredValue: parseFloat(form.declaredValue),
        codAmount: parseFloat(form.cod),
        weight,
        note: form.note,
      }),
      {
        loading: "Booking with Upaya…",
        success: data => data.alreadyBooked ? `Already booked. Tracking code ${data.trackingCode} saved.` : `Booked with Upaya. Tracking code ${data.trackingCode}.`,
      }
    );
    setSending(false);
    if (!result.ok) return;
    try {
      localStorage.setItem(CATEGORY_STORAGE_KEY, form.category);
    } catch {
      // Private browsing: the default just isn't remembered.
    }
    onBooked();
  }

  const typing = query.trim().length >= 2;
  const options = typing ? results : suggestions;

  if (setupError) {
    return <Notice message={setupError} onRetry={() => { setSetupError(null); setAttempt(a => a + 1); }} />;
  }

  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-5 sm:p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label htmlFor="courier-name" className={labelClass}>Receiver name</label>
          <input id="courier-name" value={form.name} onChange={update("name")} maxLength={100} className={fieldClass} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="courier-phone" className={labelClass}>Mobile (10 digits)</label>
          <input id="courier-phone" type="tel" value={form.phone} onChange={update("phone")} className={fieldClass} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor="courier-address" className={labelClass}>Street and house</label>
          <input id="courier-address" value={form.address} onChange={update("address")} maxLength={100} className={fieldClass} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor="courier-landmark" className={labelClass}>Landmark (optional)</label>
          <input id="courier-landmark" value={form.landmark} onChange={update("landmark")} maxLength={250} placeholder="Opposite Everest Bank" className={fieldClass} />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <span className={labelClass}>Delivery area</span>
          {area ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2.5">
              <span className="text-sm font-semibold flex items-center gap-2 min-w-0"><Check size={14} className="text-primary shrink-0" /><span className="truncate">{area.title}</span></span>
              <button type="button" onClick={() => setArea(null)} aria-label="Change delivery area" className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted shrink-0"><X size={14} /></button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input data-autofocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search area, e.g. New Baneshwor" aria-label="Search delivery area" className={cn(fieldClass, "pl-9")} />
              </div>
              {categories === null ? (
                <Pulse className="h-16 w-full" />
              ) : options.length > 0 ? (
                <div className="rounded-xl border border-border divide-y divide-border/60 max-h-44 overflow-y-auto">
                  {!typing && <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Suggested from address</p>}
                  {options.map(option => (
                    <button key={option.areaId} type="button" onClick={() => setArea(option)} className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2">
                      <MapPin size={13} className="text-muted-foreground shrink-0" />
                      <span className="min-w-0 truncate">{option.title}</span>
                      {option.hub && <span className="ml-auto text-[10px] text-muted-foreground whitespace-nowrap max-w-[35%] truncate">{option.hub}</span>}
                    </button>
                  ))}
                </div>
              ) : typing && !searching ? (
                <p className="text-xs text-muted-foreground px-1">No matching area. Try a shorter name.</p>
              ) : null}
            </>
          )}
        </div>

        <div className="space-y-1.5">
          <span className={labelClass}>Service</span>
          <Dropdown aria-label="Service" value={form.service} onChange={service => setForm(f => ({ ...f, service }))} options={COURIER_SERVICES} />
        </div>
        <div className="space-y-1.5">
          <span className={labelClass}>Product category</span>
          {categories ? (
            <Dropdown aria-label="Product category" value={form.category} onChange={category => setForm(f => ({ ...f, category }))} options={categories} />
          ) : <Pulse className="h-[42px] w-full" />}
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor="courier-description" className={labelClass}>What&apos;s in the parcel</label>
          <input id="courier-description" value={form.description} onChange={update("description")} maxLength={2500} className={fieldClass} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="courier-cod" className={labelClass}>Cash to collect (Rs.)</label>
          <input id="courier-cod" type="number" inputMode="decimal" min={0} max={500000} value={form.cod} onChange={update("cod")} disabled={sale.paymentMethod === "QR"} className={cn(fieldClass, "disabled:opacity-60")} />
          {sale.paymentMethod === "QR" && <p className="text-[11px] text-muted-foreground">Paid by QR, so the rider collects nothing.</p>}
        </div>
        <div className="space-y-1.5">
          <label htmlFor="courier-declared" className={labelClass}>Declared value (Rs.)</label>
          <input id="courier-declared" type="number" inputMode="decimal" min={1} value={form.declaredValue} onChange={update("declaredValue")} className={fieldClass} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="courier-weight" className={labelClass}>Weight (kg)</label>
          <input id="courier-weight" type="number" inputMode="decimal" min={0.1} step="0.1" value={form.weight} onChange={update("weight")} className={fieldClass} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="courier-note" className={labelClass}>Note for rider (optional)</label>
          <input id="courier-note" value={form.note} onChange={update("note")} maxLength={250} placeholder="Call before arriving" className={fieldClass} />
        </div>

        <p className="sm:col-span-2 text-xs text-muted-foreground">
          {area && (rate.loading ? "Estimating delivery charge… " : rate.charge !== null ? `Estimated delivery charge ${formatNPR(rate.charge)}, final after weighing at the hub. ` : "Delivery charge estimate unavailable. ")}
          This books a real pickup. Cancelling afterwards needs a ticket with Upaya.
        </p>
      </div>

      <div className="flex gap-3 px-5 sm:px-6 pt-4 border-t border-border shrink-0" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
        <Button variant="secondary" onClick={onClose} disabled={sending} className="flex-1">Cancel</Button>
        <Button onClick={book} loading={sending} disabled={!area || !categories} className="flex-1">
          <Truck size={14} /> {sending ? "Booking…" : "Book Pickup"}
        </Button>
      </div>
    </>
  );
}

function TrackingView({ sale, onUpdated }: { sale: Sale; onUpdated: () => void }) {
  const [tracking, setTracking] = useState<CourierTracking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    getCourierTracking(sale.id)
      .then(result => {
        if (!current) return;
        if (result.ok) {
          setTracking(result.data.tracking);
          if (result.data.changed) onUpdated();
        } else {
          setError(result.message);
        }
      })
      .catch(() => { if (current) setError("Could not reach the server. Check your connection."); });
    return () => { current = false; };
    // onUpdated is deliberately left out: a page refresh must not trigger another lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sale.id, attempt]);

  const code = sale.courierTrackingCode as string;
  const status = tracking?.status ?? sale.courierStatus;

  function copy() {
    navigator.clipboard.writeText(code).then(
      () => toast.success("Tracking code copied."),
      () => toast.error("Couldn't copy. Select the code instead.")
    );
  }

  if (error) return <Notice message={error} onRetry={() => { setError(null); setAttempt(a => a + 1); }} />;

  const facts: [string, string | null][] = tracking ? [
    ["Area", [tracking.area, tracking.hub].filter(Boolean).join(", ") || null],
    ["Cash to collect", tracking.codAmount !== null ? formatNPR(tracking.codAmount) : null],
    ["COD settlement", tracking.codSettlement],
    ["Delivery charge", tracking.serviceCharge !== null ? `${formatNPR(tracking.serviceCharge)}${tracking.serviceChargeStatus ? ` · ${tracking.serviceChargeStatus}` : ""}` : null],
    ["Last update", tracking.latestUpdate],
  ] : [];

  return (
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-5 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={copy} aria-label="Copy tracking code" className="flex items-center gap-1.5 font-mono font-bold text-sm hover:text-primary">
          {code} <Copy size={13} />
        </button>
        {status && <span className={cn("text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full whitespace-nowrap", courierStatusStyle(status))}>{courierStatusLabel(status)}</span>}
      </div>

      {!tracking ? (
        <div className="space-y-2"><Pulse className="h-5 w-3/4" /><Pulse className="h-5 w-1/2" /><Pulse className="h-24 w-full" /></div>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            {facts.filter(([, value]) => value).map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className={labelClass}>{label}</dt>
                <dd className="font-semibold break-words">{value}</dd>
              </div>
            ))}
          </dl>
          {tracking.history.length > 0 && (
            <ol className="border-l-2 border-border ml-1 space-y-3">
              {[...tracking.history].reverse().map((entry, i) => (
                <li key={i} className="pl-4 relative">
                  <span className={cn("absolute -left-[5px] top-1.5 w-2 h-2 rounded-full", i === 0 ? "bg-primary" : "bg-border")} />
                  <p className="text-sm font-semibold">{entry.status ?? "Update"}</p>
                  <p className="text-[11px] text-muted-foreground">{[entry.at, entry.hub, entry.by].filter(Boolean).join(" · ")}</p>
                  {entry.remarks && <p className="text-xs mt-0.5 break-words">{entry.remarks}</p>}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}

interface CourierDialogProps {
  open: boolean;
  onClose: () => void;
  sale: Sale;
  /** The order's courier details changed and the list should reload. */
  onChanged: () => void;
}

/** Books an order with Upaya, or shows where it is once booked. */
export function CourierDialog({ open, onClose, sale, onChanged }: CourierDialogProps) {
  const booked = Boolean(sale.courierTrackingCode) && sale.courierStatus !== "cancelled";

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={Truck}
      size="lg"
      title={booked ? "Upaya shipment" : "Send to Upaya"}
      description={sale.invoiceNumber}
    >
      <div className="flex flex-col max-h-[calc(92dvh-5rem)]">
        {booked
          ? <TrackingView sale={sale} onUpdated={onChanged} />
          : <SendForm sale={sale} onClose={onClose} onBooked={() => { onChanged(); onClose(); }} />}
      </div>
    </Modal>
  );
}
