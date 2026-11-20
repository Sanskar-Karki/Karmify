"use client";

import React, { use, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, ArrowLeftRight, Calendar, ChevronRight, Copy, Edit2, Globe, Mail, MapPin, Gift, Megaphone, MessageCircle, Phone, Receipt, RotateCcw, Save, Store, Tag, Truck, Users, X, Zap,
} from "lucide-react";
import { ExchangeBadge, ExchangedNote, ExchangeReturnBox } from "@/components/orders/ExchangeInfo";
import { exchangeableUnits, exchangeOf, unitsInOpenExchanges } from "@/lib/exchange";
import { ReturnDialog } from "@/components/orders/ReturnDialog";
import { HubEditField, hubChanged, hubOf, serviceOf } from "@/components/orders/HubEditField";
import { COURIER_FINAL_STATUSES, type CourierArea } from "@/lib/courier";
import { CourierDialog, CourierTrackingPanel } from "@/components/shared/CourierDialog";
import { toast } from "sonner";
import { updateCustomerInfo, updateSaleDetails } from "@/app/actions";
import { cn, formatNPR } from "@/lib/utils";
import { resources } from "@/lib/resources";
import { useResources } from "@/lib/useResources";
import { mutate } from "@/lib/mutate";
import {
  contactKey, countsAsSale, customerKey, deliveryAddress, DELIVERY_STATUSES, DELIVERY_STYLES, sentWithUpaya, SENT_STATUS_BORDER,INSTANT_COURIERS, instantCourierLabel,
  isPR, itemOptionsText, PAYMENT_STYLES, codToCollect, referralLabel,
} from "@/lib/orders";
import { parseCustomerCode } from "@/lib/customerIdentity";
import { useStoreProfile } from "@/lib/storeProfile";
import { timeAgo } from "@/lib/notifications";
import { Dropdown } from "@/components/shared/Dropdown";
import { Button } from "@/components/shared/Button";
import { CustomerLabelDialog } from "@/components/shared/CustomerLabelDialog";
import { ReceiptDialog } from "@/components/shared/ReceiptDialog";
import { CustomerDetailPlaceholder } from "@/components/skeletons/placeholders";
import type { Sale } from "@/lib/types";
import { editedTotal, linesFromSale, linesGoods, linesSignature, OrderItemsEditor, stockChanges, type EditLine } from "@/components/orders/OrderItemsEditor";
import { ItemChangeConfirm } from "@/components/orders/ItemChangeConfirm";

type DeliveryStatus = "IN_PROCESS" | "DELIVERED" | "RETURN_PROCESS" | "RETURNED" | "CANCELLED";
type OrderFilter = "all" | DeliveryStatus;

const PAYMENT_METHODS = [
  { value: "COD", label: "Cash on Delivery" },
  { value: "CASH", label: "Cash (paid at the till)" },
  { value: "QR", label: "QR Payment" },
];
const PAYMENT_LABEL: Record<string, string> = { PAID: "Paid", UNPAID: "Unpaid", PARTIAL: "Part paid" };

const card = "bg-card border border-border/80 rounded-2xl shadow-sm";
const fieldClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20";
const labelClass = "text-xs font-semibold text-muted-foreground";
const iconButton = "w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-muted transition-colors shrink-0";

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join("") || "?";

/** wa.me wants the full international number: Nepal mobiles get 977 in front. */
function whatsappLink(phone: string) {
  const digits = phone.replace(/\D/g, "");
  const full = digits.length === 10 && digits.startsWith("9") ? `977${digits}` : digits;
  return full.length >= 10 ? `https://wa.me/${full}` : null;
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`Copied ${what}`, { id: "copied" });
  } catch {
    toast.error("Couldn't copy. Select it and copy it manually.");
  }
}

