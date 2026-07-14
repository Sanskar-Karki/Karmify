"use client";

import { Skeleton } from "boneyard-js/react";
import { CustomerDetailFixture } from "@/components/skeletons/fixtures";
import React, { useState, useEffect, use } from "react";
import Link from "next/link";
import {
  ArrowLeft, User, Phone, MapPin, Edit2, Save, X,
  Receipt, ShoppingBag, Users, DollarSign, Globe,
} from "lucide-react";
import { updateCustomerInfo, updateSaleDetails } from "@/app/actions";
import { cn, formatNPR } from "@/lib/utils";
import { fetchResource, getCached, invalidate } from "@/lib/resourceCache";
import { resources } from "@/lib/resources";

// Same resource/key the customers list page's future use would share — one
// cached aggregation instead of two pages each fetching their own copy.
const CACHE_KEY = resources.customers.key;

const DELIVERY_STATUSES = [
  { value: "IN_PROCESS", label: "In Process" },
  { value: "DELIVERED", label: "Delivered" },
  { value: "RETURN_PROCESS", label: "Return Process" },
  { value: "RETURNED", label: "Returned" },
];

const DELIVERY_STYLES: Record<string, string> = {
  IN_PROCESS: "bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400",
  DELIVERED: "bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400",
  RETURN_PROCESS: "bg-orange-100 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400",
  RETURNED: "bg-red-100 dark:bg-red-950/30 text-red-600 dark:text-red-400",
};

