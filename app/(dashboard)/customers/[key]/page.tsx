"use client";

import React, { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, User, Phone, MapPin, Edit2, Save, X,
  Receipt, ShoppingBag, Users, DollarSign, Globe, Tag, Copy,
} from "lucide-react";
import { toast } from "sonner";
import { updateCustomerInfo, updateSaleDetails } from "@/app/actions";
import { cn, formatNPR } from "@/lib/utils";
import { resources } from "@/lib/resources";
import { useResources } from "@/lib/useResources";
import { mutate } from "@/lib/mutate";
import { contactKey, customerKey, DELIVERY_STATUSES, DELIVERY_STYLES, itemOptionsText } from "@/lib/orders";
import { parseCustomerCode } from "@/lib/customerIdentity";
import { useStoreProfile } from "@/lib/storeProfile";
import { Dropdown } from "@/components/shared/Dropdown";
import { Button } from "@/components/shared/Button";
import { CustomerLabelDialog } from "@/components/shared/CustomerLabelDialog";
import { ReceiptDialog } from "@/components/shared/ReceiptDialog";
import { CustomerDetailPlaceholder } from "@/components/skeletons/placeholders";
import type { Sale } from "@/lib/types";

type DeliveryStatus = "IN_PROCESS" | "DELIVERED" | "RETURN_PROCESS" | "RETURNED" | "CANCELLED";

const CUSTOMER_FIELDS = [
  { label: "Name", icon: User, key: "name", placeholder: "Customer name" },
  { label: "Phone", icon: Phone, key: "phone", placeholder: "Phone number" },
  { label: "Address", icon: MapPin, key: "address", placeholder: "Delivery address" },
] as const;

const PAYMENT_METHODS = [
  { value: "COD", label: "Cash on Delivery" },
  { value: "QR", label: "QR Payment" },
];

const fieldClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20";
const iconButton = "w-8 h-8 flex items-center justify-center rounded-lg transition-colors shrink-0";

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

  const [editingSaleId, setEditingSaleId] = useState<string | null>(null);
  const [saleForm, setSaleForm] = useState({ totalAmount: "", customerAddress: "", deliveryStatus: "IN_PROCESS", paymentMethod: "COD" });
  const [savingSale, setSavingSale] = useState(false);

  function startEditing() {
    if (!customer) return;
    setForm({ name: customer.name, phone: customer.phone ?? "", address: customer.address ?? "" });
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

  async function copyCustomerId(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(`Copied ${code}`, { id: "copied-customer-id" });
    } catch {
      toast.error("Couldn't copy. Select the ID and copy it manually.");
    }
  }

  function startEditSale(sale: Sale) {
    setEditingSaleId(sale.id);
    setSaleForm({
      totalAmount: String(sale.totalAmount),
      customerAddress: sale.customerAddress ?? "",
      deliveryStatus: sale.deliveryStatus ?? "IN_PROCESS",
      paymentMethod: sale.paymentMethod ?? "COD",
    });
  }

  async function handleSaveSale(sale: Sale) {
    setSavingSale(true);
    const result = await mutate(
      () => updateSaleDetails(sale.id, {
        totalAmount: parseFloat(saleForm.totalAmount) || 0,
        customerAddress: saleForm.customerAddress,
        deliveryStatus: saleForm.deliveryStatus as DeliveryStatus,
        paymentMethod: saleForm.paymentMethod as "COD" | "QR",
      }),
      { success: `${sale.invoiceNumber} updated.` }
    );
    if (result.ok) {
      await refetch();
      setEditingSaleId(null);
    }
    setSavingSale(false);
  }

  if (loading) {
    return <CustomerDetailPlaceholder />;
  }

  if (!customer) {
    return (
      <div className="flex flex-col items-center py-16 text-center text-muted-foreground gap-2 bg-card border border-border/80 rounded-2xl">
        <Users size={36} className="opacity-30" />
        <p className="font-semibold text-sm">Customer not found</p>
        <Link href="/customers" className="text-xs text-primary font-semibold hover:underline mt-2">Back to Customers</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <Link href="/customers" aria-label="Back to customers" className="w-9 h-9 flex items-center justify-center rounded-xl border border-border hover:bg-muted transition-colors shrink-0">
          <ArrowLeft size={16} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-extrabold tracking-tight truncate">{customer.name}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{customer.orderCount} order{customer.orderCount !== 1 ? "s" : ""} · {formatNPR(customer.totalSpent)} total spent</p>
        </div>
        {customer.code && (
          <button
            type="button"
            onClick={() => copyCustomerId(customer.code as string)}
            aria-label={`Copy customer ID ${customer.code}`}
            title="Copy customer ID"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border bg-card text-xs font-bold font-mono whitespace-nowrap hover:bg-muted transition-colors shrink-0"
          >
            {customer.code} <Copy size={12} className="text-muted-foreground" />
          </button>
        )}
      </div>

      {/* Customer Info Card */}
      <div className="bg-card border border-border/80 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-5 sm:p-6 border-b border-border/60 flex items-center justify-between gap-3">
          <h2 className="font-bold text-base">Customer Details</h2>
          {!editing ? (
            <button type="button" onClick={startEditing} className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-primary/10 text-primary border border-primary/20 rounded-xl hover:bg-primary/20 transition-colors">
              <Edit2 size={13} /> Edit
            </button>
          ) : (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setEditing(false)} disabled={saving} className="px-3 py-2 text-xs">
                <X size={13} /> Cancel
              </Button>
              <Button onClick={handleSave} loading={saving} className="px-3 py-2 text-xs">
                {!saving && <Save size={13} />} {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          )}
        </div>
        <div className="p-5 sm:p-6 grid grid-cols-1 md:grid-cols-3 gap-5">
          {CUSTOMER_FIELDS.map(field => (
            <div key={field.key} className="space-y-1.5">
              <label htmlFor={`customer-${field.key}`} className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <field.icon size={12} />{field.label}
              </label>
              {editing ? (
                <input
                  id={`customer-${field.key}`}
                  value={form[field.key]}
                  onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))}
                  placeholder={field.placeholder}
                  className={fieldClass}
                />
              ) : (
                <p className={cn("text-sm font-semibold py-2.5 break-words", !customer[field.key] && "text-muted-foreground italic font-normal")}>
                  {customer[field.key] || "Not provided"}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Sales History */}
      <div className="bg-card border border-border/80 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-5 sm:p-6 border-b border-border/60">
          <h2 className="font-bold text-base">Sales History</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{customer.sales.length} invoice{customer.sales.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="divide-y divide-border/40">
          {customer.sales.map(sale => {
            const isEditingSale = editingSaleId === sale.id;
            return (
            <div key={sale.id} className="p-5 space-y-3">
              <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                <div className="flex items-center gap-3 min-w-0 flex-1 basis-full sm:basis-0">
                  <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <Receipt size={16} className="text-primary/70" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold flex items-center gap-1.5">
                      {sale.invoiceNumber}
                      {sale.source === "website" && (
                        <span className="flex items-center gap-1 text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded-full whitespace-nowrap bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400">
                          <Globe size={9} /> Website
                        </span>
                      )}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                      <ShoppingBag size={10} className="shrink-0" />
                      <span className="truncate">{sale.items.length} item{sale.items.length !== 1 ? "s" : ""} · {sale.warehouse.name} · {new Date(sale.createdAt).toLocaleString()}</span>
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                  <span className="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {sale.paymentMethod === "QR" ? "QR Payment" : "Cash on Delivery"}
                  </span>
                  {!isEditingSale && (
                    <span className={cn("text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full", DELIVERY_STYLES[sale.deliveryStatus] ?? DELIVERY_STYLES.IN_PROCESS)}>
                      {DELIVERY_STATUSES.find(d => d.value === sale.deliveryStatus)?.label ?? "In Process"}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 ml-auto shrink-0">
                  {!isEditingSale && <p className="text-sm font-extrabold text-right">{formatNPR(sale.totalAmount)}</p>}
                  {!isEditingSale && (<>
                    <button type="button" onClick={() => { setLabelSale(sale); setShowLabel(true); }} aria-label={`Print label for ${sale.invoiceNumber}`} title="Print label" className={cn(iconButton, "border border-border hover:bg-muted")}>
                      <Tag size={12} />
                    </button>
                    <button type="button" onClick={() => setReceiptSale(sale)} aria-label={`Print receipt for ${sale.invoiceNumber}`} title="Print receipt" className={cn(iconButton, "border border-border hover:bg-muted")}>
                      <Receipt size={12} />
                    </button>
                  </>)}
                  {!isEditingSale ? (
                    <button type="button" onClick={() => startEditSale(sale)} aria-label={`Edit ${sale.invoiceNumber}`} className={cn(iconButton, "border border-border hover:bg-muted")}>
                      <Edit2 size={12} />
                    </button>
                  ) : (
                    <div className="flex gap-1.5 shrink-0">
                      <button type="button" onClick={() => setEditingSaleId(null)} disabled={savingSale} aria-label="Cancel editing" className={cn(iconButton, "border border-border bg-muted text-muted-foreground hover:bg-muted/70")}>
                        <X size={12} />
                      </button>
                      <button type="button" onClick={() => handleSaveSale(sale)} disabled={savingSale} aria-label="Save invoice" className={cn(iconButton, "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50")}>
                        <Save size={12} />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {isEditingSale && (
                <div className="pl-0 sm:pl-[52px] grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                  <div className="space-y-1.5">
                    <label htmlFor={`price-${sale.id}`} className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5"><DollarSign size={12} />Price</label>
                    <input id={`price-${sale.id}`} type="number" inputMode="decimal" min={0} step="0.01" value={saleForm.totalAmount} onChange={e => setSaleForm(f => ({ ...f, totalAmount: e.target.value }))} className={cn(fieldClass, "py-2")} />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor={`address-${sale.id}`} className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5"><MapPin size={12} />Location</label>
                    <input id={`address-${sale.id}`} value={saleForm.customerAddress} onChange={e => setSaleForm(f => ({ ...f, customerAddress: e.target.value }))} placeholder="Delivery address" className={cn(fieldClass, "py-2")} />
                  </div>
                  <div className="space-y-1.5">
                    <span className="text-xs font-semibold text-muted-foreground">Delivery Status</span>
                    <Dropdown aria-label="Delivery status" value={saleForm.deliveryStatus} onChange={v => setSaleForm(f => ({ ...f, deliveryStatus: v }))} options={DELIVERY_STATUSES} triggerClassName="py-2" />
                  </div>
                  <div className="space-y-1.5">
                    <span className="text-xs font-semibold text-muted-foreground">Payment Method</span>
                    <Dropdown aria-label="Payment method" value={saleForm.paymentMethod} onChange={v => setSaleForm(f => ({ ...f, paymentMethod: v }))} options={PAYMENT_METHODS} triggerClassName="py-2" />
                  </div>
                </div>
              )}

              <div className="pl-0 sm:pl-[52px] space-y-1">
                {sale.items.map(item => (
                  <div key={item.id} className="text-xs text-muted-foreground">
                    <div className="flex justify-between gap-3">
                      <span className="min-w-0 break-words font-medium text-foreground">{item.product.name}</span>
                      <span className="font-semibold shrink-0">{formatNPR(item.unitPrice * item.quantity)}</span>
                    </div>
                    <p className="text-[11px]">
                      {[itemOptionsText(item), `${item.quantity} × ${formatNPR(item.unitPrice)}`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                ))}
                {sale.notes && (
                  <p className="pt-1 text-xs text-foreground break-words">
                    <span className="font-semibold">Customer note:</span> {sale.notes}
                  </p>
                )}
              </div>
            </div>
            );
          })}
        </div>
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
