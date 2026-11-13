"use client";

import React, { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Plus, X, CheckCircle, XCircle, Truck, ChevronDown, Package, Search,
} from "lucide-react";
import {
  createPurchaseOrder, receivePurchaseOrder, cancelPurchaseOrder,
} from "@/app/actions";
import { cn, formatNPR } from "@/lib/utils";
import { Pulse } from "@/components/shared/Pulse";
import { PurchaseOrderPlaceholder } from "@/components/skeletons/placeholders";
import { EmptyState } from "@/components/shared/EmptyState";
import { Modal } from "@/components/shared/Modal";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/shared/Button";
import { Dropdown } from "@/components/shared/Dropdown";
import { useResources } from "@/lib/useResources";
import { resources } from "@/lib/resources";
import { mutate } from "@/lib/mutate";
import { PAYMENT_STYLES } from "@/lib/orders";
import { useUrlState } from "@/lib/useUrlState";

type PurchaseItem = { productId: string; quantity: number; unitCost: number };

const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400",
  COMPLETED: "bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400",
  CANCELLED: "bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400",
};

const blankItem = (): PurchaseItem => ({ productId: "", quantity: 1, unitCost: 0 });
const blankForm = () => ({ supplierId: "", notes: "", items: [blankItem()] });
const BLANK_FORM_JSON = JSON.stringify(blankForm());

const fieldClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20";