export default function CustomerDetailPage({ params }: { params: Promise<{ key: string }> }) {
  const { key: rawKey } = use(params);
  const decodedKey = decodeURIComponent(rawKey);
  const urlKey = parseCustomerCode(decodedKey) ?? decodedKey;
  const router = useRouter();

  const { customers, loading, refetch } = useResources({ customers: resources.customers });

  // Editing a phone or name changes the key this customer is grouped under.
  // `movedTo` keeps the page on them while the URL catches up.
  const [movedTo, setMovedTo] = useState<string | null>(null);
  const [lastUrlKey, setLastUrlKey] = useState(urlKey);
  if (urlKey !== lastUrlKey) {
    setLastUrlKey(urlKey);
    setMovedTo(null);
  }
  const key = movedTo ?? urlKey;
  const customer = customers.find(c => c.key === key)
    ?? customers.find(c => c.sales.some(s => contactKey(s) === key))
    ?? null;
  const store = useStoreProfile();
  const [labelSale, setLabelSale] = useState<Sale | null>(null);
  const [receiptSale, setReceiptSale] = useState<Sale | null>(null);
  const [showLabel, setShowLabel] = useState(false);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", address: "" });
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<OrderFilter>("all");

  const stats = useMemo(() => {
    if (!customer) return null;
    const counted = customer.sales.filter(countsAsSale);
    const spent = counted.reduce((sum, s) => sum + s.totalAmount, 0);
    const dates = customer.sales.map(s => new Date(s.createdAt).getTime());
    const unpaid = customer.sales
      .filter(s => s.deliveryStatus === "DELIVERED" && s.paymentStatus !== "PAID")
      .reduce((sum, s) => sum + codToCollect(s), 0);
    const byStatus = new Map<string, number>();
    for (const s of customer.sales) byStatus.set(s.deliveryStatus, (byStatus.get(s.deliveryStatus) ?? 0) + 1);
    return {
      spent,
      average: counted.length ? spent / counted.length : 0,
      first: new Date(Math.min(...dates)),
      last: new Date(Math.max(...dates)),
      returns: (byStatus.get("RETURNED") ?? 0) + (byStatus.get("RETURN_PROCESS") ?? 0),
      website: customer.sales.filter(s => s.source === "website").length,
      unpaid,
      byStatus,
    };
  }, [customer]);

  function startEditing() {
    if (!customer) return;
    setForm({ name: customer.name, phone: customer.phone ?? "", address: deliveryAddress(customer.address) });
    setEditing(true);
  }

  async function handleSave() {
    if (!customer) return;
    if (!form.name.trim()) {
      toast.error("Customer name is required.");
      return;
    }

    setSaving(true);
    const result = await mutate(
      () => updateCustomerInfo(customer.sales.map(s => s.id), form),
      { success: "Customer details updated." }
    );
    if (result.ok) {
      const nextKey = customerKey({
        customerEmail: customer.email,
        customerPhone: form.phone.trim(),
        customerName: form.name.trim(),
        customer: customer.code ? { code: customer.code } : null,
      });
      setMovedTo(nextKey);
      await refetch();
      if (nextKey !== urlKey) router.replace(`/customers/${encodeURIComponent(nextKey)}`);
      setEditing(false);
    }
    setSaving(false);
  }

  if (loading) {
    return <CustomerDetailPlaceholder />;
  }

  if (!customer || !stats) {
    return (
      <div className={cn(card, "flex flex-col items-center gap-2 py-16 text-center text-muted-foreground")}>
        <Users size={36} className="opacity-30" />
        <p className="text-sm font-semibold">Customer not found</p>
        <Link href="/customers" className="mt-2 text-xs font-semibold text-primary dark:text-pink-300 hover:underline">Back to Customers</Link>
      </div>
    );
  }

  const address = deliveryAddress(customer.address);
  const wa = customer.phone ? whatsappLink(customer.phone) : null;
  const orders = filter === "all" ? customer.sales : customer.sales.filter(s => s.deliveryStatus === filter);
  const filterTabs: { id: OrderFilter; label: string; count: number }[] = [
    { id: "all", label: "All", count: customer.sales.length },
    ...DELIVERY_STATUSES.map(s => ({ id: s.value as OrderFilter, label: s.label, count: stats.byStatus.get(s.value) ?? 0 })).filter(t => t.count > 0),
  ];

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Breadcrumb */}
      <div className="flex items-center gap-3">
        <Link href="/customers" aria-label="Back to customers and orders" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border transition-colors hover:bg-muted">
          <ArrowLeft size={16} />
        </Link>
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <Link href="/customers" className="hover:text-foreground">Customers &amp; Orders</Link>
          <ChevronRight size={12} className="shrink-0" />
          <span className="truncate font-semibold text-foreground">{customer.name}</span>
        </nav>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        {/* ── Profile ── */}
        <aside className="space-y-4 lg:sticky lg:top-20">
          <section className={cn(card, "overflow-hidden")}>
            <div className="flex items-start gap-4 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-5">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-lg font-black text-primary-foreground shadow-md shadow-primary/20">
                {initials(customer.name)}
              </span>
              <div className="min-w-0 flex-1">
                <h1 className="break-words text-xl font-extrabold leading-tight tracking-tight">{customer.name}</h1>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {customer.code && (
                    <button
                      type="button"
                      onClick={() => copy(customer.code as string, customer.code as string)}
                      title="Copy customer ID"
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-1.5 py-0.5 font-mono text-[11px] font-bold hover:bg-muted"
                    >
                      {customer.code} <Copy size={10} className="text-muted-foreground" />
                    </button>
                  )}
                  {customer.orderCount > 1 && (
                    <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-extrabold uppercase text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                      Repeat customer
                    </span>
                  )}
                </div>
                <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Calendar size={11} /> Customer since {stats.first.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                </p>
              </div>
            </div>

            {/* Contact, or the edit form */}
            {editing ? (
              <div className="space-y-3 border-t border-border/60 p-5">
                <div className="space-y-1.5">
                  <label htmlFor="customer-name" className={labelClass}>Name</label>
                  <input id="customer-name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Customer name" className={fieldClass} autoFocus />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="customer-phone" className={labelClass}>Phone</label>
                  <input id="customer-phone" type="tel" inputMode="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="98XXXXXXXX" className={fieldClass} />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="customer-address" className={labelClass}>Address</label>
                  <textarea id="customer-address" rows={2} value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Delivery address" className={cn(fieldClass, "resize-none")} />
                  <p className="text-[11px] text-muted-foreground">Saved on all {customer.orderCount} of this customer&apos;s orders.</p>
                </div>
                <div className="flex gap-2 pt-1">
                  <Button variant="secondary" onClick={() => setEditing(false)} disabled={saving} className="flex-1 py-2 text-xs">
                    <X size={13} /> Cancel
                  </Button>
                  <Button onClick={handleSave} loading={saving} className="flex-1 py-2 text-xs">
                    {!saving && <Save size={13} />} {saving ? "Saving…" : "Save"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="border-t border-border/60 p-5">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Contact</h2>
                  <button type="button" onClick={startEditing} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-primary dark:text-pink-300 hover:bg-primary/10">
                    <Edit2 size={12} /> Edit
                  </button>
                </div>
                <div className="space-y-3 text-sm">
                  <ContactRow icon={Phone} label="Phone" value={customer.phone}>
                    {customer.phone && (
                      <>
                        <a href={`tel:${customer.phone}`} className={iconButton} title="Call" aria-label={`Call ${customer.phone}`}><Phone size={13} /></a>
                        {wa && <a href={wa} target="_blank" rel="noreferrer" className={iconButton} title="WhatsApp" aria-label="Message on WhatsApp"><MessageCircle size={13} /></a>}
                        <button type="button" onClick={() => copy(customer.phone as string, "phone number")} className={iconButton} title="Copy" aria-label="Copy phone number"><Copy size={13} /></button>
                      </>
                    )}
                  </ContactRow>
                  {customer.email && (
                    <ContactRow icon={Mail} label="Email" value={customer.email}>
                      <a href={`mailto:${customer.email}`} className={iconButton} title="Email" aria-label="Send an email"><Mail size={13} /></a>
                    </ContactRow>
                  )}
                  <ContactRow icon={MapPin} label="Address" value={address || null}>
                    {address && (
                      <button type="button" onClick={() => copy(address, "address")} className={iconButton} title="Copy" aria-label="Copy address"><Copy size={13} /></button>
                    )}
                  </ContactRow>
                </div>
              </div>
            )}
          </section>

          {/* Numbers */}
          <section className={cn(card, "grid grid-cols-2 gap-px overflow-hidden bg-border/60")} aria-label="Customer summary">
            {[
              { label: "Orders", value: String(customer.orderCount), note: `${stats.website} from the website` },
              { label: "Spent", value: formatNPR(stats.spent), note: "Cancelled left out" },
              { label: "Average order", value: formatNPR(Math.round(stats.average)), note: "Per order" },
              { label: "Last order", value: timeAgo(stats.last), note: stats.last.toLocaleDateString() },
              { label: "Returns", value: String(stats.returns), note: stats.returns ? "Returned or on the way" : "None", warn: stats.returns > 0 },
              { label: "Unpaid", value: formatNPR(stats.unpaid), note: stats.unpaid ? "Delivered, not marked paid" : "All settled", warn: stats.unpaid > 0 },
            ].map(stat => (
              <div key={stat.label} className="bg-card p-3.5">
                <p className="text-[11px] font-semibold text-muted-foreground">{stat.label}</p>
                <p className={cn("mt-0.5 text-base font-black", stat.warn ? "text-amber-600 dark:text-amber-400" : "text-foreground")}>{stat.value}</p>
                <p className="truncate text-[10px] text-muted-foreground">{stat.note}</p>
              </div>
            ))}
          </section>
        </aside>

        {/* ── Orders ── */}
        <section className="space-y-3" aria-labelledby="orders-title">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 id="orders-title" className="text-base font-bold">
              Orders <span className="font-medium text-muted-foreground">· {customer.sales.length}</span>
            </h2>
            <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]" role="tablist" aria-label="Filter orders">
              {filterTabs.map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={filter === tab.id}
                  onClick={() => setFilter(tab.id)}
                  className={cn(
                    "flex shrink-0 items-center gap-1 rounded-full border px-3 py-2 sm:px-2.5 sm:py-1 text-xs font-semibold transition-colors",
                    filter === tab.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {tab.label} <span className="text-[10px] font-normal tabular-nums">{tab.count}</span>
                </button>
              ))}
            </div>
          </div>

          {orders.length === 0 ? (
            <div className={cn(card, "py-12 text-center text-xs text-muted-foreground")}>No orders with this status.</div>
          ) : (
            orders.map(sale => (
              <OrderCard
                key={sale.id}
                sale={sale}
                related={customer.sales}
                onLabel={() => { setLabelSale(sale); setShowLabel(true); }}
                onReceipt={() => setReceiptSale(sale)}
                onSaved={() => refetch({ quiet: true })}
              />
            ))
          )}
        </section>
      </div>

      {labelSale && (
        <CustomerLabelDialog open={showLabel} onClose={() => setShowLabel(false)} order={labelSale} store={store} />
      )}
      {receiptSale && (
        <ReceiptDialog open onClose={() => setReceiptSale(null)} sales={[receiptSale]} store={store} />
      )}
    </div>
  );
}

