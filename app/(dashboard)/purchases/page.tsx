"use client";

import { Skeleton } from "boneyard-js/react";
import { PurchasesFixture } from "@/components/skeletons/fixtures";
import React, { useState, useEffect } from "react";
import {
  Plus, X, CheckCircle, Clock, XCircle, Truck,
  ChevronDown, AlertTriangle, Package
} from "lucide-react";
import {
  getProducts, getSuppliers, getWarehouses,
  getPurchaseOrders, createPurchaseOrder, receivePurchaseOrder, cancelPurchaseOrder,
} from "@/app/actions";
import { cn } from "@/lib/utils";

type PurchaseItem = { productId: string; quantity: number; unitCost: number };

const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400",
  COMPLETED: "bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400",
  CANCELLED: "bg-red-100 dark:bg-red-950/30 text-red-600 dark:text-red-400",
};

const PAYMENT_STYLES: Record<string, string> = {
  UNPAID: "bg-red-100 dark:bg-red-950/30 text-red-600",
  PARTIAL: "bg-amber-100 dark:bg-amber-950/30 text-amber-600",
  PAID: "bg-emerald-100 dark:bg-emerald-950/30 text-emerald-600",
};

export default function PurchasesPage() {
  const [mounted, setMounted] = useState(false);
  const [products, setProducts] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [form, setForm] = useState({
    supplierId: "",
    warehouseId: "",
    notes: "",
    items: [{ productId: "", quantity: 1, unitCost: 0 }] as PurchaseItem[]
  });

  useEffect(() => {
    refresh().then(() => setMounted(true));
  }, []);

  async function refresh() {
    const [products, suppliers, whs, orders] = await Promise.all([
      getProducts(), getSuppliers(), getWarehouses(), getPurchaseOrders(),
    ]);
    setProducts(products);
    setSuppliers(suppliers);
    setWarehouses(whs);
    setOrders(orders);
    setForm(f => ({ ...f, warehouseId: whs[0]?.id ?? "", supplierId: "" }));
  }

  function addItem() {
    setForm(f => ({ ...f, items: [...f.items, { productId: "", quantity: 1, unitCost: 0 }] }));
  }

  function removeItem(idx: number) {
    setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
  }

  function updateItem(idx: number, field: string, val: any) {
    setForm(f => {
      const items = [...f.items];
      (items[idx] as any)[field] = val;
      if (field === "productId") {
        const prod = products.find(p => p.id === val);
        if (prod) items[idx].unitCost = prod.costPrice;
      }
      return { ...f, items };
    });
  }

  async function handleCreate() {
    if (!form.supplierId || !form.warehouseId || form.items.some(i => !i.productId || i.quantity <= 0)) return;
    const total = form.items.reduce((s, i) => s + i.quantity * i.unitCost, 0);
    await createPurchaseOrder({
      supplierId: form.supplierId,
      warehouseId: form.warehouseId,
      items: form.items,
      totalAmount: total,
      notes: form.notes || undefined,
    });
    setShowModal(false);
    await refresh();
  }

  async function changeStatus(poId: string, status: "COMPLETED" | "CANCELLED") {
    if (status === "COMPLETED") {
      await receivePurchaseOrder(poId);
    } else {
      await cancelPurchaseOrder(poId);
    }
    await refresh();
  }

  const formTotal = form.items.reduce((s, i) => s + i.quantity * i.unitCost, 0);

  if (!mounted) return (
    <Skeleton name="purchases" loading={true} fixture={<PurchasesFixture />}>
      <PurchasesFixture />
    </Skeleton>
  );

  return (
    <Skeleton name="purchases" loading={false} fixture={<PurchasesFixture />}>
      <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Purchase Orders</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Manage supplier restocking orders & receiving</p>
        </div>
        <button onClick={() => setShowModal(true)} className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold bg-primary text-primary-foreground rounded-xl shadow-md shadow-primary/10 hover:bg-primary/90 hover:scale-[1.02] transition-all cursor-pointer">
          <Plus size={16} />
          New Purchase Order
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: "Total Orders", val: orders.length, color: "blue" },
          { label: "Pending", val: orders.filter(o => o.status === "PENDING").length, color: "amber" },
          { label: "Completed", val: orders.filter(o => o.status === "COMPLETED").length, color: "emerald" },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border/80 p-5 rounded-2xl shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground">{s.label}</p>
              <p className="text-3xl font-black mt-1">{s.val}</p>
            </div>
            <Truck size={32} className={cn("opacity-10", s.color === "amber" ? "text-amber-500" : s.color === "emerald" ? "text-emerald-500" : "text-blue-500")} />
          </div>
        ))}
      </div>

      {/* Orders List */}
      <div className="space-y-3">
        {orders.map(po => {
          const supplier = suppliers.find(s => s.id === po.supplierId);
          const warehouse = warehouses.find(w => w.id === po.warehouseId);
          const isExpanded = expandedId === po.id;

          return (
            <div key={po.id} className="bg-card border border-border/80 rounded-2xl shadow-sm overflow-hidden">
              <div
                className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-5 cursor-pointer hover:bg-muted/10 transition-colors"
                onClick={() => setExpandedId(isExpanded ? null : po.id)}
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 border border-border/40 flex items-center justify-center shrink-0">
                    <Package size={18} className="text-primary/70" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2.5">
                      <p className="font-bold text-sm">{po.orderNumber}</p>
                      <span className={cn("text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full", STATUS_STYLES[po.status])}>{po.status}</span>
                      <span className={cn("text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full", PAYMENT_STYLES[po.paymentStatus])}>{po.paymentStatus}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{supplier?.companyName} · {warehouse?.name} · {new Date(po.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 md:gap-4 shrink-0">
                  <p className="text-lg font-extrabold">${po.totalAmount.toFixed(2)}</p>

                  {po.status === "PENDING" && (
                    <div className="flex gap-2">
                      <button
                        onClick={e => { e.stopPropagation(); changeStatus(po.id, "COMPLETED"); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 transition-colors cursor-pointer"
                      >
                        <CheckCircle size={11} /> Mark Received
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); changeStatus(po.id, "CANCELLED"); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold bg-muted text-muted-foreground border border-border rounded-xl hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/20 transition-colors cursor-pointer"
                      >
                        <XCircle size={11} /> Cancel
                      </button>
                    </div>
                  )}

                  <ChevronDown size={16} className={cn("text-muted-foreground transition-transform", isExpanded && "rotate-180")} />
                </div>
              </div>

              {isExpanded && (
                <div className="px-5 pb-5 border-t border-border/40">
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border/40 text-muted-foreground">
                          <th className="text-left pb-2 font-semibold">Product</th>
                          <th className="text-right pb-2 font-semibold">Qty</th>
                          <th className="text-right pb-2 font-semibold">Unit Cost</th>
                          <th className="text-right pb-2 font-semibold">Subtotal</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/30">
                        {po.items.map((item: any) => {
                          const prod = products.find(p => p.id === item.productId);
                          return (
                            <tr key={item.id}>
                              <td className="py-2.5 font-medium">{prod?.name ?? "—"}</td>
                              <td className="py-2.5 text-right">{item.quantity}</td>
                              <td className="py-2.5 text-right">${item.unitCost.toFixed(2)}</td>
                              <td className="py-2.5 text-right font-bold">${(item.quantity * item.unitCost).toFixed(2)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-border/60">
                          <td colSpan={3} className="pt-3 font-bold text-right pr-4">Total</td>
                          <td className="pt-3 font-extrabold text-right">${po.totalAmount.toFixed(2)}</td>
                        </tr>
                      </tfoot>
                    </table>
                    {po.notes && <p className="mt-3 text-[10px] text-muted-foreground italic">Notes: {po.notes}</p>}
                    {po.status === "COMPLETED" && (
                      <div className="mt-3 flex items-center gap-1.5 text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
                        <CheckCircle size={11} /> Stock was automatically received into {warehouse?.name} upon completion.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {orders.length === 0 && (
          <div className="flex flex-col items-center py-16 text-center text-muted-foreground gap-2 bg-card border border-border/80 rounded-2xl">
            <Truck size={36} className="opacity-30" />
            <p className="font-semibold text-sm">No purchase orders yet</p>
            <p className="text-xs">Click "New Purchase Order" to create your first restocking order.</p>
          </div>
        )}
      </div>

      {/* New PO Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-border">
              <h2 className="text-lg font-bold">New Purchase Order</h2>
              <button onClick={() => setShowModal(false)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-muted cursor-pointer"><X size={16} /></button>
            </div>
            <div className="p-6 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">Supplier</label>
                  <select value={form.supplierId} onChange={e => setForm(f => ({ ...f, supplierId: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer">
                    <option value="">Select supplier...</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.companyName}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">Destination Warehouse</label>
                  <select value={form.warehouseId} onChange={e => setForm(f => ({ ...f, warehouseId: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer">
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">Notes (optional)</label>
                  <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="e.g. Urgent restocking order" className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
                </div>
              </div>

              {/* Line Items */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-muted-foreground">Order Line Items</label>
                  <button onClick={addItem} className="flex items-center gap-1 text-[10px] font-bold text-primary hover:underline cursor-pointer"><Plus size={11} />Add Item</button>
                </div>
                {form.items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-6 space-y-1">
                      <label className="text-[10px] font-semibold text-muted-foreground">Product</label>
                      <select value={item.productId} onChange={e => updateItem(idx, "productId", e.target.value)} className="w-full px-2.5 py-2 rounded-xl border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer">
                        <option value="">Select...</option>
                        {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                    <div className="col-span-2 space-y-1">
                      <label className="text-[10px] font-semibold text-muted-foreground">Qty</label>
                      <input type="number" min={1} value={item.quantity} onChange={e => updateItem(idx, "quantity", parseInt(e.target.value) || 1)} className="w-full px-2.5 py-2 rounded-xl border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/20" />
                    </div>
                    <div className="col-span-3 space-y-1">
                      <label className="text-[10px] font-semibold text-muted-foreground">Unit Cost</label>
                      <input type="number" min={0} step={0.01} value={item.unitCost} onChange={e => updateItem(idx, "unitCost", parseFloat(e.target.value) || 0)} className="w-full px-2.5 py-2 rounded-xl border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/20" />
                    </div>
                    <div className="col-span-1">
                      {form.items.length > 1 && (
                        <button onClick={() => removeItem(idx)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 text-muted-foreground hover:text-red-500 cursor-pointer"><X size={13} /></button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-between items-center pt-2 border-t border-border/60">
                <span className="text-xs text-muted-foreground font-semibold">Order Total</span>
                <span className="text-lg font-extrabold">${formTotal.toFixed(2)}</span>
              </div>
            </div>
            <div className="flex gap-3 p-6 border-t border-border">
              <button onClick={() => setShowModal(false)} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-semibold hover:bg-muted cursor-pointer">Cancel</button>
              <button onClick={handleCreate} className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 cursor-pointer shadow-md shadow-primary/10">Create Purchase Order</button>
            </div>
          </div>
        </div>
      )}
      </div>
    </Skeleton>
  );
}