export default function CustomerDetailPage({ params }: { params: Promise<{ key: string }> }) {
  const { key: rawKey } = use(params);
  const key = decodeURIComponent(rawKey);

  const cachedCustomers = getCached<any[]>(CACHE_KEY);
  const cachedFound = cachedCustomers?.find(c => c.key === key) ?? null;

  const [mounted, setMounted] = useState(!!cachedCustomers);
  const [customer, setCustomer] = useState<any | null>(cachedFound);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: cachedFound?.name ?? "", phone: cachedFound?.phone ?? "", address: cachedFound?.address ?? "" });
  const [saving, setSaving] = useState(false);

  const [editingSaleId, setEditingSaleId] = useState<string | null>(null);
  const [saleForm, setSaleForm] = useState({ totalAmount: "", customerAddress: "", deliveryStatus: "IN_PROCESS", paymentMethod: "COD" });
  const [savingSale, setSavingSale] = useState(false);

  useEffect(() => {
    refresh().then(() => setMounted(true));
  }, []);

  async function refresh(force = false) {
    if (force) invalidate(CACHE_KEY);
    const customers = await fetchResource<any[]>(CACHE_KEY, resources.customers.fetcher, { force });
    const found = customers.find(c => c.key === key) ?? null;
    setCustomer(found);
    if (found) setForm({ name: found.name, phone: found.phone ?? "", address: found.address ?? "" });
  }

  async function handleSave() {
    if (!customer) return;
    setSaving(true);
    await updateCustomerInfo(customer.sales.map((s: any) => s.id), form);
    // Sales rows changed underneath both the raw "sales" list and this
    // "customers" aggregation — invalidate both so either page's next visit
    // refetches instead of serving stale data.
    invalidate("sales", CACHE_KEY);
    await refresh(true);
    setSaving(false);
    setEditing(false);
  }

  function startEditSale(sale: any) {
    setEditingSaleId(sale.id);
    setSaleForm({
      totalAmount: String(sale.totalAmount),
      customerAddress: sale.customerAddress ?? "",
      deliveryStatus: sale.deliveryStatus ?? "IN_PROCESS",
      paymentMethod: sale.paymentMethod ?? "COD",
    });
  }

  async function handleSaveSale(saleId: string) {
    setSavingSale(true);
    await updateSaleDetails(saleId, {
      totalAmount: parseFloat(saleForm.totalAmount) || 0,
      customerAddress: saleForm.customerAddress,
      deliveryStatus: saleForm.deliveryStatus as any,
      paymentMethod: saleForm.paymentMethod as any,
    });
    invalidate("sales", CACHE_KEY);
    await refresh(true);
    setSavingSale(false);
    setEditingSaleId(null);
  }

  if (!mounted) return (
    <Skeleton name="customer-detail" loading={true} fixture={<CustomerDetailFixture />} fallback={<CustomerDetailFixture />}>
      <CustomerDetailFixture />
    </Skeleton>
  );

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
    <Skeleton name="customer-detail" loading={false} fixture={<CustomerDetailFixture />} fallback={<CustomerDetailFixture />}>
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <Link href="/customers" className="w-9 h-9 flex items-center justify-center rounded-xl border border-border hover:bg-muted transition-colors cursor-pointer">
          <ArrowLeft size={16} />
        </Link>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">{customer.name}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{customer.orderCount} order{customer.orderCount !== 1 ? "s" : ""} · {formatNPR(customer.totalSpent)} total spent</p>
        </div>
      </div>

      {/* Customer Info Card */}
      <div className="bg-card border border-border/80 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-6 border-b border-border/60 flex items-center justify-between">
          <h2 className="font-bold text-base">Customer Details</h2>
          {!editing ? (
            <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-primary/10 text-primary border border-primary/20 rounded-xl hover:bg-primary/20 transition-colors cursor-pointer">
              <Edit2 size={13} /> Edit
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => { setEditing(false); setForm({ name: customer.name, phone: customer.phone ?? "", address: customer.address ?? "" }); }} className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-muted text-muted-foreground border border-border rounded-xl hover:bg-muted/70 transition-colors cursor-pointer">
                <X size={13} /> Cancel
              </button>
              <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50">
                <Save size={13} /> {saving ? "Saving..." : "Save"}
              </button>
            </div>
          )}
        </div>
        <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-5">
          {[
            { label: "Name", icon: User, key: "name", placeholder: "Customer name" },
            { label: "Phone", icon: Phone, key: "phone", placeholder: "+977 9841..." },
            { label: "Address", icon: MapPin, key: "address", placeholder: "Delivery address" },
          ].map(field => (
            <div key={field.key} className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <field.icon size={12} />{field.label}
              </label>
              {editing ? (
                <input
                  value={(form as any)[field.key]}
                  onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))}
                  placeholder={field.placeholder}
                  className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              ) : (
                <p className={cn("text-sm font-semibold py-2.5", !(customer as any)[field.key] && "text-muted-foreground/50 italic font-normal")}>
                  {(customer as any)[field.key] || "Not provided"}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Sales History */}
      <div className="bg-card border border-border/80 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-6 border-b border-border/60">
          <h2 className="font-bold text-base">Sales History</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{customer.sales.length} invoice{customer.sales.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="divide-y divide-border/40">
          {customer.sales.map((sale: any) => {
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
                      <ShoppingBag size={10} />
                      {sale.items.length} item{sale.items.length !== 1 ? "s" : ""} · {sale.warehouse?.name} · {new Date(sale.createdAt).toLocaleString()}
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
                  {!isEditingSale ? (
                    <button onClick={() => startEditSale(sale)} className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-muted transition-colors cursor-pointer shrink-0">
                      <Edit2 size={12} />
                    </button>
                  ) : (
                    <div className="flex gap-1.5 shrink-0">
                      <button onClick={() => setEditingSaleId(null)} className="w-8 h-8 flex items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground hover:bg-muted/70 transition-colors cursor-pointer">
                        <X size={12} />
                      </button>
                      <button onClick={() => handleSaveSale(sale.id)} disabled={savingSale} className="w-8 h-8 flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50">
                        <Save size={12} />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {isEditingSale && (
                <div className="pl-0 sm:pl-[52px] grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5"><DollarSign size={12} />Price</label>
                    <input
                      type="number"
                      step="0.01"
                      value={saleForm.totalAmount}
                      onChange={e => setSaleForm(f => ({ ...f, totalAmount: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5"><MapPin size={12} />Location</label>
                    <input
                      value={saleForm.customerAddress}
                      onChange={e => setSaleForm(f => ({ ...f, customerAddress: e.target.value }))}
                      placeholder="Delivery address"
                      className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">Delivery Status</label>
                    <select
                      value={saleForm.deliveryStatus}
                      onChange={e => setSaleForm(f => ({ ...f, deliveryStatus: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                    >
                      {DELIVERY_STATUSES.map(d => (
                        <option key={d.value} value={d.value}>{d.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">Payment Method</label>
                    <select
                      value={saleForm.paymentMethod}
                      onChange={e => setSaleForm(f => ({ ...f, paymentMethod: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                    >
                      <option value="COD">Cash on Delivery</option>
                      <option value="QR">QR Payment</option>
                    </select>
                  </div>
                </div>
              )}

              <div className="pl-0 sm:pl-[52px] space-y-1">
                {sale.items.map((item: any) => (
                  <div key={item.id} className="flex justify-between text-xs text-muted-foreground">
                    <span>{item.product?.name ?? "—"} × {item.quantity}</span>
                    <span className="font-semibold">{formatNPR(item.unitPrice * item.quantity)}</span>
                  </div>
                ))}
              </div>
            </div>
            );
          })}
        </div>
      </div>
    </div>
    </Skeleton>
  );
}
