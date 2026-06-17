"use client";

import React, { useState, useEffect, use } from "react";
import Link from "next/link";
import {
  ArrowLeft, User, Phone, MapPin, Edit2, Save, X,
  Receipt, ShoppingBag, Users,
} from "lucide-react";
import { getCustomers, updateCustomerInfo } from "@/app/actions";
import { cn } from "@/lib/utils";

export default function CustomerDetailPage({ params }: { params: Promise<{ key: string }> }) {
  const { key: rawKey } = use(params);
  const key = decodeURIComponent(rawKey);

  const [mounted, setMounted] = useState(false);
  const [customer, setCustomer] = useState<any | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", address: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    refresh().then(() => setMounted(true));
  }, []);

  async function refresh() {
    const customers = await getCustomers();
    const found = customers.find(c => c.key === key) ?? null;
    setCustomer(found);
    if (found) setForm({ name: found.name, phone: found.phone ?? "", address: found.address ?? "" });
  }

  async function handleSave() {
    if (!customer) return;
    setSaving(true);
    await updateCustomerInfo(customer.sales.map((s: any) => s.id), form);
    await refresh();
    setSaving(false);
    setEditing(false);
  }

  if (!mounted) {
    return <div className="h-64 rounded-2xl bg-muted animate-pulse" />;
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
        <Link href="/customers" className="w-9 h-9 flex items-center justify-center rounded-xl border border-border hover:bg-muted transition-colors cursor-pointer">
          <ArrowLeft size={16} />
        </Link>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">{customer.name}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{customer.orderCount} order{customer.orderCount !== 1 ? "s" : ""} · ${customer.totalSpent.toFixed(2)} total spent</p>
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
          {customer.sales.map((sale: any) => (
            <div key={sale.id} className="p-5 space-y-3">
              <div className="flex items-center gap-4">
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Receipt size={16} className="text-primary/70" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold">{sale.invoiceNumber}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                    <ShoppingBag size={10} />
                    {sale.items.length} item{sale.items.length !== 1 ? "s" : ""} · {sale.warehouse?.name} · {new Date(sale.createdAt).toLocaleString()}
                  </p>
                </div>
                <span className="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                  {sale.paymentMethod === "QR" ? "QR Payment" : "Cash on Delivery"}
                </span>
                <span className={cn("text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full", sale.paymentStatus === "PAID" ? "bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400" : "bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400")}>
                  {sale.paymentStatus}
                </span>
                <p className="text-sm font-extrabold w-20 text-right">${sale.totalAmount.toFixed(2)}</p>
              </div>
              <div className="pl-[52px] space-y-1">
                {sale.items.map((item: any) => (
                  <div key={item.id} className="flex justify-between text-xs text-muted-foreground">
                    <span>{item.product?.name ?? "—"} × {item.quantity}</span>
                    <span className="font-semibold">${(item.unitPrice * item.quantity).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