function ContactRow({ icon: Icon, label, value, children }: { icon: typeof Phone; label: string; value: string | null; children?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon size={14} />
      </span>
      <dl className="min-w-0 flex-1">
        <dt className="text-[11px] text-muted-foreground">{label}</dt>
        <dd className={cn("break-words text-sm font-semibold", !value && "font-normal italic text-muted-foreground")}>{value || "Not provided"}</dd>
      </dl>
      {children && <div className="flex shrink-0 gap-1.5">{children}</div>}
    </div>
  );
}

/** One order: summary, items, quick status change, and a full edit form. */
function OrderCard({ sale, related, onLabel, onReceipt, onSaved }: {
  sale: Sale;
  /** The customer's other orders: exchanges of this one are among them. */
  related: Sale[];
  onLabel: () => void;
  onReceipt: () => void;
  onSaved: () => Promise<unknown> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);
  const [form, setForm] = useState(() => formFor(sale));
  const [hub, setHub] = useState<CourierArea | null>(() => hubOf(sale));
  const [service, setService] = useState<number>(() => serviceOf(sale));
  const [returning, setReturning] = useState(false);
  // The order's items and discount as edited; COD follows the new total until it's typed by hand.
  const [lines, setLines] = useState<EditLine[]>(() => linesFromSale(sale));
  const [discount, setDiscount] = useState(() => String(sale.discount ?? 0));
  const [codTouched, setCodTouched] = useState(false);
  const itemsLocked = sale.deliveryStatus === "CANCELLED" || sale.deliveryStatus === "RETURNED";
  const itemsChanged = !itemsLocked && (
    linesSignature(lines) !== linesSignature(linesFromSale(sale)) || (parseFloat(discount) || 0) !== (sale.discount ?? 0)
  );
  // Items coming off or going on: saving asks first, and whether the ones coming off go back in stock.
  const changes = itemsChanged ? stockChanges(sale, lines) : { removed: [], added: [] };
  const [confirmingItems, setConfirmingItems] = useState(false);
  const address = deliveryAddress(sale.customerAddress);
  const units = sale.items.reduce((n, i) => n + i.quantity, 0);
  // Units on their way back in an exchange are held: they can't be returned or swapped again.
  const held = useMemo(() => unitsInOpenExchanges(related, sale.id), [related, sale.id]);
  const heldUnits = [...held.values()].reduce((n, q) => n + q, 0);
  const returnedUnits = sale.items.reduce((n, i) => n + (i.returnedQty ?? 0), 0);
  const canReturn = sale.deliveryStatus !== "CANCELLED" && returnedUnits + heldUnits < units;
  // An exchange sends a replacement (another size, say) as a new order linked to this one.
  const canExchange = sale.deliveryStatus !== "CANCELLED" && !isPR(sale) && sale.items.some(item => exchangeableUnits(item, held) > 0);
  const [courierOpen, setCourierOpen] = useState(false);
  const withUpaya = Boolean(sale.courierTrackingCode) && sale.courierStatus !== "cancelled";
  // Still on its way (out for delivery, or coming back as a return): its tracking shows right in the card.
  const onItsWay = withUpaya
    && !COURIER_FINAL_STATUSES.includes(sale.courierStatus ?? "")
    && (sale.deliveryStatus === "IN_PROCESS" || sale.deliveryStatus === "RETURN_PROCESS");
  // Track a booked parcel, or book one for an order still to send (not one going by ride app).
  const canUseCourier = withUpaya || (sale.deliveryStatus === "IN_PROCESS" && !sale.deliveryVia);

  function formFor(s: Sale) {
    return {
      totalAmount: String(s.totalAmount),
      deliveryAmount: String(s.deliveryAmount ?? 0),
      codAmount: String(codToCollect(s)),
      customerAddress: deliveryAddress(s.customerAddress),
      deliveryStatus: (s.deliveryStatus ?? "IN_PROCESS") as string,
      paymentMethod: (s.paymentMethod ?? "COD") as string,
      deliveryVia: s.deliveryVia ?? "",
    };
  }

  async function changeStatus(status: string) {
    if (status === sale.deliveryStatus) return;
    setChangingStatus(true);
    const label = DELIVERY_STATUSES.find(d => d.value === status)?.label ?? status;
    const result = await mutate(() => updateSaleDetails(sale.id, { deliveryStatus: status as DeliveryStatus }), {
      success: `${sale.invoiceNumber} marked ${label}.`,
    });
    if (result.ok) await onSaved();
    setChangingStatus(false);
  }

  /**
   * COD follows the order total plus delivery: it moves by the same amount they
   * moved from the saved order, until it's typed by hand.
   */
  function withCod(f: ReturnType<typeof formFor>) {
    if (codTouched || sale.paymentMethod !== "COD" || sale.paymentStatus === "PAID" || sale.kind === "pr") return f;
    const moved = (parseFloat(f.totalAmount) || 0) + (parseFloat(f.deliveryAmount) || 0) - sale.totalAmount - (sale.deliveryAmount ?? 0);
    const cod = Math.max(0, (parseFloat(formFor(sale).codAmount) || 0) + moved);
    return { ...f, codAmount: String(Math.round(cod * 100) / 100) };
  }

  /** New items or discount: the order total follows, and COD with it. */
  function changeItems(next: EditLine[], nextDiscount: string) {
    setLines(next);
    setDiscount(nextDiscount);
    setForm(f => withCod({ ...f, totalAmount: String(editedTotal(sale, next, nextDiscount)) }));
  }

  function startEditing() {
    setForm(formFor(sale));
    setHub(hubOf(sale));
    setService(serviceOf(sale));
    setLines(linesFromSale(sale));
    setDiscount(String(sale.discount ?? 0));
    setCodTouched(false);
    setEditing(true);
  }

  /** Checks the form, then asks first when items come off or go on the order. */
  function save() {
    if (itemsChanged && sale.kind !== "pr" && (parseFloat(discount) || 0) > linesGoods(lines)) {
      toast.error("The discount is more than the items are worth.");
      return;
    }
    const amounts = [form.totalAmount, form.deliveryAmount, form.codAmount].map(v => parseFloat(v));
    if (amounts.some(v => !Number.isFinite(v) || v < 0)) {
      toast.error("Amounts must be numbers, 0 or more.");
      return;
    }
    if (itemsChanged && (changes.removed.length > 0 || changes.added.length > 0)) {
      setConfirmingItems(true);
      return;
    }
    return commit(false);
  }

  async function commit(putBackRemoved: boolean) {
    const amounts = [form.totalAmount, form.deliveryAmount, form.codAmount].map(v => parseFloat(v));
    setSaving(true);
    // A website order's address keeps its "[Shop]" tag.
    const tag = /^\[[^\]]*\]\s*/.exec(sale.customerAddress ?? "")?.[0] ?? "";
    const result = await mutate(
      () => updateSaleDetails(sale.id, {
        // Changed items set the total themselves (moved by the change in goods and discount) and move stock by the difference.
        ...(itemsChanged
          ? {
              items: lines.map(l => ({ itemId: l.itemId, productId: l.productId, variantId: l.variantId, quantity: l.quantity, unitPrice: l.unitPrice })),
              discount: Math.max(0, parseFloat(discount) || 0),
              putBackRemoved,
            }
          : { totalAmount: amounts[0] }),
        deliveryAmount: amounts[1],
        // Only when changed: a website order stores 0 here, which would otherwise read as "paid".
        ...(form.codAmount !== formFor(sale).codAmount && { codAmount: amounts[2] }),
        customerAddress: form.customerAddress.trim() ? tag + form.customerAddress.trim() : "",
        deliveryStatus: form.deliveryStatus as DeliveryStatus,
        paymentMethod: form.paymentMethod as "COD" | "QR" | "CASH",
        deliveryVia: form.deliveryVia || null,
        ...(service !== serviceOf(sale) && { courierServiceId: service }),
        ...(hubChanged(sale, hub) && { courierArea: hub ? { areaId: hub.areaId, locationId: hub.locationId, title: hub.title } : null }),
      }),
      { success: `${sale.invoiceNumber} updated.` }
    );
    if (result.ok) {
      await onSaved();
      setEditing(false);
    }
    setSaving(false);
    // Failed or not, back to the form: a stock error is fixed there.
    setConfirmingItems(false);
  }

  return (
    <article className={cn(card, "overflow-hidden", editing && "ring-2 ring-primary/30")}>
      {/* Header */}
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3 p-4 sm:p-5">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", sale.source === "website" ? "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400" : "bg-primary/10 text-primary")}>
            {sale.source === "website" ? <Globe size={17} /> : <Store size={17} />}
          </span>
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-mono text-sm font-bold">{sale.invoiceNumber}</span>
              <span className="text-[11px] text-muted-foreground">{sale.source === "website" ? "Website order" : "In store"}</span>
              {isPR(sale) && (
                <span className="inline-flex items-center gap-1 rounded-md bg-pink-100 px-1.5 py-0.5 text-[10px] font-extrabold uppercase text-pink-700 dark:bg-pink-950/40 dark:text-pink-300">
                  <Gift size={10} /> PR · free
                </span>
              )}
              <ExchangeBadge sale={sale} />
              {referralLabel(sale.referral) && (
                <span title={sale.referral ?? ""} className="inline-flex items-center gap-1 rounded-md bg-violet-100 px-1.5 py-0.5 text-[10px] font-extrabold uppercase text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
                  <Megaphone size={10} /> {referralLabel(sale.referral)}
                </span>
              )}
              {instantCourierLabel(sale.deliveryVia) && (
                <span className="inline-flex items-center gap-1 rounded-md bg-sky-100 px-1.5 py-0.5 text-[10px] font-extrabold uppercase text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                  <Zap size={10} /> {instantCourierLabel(sale.deliveryVia)}
                </span>
              )}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {new Date(sale.createdAt).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}
              {" · "}{units} item{units === 1 ? "" : "s"} · {sale.warehouse.name}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-base font-black">{formatNPR(sale.totalAmount)}</p>
            <p className="mt-0.5 flex items-center justify-end gap-1">
              <span className="text-[10px] font-semibold text-muted-foreground">{sale.paymentMethod === "QR" ? "QR" : sale.paymentMethod === "CASH" ? "Cash" : "COD"}</span>
              <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-extrabold uppercase", PAYMENT_STYLES[sale.paymentStatus] ?? PAYMENT_STYLES.UNPAID)}>
                {PAYMENT_LABEL[sale.paymentStatus] ?? sale.paymentStatus}
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* Status + actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-y border-border/50 bg-muted/30 px-4 py-2.5 sm:px-5">
        <div className="flex items-center gap-2">
          <div className="w-44">
            <Dropdown
              aria-label={`Delivery status of ${sale.invoiceNumber}`}
              value={sale.deliveryStatus}
              onChange={changeStatus}
              options={DELIVERY_STATUSES}
              disabled={changingStatus || editing}
              triggerClassName={cn("py-1.5 text-xs font-bold", DELIVERY_STYLES[sale.deliveryStatus], sentWithUpaya(sale) && SENT_STATUS_BORDER)}
            />
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {canReturn && (
            <button
              type="button"
              onClick={() => setReturning(true)}
              disabled={editing}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-semibold hover:bg-muted disabled:opacity-50"
              title="Customer sent items back: put them back in stock"
            >
              <RotateCcw size={12} /> Return
            </button>
          )}
          {canExchange && !editing && (
            <Link
              href={`/sales?exchange=${sale.id}`}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-semibold hover:bg-muted"
              title="Swap items (another size, say): opens the POS with this order, and Upaya collects the old items when it delivers the new ones"
            >
              <ArrowLeftRight size={12} /> Exchange
            </Link>
          )}
          {canUseCourier && (
            <button
              type="button"
              onClick={() => setCourierOpen(true)}
              className={cn(iconButton, withUpaya && "border-primary/40 text-primary")}
              title={withUpaya ? "Upaya tracking" : "Send to Upaya"}
              aria-label={`${withUpaya ? "Upaya tracking for" : "Send to Upaya:"} ${sale.invoiceNumber}`}
            >
              <Truck size={13} />
            </button>
          )}
          <button type="button" onClick={onLabel} className={iconButton} title="Print label" aria-label={`Print label for ${sale.invoiceNumber}`}><Tag size={13} /></button>
          <button type="button" onClick={onReceipt} className={iconButton} title="Print receipt" aria-label={`Print receipt for ${sale.invoiceNumber}`}><Receipt size={13} /></button>
          {!editing && (
            <button
              type="button"
              onClick={startEditing}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-semibold hover:bg-muted"
            >
              <Edit2 size={12} /> Edit
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <div className="space-y-4 p-4 sm:p-5">
          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2">
              <span className={labelClass}>Items</span>
              {itemsChanged && <span className="text-[11px] text-muted-foreground">Saving takes added units out of stock and asks about removed ones.</span>}
            </div>
            {itemsLocked ? (
              <p className="rounded-xl bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
                This order is {sale.deliveryStatus === "CANCELLED" ? "cancelled" : "returned"}, so its items can&apos;t be changed.
              </p>
            ) : (
              <OrderItemsEditor
                sale={sale}
                lines={lines}
                onLinesChange={next => changeItems(next, discount)}
                discount={discount}
                onDiscountChange={d => changeItems(lines, d)}
              />
            )}
            {itemsChanged && sale.courierTrackingCode && (
              <p className="text-[12px] text-amber-700 dark:text-amber-400">This order is already booked with Upaya, which keeps the amount it was booked with.</p>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {([
              ["totalAmount", "Order total"],
              ["deliveryAmount", "Delivery charge"],
              ["codAmount", "COD to collect"],
            ] as const).map(([field, label]) => (
              <div key={field} className="space-y-1.5">
                <label htmlFor={`${field}-${sale.id}`} className={labelClass}>{label}</label>
                <input
                  id={`${field}-${sale.id}`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={form[field]}
                  onChange={e => {
                    const value = e.target.value;
                    if (field === "codAmount") {
                      setCodTouched(true);
                      setForm(f => ({ ...f, codAmount: value }));
                    } else {
                      setForm(f => withCod({ ...f, [field]: value }));
                    }
                  }}
                  // With changed items the total follows the items and discount.
                  readOnly={field === "totalAmount" && itemsChanged}
                  title={field === "totalAmount" && itemsChanged ? "Follows the items and discount above" : undefined}
                  className={cn(fieldClass, "py-2", field === "totalAmount" && itemsChanged && "bg-muted/50 text-muted-foreground")}
                />
              </div>
            ))}
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`address-${sale.id}`} className={labelClass}>Delivery address for this order</label>
            <input id={`address-${sale.id}`} value={form.customerAddress} onChange={e => setForm(f => ({ ...f, customerAddress: e.target.value }))} placeholder="Delivery address" className={cn(fieldClass, "py-2")} />
          </div>
          {(sale.source === "website" || sale.customerAddress || sale.courierLocationId) && !sale.deliveryVia && (
            <HubEditField
              sale={sale} value={hub} onChange={setHub} service={service} onServiceChange={setService} address={form.customerAddress} labelClass={labelClass}
              onRate={charge => setForm(f => withCod({ ...f, deliveryAmount: String(charge) }))}
            />
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <span className={labelClass}>Delivery status</span>
              <Dropdown aria-label="Delivery status" value={form.deliveryStatus} onChange={v => setForm(f => ({ ...f, deliveryStatus: v }))} options={DELIVERY_STATUSES} triggerClassName="py-2" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <span className={labelClass}>Sent with</span>
              <Dropdown
                aria-label="Sent with"
                value={form.deliveryVia}
                onChange={v => setForm(f => ({ ...f, deliveryVia: v }))}
                options={[{ value: "", label: "Studio / Upaya / other" }, ...INSTANT_COURIERS]}
                triggerClassName="py-2"
              />
            </div>
            <div className="space-y-1.5">
              <span className={labelClass}>Payment method</span>
              <Dropdown aria-label="Payment method" value={form.paymentMethod} onChange={v => setForm(f => ({ ...f, paymentMethod: v }))} options={PAYMENT_METHODS} triggerClassName="py-2" />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">For cash on delivery, payment follows the status: Delivered marks it paid, anything else unpaid.</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(false)} disabled={saving} className="px-4 py-2 text-xs"><X size={13} /> Cancel</Button>
            <Button onClick={save} loading={saving} className="px-4 py-2 text-xs">{!saving && <Save size={13} />} {saving ? "Saving…" : "Save changes"}</Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,14rem)]">
          {/* Items */}
          <ul className="space-y-2">
            {sale.items.map(item => {
              const options = itemOptionsText(item);
              return (
                <li key={item.id} className="flex items-start justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <p className="break-words font-semibold text-foreground">{item.product.name}</p>
                    <p className="text-muted-foreground">{[options, `${item.quantity} × ${formatNPR(item.unitPrice)}`].filter(Boolean).join(" · ")}</p>
                    {(item.returnedQty ?? 0) > 0 && (
                      <p className="mt-0.5 inline-flex items-center gap-1 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
                        <RotateCcw size={9} /> {item.returnedQty === item.quantity ? "Returned" : `${item.returnedQty} of ${item.quantity} returned`} · back in stock
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 font-bold">{formatNPR(item.unitPrice * item.quantity)}</span>
                </li>
              );
            })}
            {(sale.deliveryAmount > 0 || sale.discount > 0) && (
              <li className="space-y-0.5 border-t border-border/50 pt-2 text-[11px] text-muted-foreground">
                {sale.deliveryAmount > 0 && <p className="flex justify-between"><span>Delivery</span><span>{formatNPR(sale.deliveryAmount)}</span></p>}
                {sale.discount > 0 && <p className="flex justify-between"><span>Discount{exchangeOf(sale) ? " (incl. exchange credit)" : ""}</span><span>−{formatNPR(sale.discount)}</span></p>}
              </li>
            )}
            <ExchangedNote sale={sale} related={related} />
          </ul>

          {/* Delivery details */}
          <div className="space-y-2 rounded-xl bg-muted/40 p-3 text-xs">
            <p className="flex items-start gap-1.5">
              <MapPin size={12} className="mt-0.5 shrink-0 text-muted-foreground" />
              <span className={cn("break-words", !address && "italic text-muted-foreground")}>{address || "No address (in-store sale)"}</span>
            </p>
            {sale.courierAreaTitle && <p className="pl-[18px] text-[11px] text-muted-foreground">Hub: {sale.courierAreaTitle}</p>}
            {instantCourierLabel(sale.deliveryVia) && <p className="pl-[18px] text-[11px] text-muted-foreground">Sent with {instantCourierLabel(sale.deliveryVia)} (instant delivery)</p>}
            {sale.referral && <p className="pl-[18px] text-[11px] text-muted-foreground break-words">Came from: {sale.referral}</p>}
            {isPR(sale) && (
              <p className="pl-[18px] text-[11px] text-muted-foreground">
                Given free: {formatNPR(sale.items.reduce((n, i) => n + i.quantity * i.unitPrice, 0))} of goods, not counted as a sale.
              </p>
            )}
            {sale.paymentMethod === "COD" && sale.codAmount > 0 && (
              <p className="pl-[18px] text-[11px] text-muted-foreground">COD: {formatNPR(sale.codAmount)}</p>
            )}
            {sale.notes && (
              <p className="border-t border-border/50 pt-2 text-[11px]">
                <span className="font-semibold">Customer note:</span> {sale.notes}
              </p>
            )}
          </div>
        </div>
      )}
      {!editing && <ExchangeReturnBox sale={sale} onChanged={onSaved} />}
      {!editing && onItsWay && (
        <section aria-label={`Upaya tracking for ${sale.invoiceNumber}`} className="border-t border-border/50 px-4 pb-4 pt-3 sm:px-5 sm:pb-5">
          <h3 className="mb-2.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <Truck size={12} /> {sale.deliveryStatus === "RETURN_PROCESS" ? "Return on its way back" : "On its way with Upaya"}
          </h3>
          <CourierTrackingPanel sale={sale} onUpdated={() => void onSaved()} latest={3} />
        </section>
      )}
      {courierOpen && (
        <CourierDialog open={courierOpen} onClose={() => setCourierOpen(false)} sale={sale} onChanged={() => void onSaved()} />
      )}
      <ReturnDialog sale={returning ? sale : null} held={held} onClose={() => setReturning(false)} onDone={onSaved} />
      <ItemChangeConfirm
        open={confirmingItems}
        invoiceNumber={sale.invoiceNumber}
        changes={changes}
        onClose={() => setConfirmingItems(false)}
        onConfirm={commit}
      />
    </article>
  );
}