export default function PurchasesPage() {
  const { products, suppliers, orders, loading, refetch } = useResources({
    products: resources.products,
    suppliers: resources.suppliers,
    orders: resources.orders,
  });
  const [showModal, setShowModal] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useUrlState("q");
  const [form, setForm] = useState(blankForm);
  const [creating, setCreating] = useState(false);
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{ id: string; orderNumber: string } | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter(po =>
      po.orderNumber.toLowerCase().includes(q) ||
      po.supplier.companyName.toLowerCase().includes(q)
    );
  }, [orders, search]);

  function addItem() {
    setForm(f => ({ ...f, items: [...f.items, blankItem()] }));
  }

  function removeItem(idx: number) {
    setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
  }

  function updateItem(idx: number, patch: Partial<PurchaseItem>) {
    setForm(f => ({ ...f, items: f.items.map((item, i) => (i === idx ? { ...item, ...patch } : item)) }));
  }

  function selectProduct(idx: number, productId: string) {
    updateItem(idx, { productId, unitCost: products.find(p => p.id === productId)?.costPrice ?? 0 });
  }

  const formTotal = form.items.reduce((s, i) => s + i.quantity * i.unitCost, 0);

  async function handleCreate() {
    if (!form.supplierId) return void toast.error("Please select a supplier.");
    if (form.items.some(i => !i.productId)) return void toast.error("Please select a product on every line.");
    if (form.items.some(i => i.quantity <= 0)) return void toast.error("Quantities must be at least 1.");

    setCreating(true);
    const result = await mutate(
      () => createPurchaseOrder({
        supplierId: form.supplierId,
        items: form.items,
        totalAmount: formTotal,
        notes: form.notes.trim() || undefined,
      }),
      { success: data => `Purchase order ${data.orderNumber} created.` }
    );
    setCreating(false);
    if (!result.ok) return;

    setShowModal(false);
    setForm(blankForm());
    await refetch();
  }

  async function markReceived(poId: string) {
    setReceivingId(poId);
    const result = await mutate(() => receivePurchaseOrder(poId), {
      loading: "Receiving stock…",
      success: data => `${data.units} units added to inventory from ${data.orderNumber}.`,
    });
    if (result.ok) await refetch();
    setReceivingId(null);
  }

  async function confirmCancel() {
    if (!cancelTarget) return;
    const result = await mutate(() => cancelPurchaseOrder(cancelTarget.id), {
      success: data => `${data.orderNumber} was cancelled.`,
    });
    setCancelOpen(false);
    if (result.ok) await refetch();
  }

  const newOrderButton = (
    <Button onClick={() => setShowModal(true)} className="shrink-0">
      <Plus size={16} /> New Purchase Order
    </Button>
  );

  return (
<>
      <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Purchase Orders</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Manage supplier restocking orders &amp; receiving</p>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search order # or supplier..."
              aria-label="Search purchase orders"
              className="w-full pl-8 pr-3 py-2.5 text-sm rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          {newOrderButton}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: "Total Orders", val: orders.length, color: "text-blue-500" },
          { label: "Pending", val: orders.filter(o => o.status === "PENDING").length, color: "text-amber-500" },
          { label: "Completed", val: orders.filter(o => o.status === "COMPLETED").length, color: "text-emerald-500" },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border/80 p-5 rounded-2xl shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground">{s.label}</p>
              {loading ? <Pulse className="h-9 w-12 mt-1" /> : <p className="text-3xl font-black mt-1">{s.val}</p>}
            </div>
            <Truck size={32} className={cn("opacity-10", s.color)} />
          </div>
        ))}
      </div>

      {/* Orders List */}
      <div className="space-y-3">
        {loading && Array.from({ length: 4 }).map((_, i) => <PurchaseOrderPlaceholder key={i} />)}
        {!loading && filteredOrders.length === 0 && (
          <div className="bg-card border border-border/80 rounded-2xl">
            {orders.length === 0 ? (
              <EmptyState
                icon={Truck}
                title="No purchase orders yet"
                description="Create a purchase order to restock from your suppliers."
                action={newOrderButton}
              />
            ) : (
              <EmptyState icon={Search} title="No matching orders" description="Try a different search term." />
            )}
          </div>
        )}
        {!loading && filteredOrders.map(po => {
          const isExpanded = expandedId === po.id;

          return (
            <div key={po.id} className="bg-card border border-border/80 rounded-2xl shadow-sm overflow-hidden">
              <div
                className="data-row flex flex-col md:flex-row md:items-center justify-between gap-3 p-5 cursor-pointer"
                onClick={() => setExpandedId(isExpanded ? null : po.id)}
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 border border-border/40 flex items-center justify-center shrink-0">
                    <Package size={18} className="text-primary/70" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <p className="font-bold text-sm">{po.orderNumber}</p>
                      <span className={cn("text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full", STATUS_STYLES[po.status])}>{po.status}</span>
                      <span className={cn("text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full", PAYMENT_STYLES[po.paymentStatus])}>{po.paymentStatus}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{po.supplier.companyName} · {new Date(po.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 md:gap-4 shrink-0">
                  <p className="text-lg font-extrabold">{formatNPR(po.totalAmount)}</p>

                  {po.status === "PENDING" && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={e => { e.stopPropagation(); void markReceived(po.id); }}
                        loading={receivingId === po.id}
                        className="px-3 py-2 text-[12px] font-bold bg-emerald-700 hover:bg-emerald-800 shadow-none"
                      >
                        {receivingId !== po.id && <CheckCircle size={12} />} Mark Received
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={e => { e.stopPropagation(); setCancelTarget({ id: po.id, orderNumber: po.orderNumber }); setCancelOpen(true); }}
                        disabled={receivingId === po.id}
                        className="px-3 py-2 text-[12px] font-bold text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
                      >
                        <XCircle size={12} /> Cancel
                      </Button>
                    </div>
                  )}

                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    aria-label={`${isExpanded ? "Hide" : "Show"} items in ${po.orderNumber}`}
                    onClick={e => { e.stopPropagation(); setExpandedId(isExpanded ? null : po.id); }}
                    className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-muted"
                  >
                    <ChevronDown size={16} className={cn("text-muted-foreground transition-transform", isExpanded && "rotate-180")} />
                  </button>
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
                        {po.items.map(item => (
                          <tr key={item.id}>
                            <td className="py-2.5 font-medium">{item.product.name}</td>
                            <td className="py-2.5 text-right">{item.quantity}</td>
                            <td className="py-2.5 text-right">{formatNPR(item.unitCost)}</td>
                            <td className="py-2.5 text-right font-bold">{formatNPR(item.quantity * item.unitCost)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-border/60">
                          <td colSpan={3} className="pt-3 font-bold text-right pr-4">Total</td>
                          <td className="pt-3 font-extrabold text-right">{formatNPR(po.totalAmount)}</td>
                        </tr>
                      </tfoot>
                    </table>
                    {po.notes && <p className="mt-3 text-[11px] text-muted-foreground italic">Notes: {po.notes}</p>}
                    {po.status === "COMPLETED" && (
                      <div className="mt-3 flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
                        <CheckCircle size={11} /> Stock was automatically received into inventory upon completion.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* New PO Modal */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title="New Purchase Order"
        size="lg"
        busy={creating}
        dirty={JSON.stringify(form) !== BLANK_FORM_JSON}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowModal(false)} disabled={creating} className="flex-1">Cancel</Button>
            <Button onClick={handleCreate} loading={creating} className="flex-1">
              {creating ? "Creating…" : "Create Purchase Order"}
            </Button>
          </>
        }
      >
        <div className="p-5 sm:p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Supplier</label>
              <Dropdown
                aria-label="Supplier"
                value={form.supplierId}
                onChange={v => setForm(f => ({ ...f, supplierId: v }))}
                placeholder="Select supplier..."
                options={suppliers.map(s => ({ value: s.id, label: s.companyName }))}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="po-notes" className="text-xs font-semibold text-muted-foreground">Notes (optional)</label>
              <input id="po-notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="e.g. Urgent restocking order" className={fieldClass} />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">Order Line Items</span>
              <button type="button" onClick={addItem} className="flex items-center gap-1 text-[12px] font-bold text-primary hover:underline"><Plus size={12} />Add Item</button>
            </div>
            {form.items.map((item, idx) => (
              <div key={idx} className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-end p-2.5 sm:p-0 rounded-xl border border-border/40 sm:border-0 bg-muted/10 sm:bg-transparent">
                <div className="col-span-2 sm:col-span-6 space-y-1">
                  <span className="text-[11px] font-semibold text-muted-foreground">Product</span>
                  <Dropdown
                    aria-label={`Product for line ${idx + 1}`}
                    value={item.productId}
                    onChange={v => selectProduct(idx, v)}
                    placeholder="Select..."
                    options={products.map(p => ({ value: p.id, label: p.name }))}
                    triggerClassName="px-2.5 py-2.5 text-xs"
                  />
                </div>
                <div className="col-span-1 sm:col-span-2 space-y-1">
                  <span className="text-[11px] font-semibold text-muted-foreground">Qty</span>
                  <input aria-label={`Quantity for line ${idx + 1}`} type="number" inputMode="numeric" min={1} value={item.quantity || ""} onChange={e => updateItem(idx, { quantity: Math.max(0, parseInt(e.target.value) || 0) })} className={cn(fieldClass, "px-2.5 text-xs")} />
                </div>
                <div className="col-span-1 sm:col-span-3 space-y-1">
                  <span className="text-[11px] font-semibold text-muted-foreground">Unit Cost</span>
                  <input aria-label={`Unit cost for line ${idx + 1}`} type="number" inputMode="decimal" min={0} step={0.01} value={item.unitCost || ""} onChange={e => updateItem(idx, { unitCost: Math.max(0, parseFloat(e.target.value) || 0) })} className={cn(fieldClass, "px-2.5 text-xs")} />
                </div>
                <div className="col-span-2 sm:col-span-1 flex justify-end">
                  {form.items.length > 1 && (
                    <button type="button" onClick={() => removeItem(idx)} aria-label={`Remove line ${idx + 1}`} className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 text-muted-foreground hover:text-red-500"><X size={14} /></button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-between items-center pt-2 border-t border-border/60">
            <span className="text-xs text-muted-foreground font-semibold">Order Total</span>
            <span className="text-lg font-extrabold">{formatNPR(formTotal)}</span>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={confirmCancel}
        title={`Cancel ${cancelTarget?.orderNumber ?? "order"}?`}
        description="A cancelled order can't be received or reopened. You would need to create a new one."
        confirmLabel="Cancel Order"
        cancelLabel="Keep Order"
      />
      </div>
</>
  );
}
