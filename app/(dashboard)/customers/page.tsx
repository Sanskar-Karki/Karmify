"use client";

import { Skeleton } from "boneyard-js/react";
import { CustomersFixture } from "@/components/skeletons/fixtures";
import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  Search, Users, ChevronRight, Plus, Edit2, Save, X, Calendar, RefreshCw, Globe, Trash2,
  ShoppingBag, Wallet, Truck,
} from "lucide-react";
import { updateSaleDetails, syncWebsiteOrders, deleteSales } from "@/app/actions";
import { cn, formatNPR } from "@/lib/utils";
import { Pulse } from "@/components/shared/Pulse";
import { EmptyState } from "@/components/shared/EmptyState";
import { useResources } from "@/lib/useResources";
import { resources } from "@/lib/resources";
import { invalidate } from "@/lib/resourceCache";
import { toast } from "sonner";
import { Dropdown } from "@/components/shared/Dropdown";

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

function customerKey(sale: any) {
  return (sale.customerEmail || sale.customerPhone || sale.customerName || "unknown").toLowerCase();
}

const DATE_FILTERS = [
  { value: "all", label: "All Time" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "3days", label: "Last 3 Days" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "custom", label: "Custom" },
];

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function isWithinDateFilter(dateStr: string | Date, filter: string, customStart: string, customEnd: string) {
  if (filter === "all") return true;
  const date = new Date(dateStr);
  const now = new Date();
  const today = startOfDay(now);

  if (filter === "today") {
    return date >= today;
  }
  if (filter === "yesterday") {
    const yStart = new Date(today);
    yStart.setDate(yStart.getDate() - 1);
    return date >= yStart && date < today;
  }
  if (filter === "3days") {
    const start = new Date(today);
    start.setDate(start.getDate() - 2);
    return date >= start;
  }
  if (filter === "week") {
    const start = new Date(today);
    start.setDate(start.getDate() - start.getDay());
    return date >= start;
  }
  if (filter === "month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return date >= start;
  }
  if (filter === "custom") {
    if (!customStart && !customEnd) return true;
    if (customStart && date < startOfDay(new Date(customStart))) return false;
    if (customEnd) {
      const end = startOfDay(new Date(customEnd));
      end.setDate(end.getDate() + 1);
      if (date >= end) return false;
    }
    return true;
  }
  return true;
}

export default function CustomersPage() {
  const { sales, loading, refetch } = useResources({ sales: resources.sales });
  const [search, setSearch] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    const filter = params.get("filter");

    if (q) setSearch(q);
    if (filter) setDateFilter(filter);
  }, []);

  const [dateFilter, setDateFilter] = useState("all");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ customerName: "", customerPhone: "", customerAddress: "", codAmount: "", deliveryAmount: "", deliveryStatus: "IN_PROCESS" });
  const [saving, setSaving] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<"all" | "pos" | "website">("all");
  const [syncing, setSyncing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const filtered = sales.filter(s =>
    ((s.customerName ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (s.customerPhone ?? "").toLowerCase().includes(search.toLowerCase()) ||
      s.invoiceNumber.toLowerCase().includes(search.toLowerCase())) &&
    isWithinDateFilter(s.createdAt, dateFilter, customStart, customEnd) &&
    (sourceFilter === "all" || (s.source ?? "pos") === sourceFilter)
  );

  async function handleSyncWebsiteOrders() {
    setSyncing(true);
    try {
      const result = await syncWebsiteOrders();
      if (result.imported > 0) {
        invalidate("customers");
        invalidate("sales");
        await refetch();
      }
      if (result.errors.length > 0) {
        toast.error(`Synced ${result.imported} order(s), ${result.errors.length} failed. See console for details.`);
        console.error("Website order sync errors:", result.errors);
      } else if (result.imported === 0) {
        toast.info("No new website orders to import.");
      } else {
        toast.success(`Imported ${result.imported} website order(s)${result.unmatchedItems ? ` (${result.unmatchedItems} item(s) unmatched)` : ""}.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to sync website orders.");
    } finally {
      setSyncing(false);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds(prev =>
      prev.size === filtered.length ? new Set() : new Set(filtered.map(s => s.id))
    );
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (!window.confirm(`Delete ${count} selected order${count > 1 ? "s" : ""}? This cannot be undone.`)) {
      return;
    }
    setDeleting(true);
    try {
      const result = await deleteSales(Array.from(selectedIds));
      invalidate("customers");
      invalidate("sales");
      await refetch();
      setSelectedIds(new Set());
      toast.success(`Deleted ${result.deleted} order(s).`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete orders.");
    } finally {
      setDeleting(false);
    }
  }

  const totalOrders = filtered.length;
  const totalRevenue = filtered.reduce((s, c) => s + c.totalAmount, 0);
  const pendingDeliveries = filtered.filter(
    s => s.deliveryStatus === "IN_PROCESS" || s.deliveryStatus === "RETURN_PROCESS"
  ).length;

  function startEdit(sale: any) {
    setEditingId(sale.id);
    setEditForm({
      customerName: sale.customerName ?? "",
      customerPhone: sale.customerPhone ?? "",
      customerAddress: sale.customerAddress ?? "",
      codAmount: String(sale.codAmount ?? sale.totalAmount),
      deliveryAmount: String(sale.deliveryAmount ?? 0),
      deliveryStatus: sale.deliveryStatus ?? "IN_PROCESS",
    });
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(sale: any) {
    setSaving(true);
    await updateSaleDetails(sale.id, {
      customerName: editForm.customerName,
      customerPhone: editForm.customerPhone,
      customerAddress: editForm.customerAddress,
      codAmount: parseFloat(editForm.codAmount) || 0,
      deliveryAmount: parseFloat(editForm.deliveryAmount) || 0,
      deliveryStatus: editForm.deliveryStatus as any,
    });
    // The customer detail page caches its own per-customer aggregation under
    // the "customers" key — invalidate it too so an edit here doesn't leave
    // stale data behind when the user drills into a customer next.
    invalidate("customers");
    await refetch();
    setSaving(false);
    setEditingId(null);
  }

  return (
    <Skeleton name="customers" loading={false} fixture={<CustomersFixture />} fallback={<CustomersFixture />}>
      <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Customers & Orders</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Every order placed, with delivery & payment status</p>
        </div>
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:w-72">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, phone or order ID..."
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <button
            onClick={handleSyncWebsiteOrders}
            disabled={syncing}
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold bg-card border border-border rounded-xl hover:bg-muted transition-colors cursor-pointer shrink-0 disabled:opacity-50"
          >
            <RefreshCw size={15} className={cn(syncing && "animate-spin")} /> {syncing ? "Syncing..." : "Sync Website Orders"}
          </button>
          <Link
            href="/sales"
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold bg-primary text-primary-foreground rounded-xl shadow-sm shadow-primary/20 hover:bg-primary/90 transition-colors cursor-pointer shrink-0"
          >
            <Plus size={15} /> Quick Add Customer
          </Link>
        </div>
      </div>

      {/* Date Filter */}
      <div className="bg-card border border-border/80 rounded-2xl shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground mr-1">
            <Calendar size={13} /> Filter by date:
          </span>
          {DATE_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setDateFilter(f.value)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer",
                dateFilter === f.value
                  ? "bg-primary text-primary-foreground border-primary shadow-sm shadow-primary/20"
                  : "bg-background text-muted-foreground border-border hover:bg-muted"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground mr-1">
            <Globe size={13} /> Filter by source:
          </span>
          {[
            { value: "all", label: "All Orders" },
            { value: "pos", label: "POS Sales" },
            { value: "website", label: "Website Orders" },
          ].map(f => (
            <button
              key={f.value}
              onClick={() => setSourceFilter(f.value as typeof sourceFilter)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer",
                sourceFilter === f.value
                  ? "bg-primary text-primary-foreground border-primary shadow-sm shadow-primary/20"
                  : "bg-background text-muted-foreground border-border hover:bg-muted"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        {dateFilter === "custom" && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <label className="text-xs font-semibold text-muted-foreground">From</label>
            <input
              type="date"
              value={customStart}
              onChange={e => setCustomStart(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <label className="text-xs font-semibold text-muted-foreground">To</label>
            <input
              type="date"
              value={customEnd}
              onChange={e => setCustomEnd(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            {(customStart || customEnd) && (
              <button
                onClick={() => { setCustomStart(""); setCustomEnd(""); }}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-muted-foreground border border-border hover:bg-muted transition-colors cursor-pointer"
              >
                <X size={12} /> Clear
              </button>
            )}
          </div>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: "Total Orders", val: totalOrders, color: "amber", icon: ShoppingBag },
          { label: "Total Revenue", val: formatNPR(totalRevenue), color: "emerald", icon: Wallet },
          { label: "Pending Deliveries", val: pendingDeliveries, color: "blue", icon: Truck },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border/80 p-5 rounded-2xl shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground">{s.label}</p>
              {loading ? <Pulse className="h-8 w-16 mt-1" /> : <p className="text-3xl font-black mt-1">{s.val}</p>}
            </div>
            <s.icon size={32} className={cn("opacity-10", s.color === "amber" ? "text-amber-500" : s.color === "emerald" ? "text-emerald-500" : "text-blue-500")} />
          </div>
        ))}
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between gap-3 bg-card border border-border/80 rounded-2xl shadow-sm px-5 py-3">
          <span className="text-xs font-semibold text-muted-foreground">
            {selectedIds.size} order{selectedIds.size > 1 ? "s" : ""} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedIds(new Set())}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-border hover:bg-muted transition-colors cursor-pointer"
            >
              Clear
            </button>
            <button
              onClick={handleBulkDelete}
              disabled={deleting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Trash2 size={13} /> {deleting ? "Deleting..." : "Delete Selected"}
            </button>
          </div>
        </div>
      )}

      {/* Orders Table */}
      <div className="bg-card border border-border/80 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-muted/30">
                <th className="px-5 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && selectedIds.size === filtered.length}
                    onChange={toggleSelectAll}
                    aria-label="Select all orders"
                    className="w-4 h-4 rounded border-border cursor-pointer accent-primary"
                  />
                </th>
                <th className="text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-5 py-3 hidden sm:table-cell">SN</th>
                <th className="text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-5 py-3 hidden md:table-cell">Date</th>
                <th className="text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-5 py-3">Order ID</th>
                <th className="text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-5 py-3">Customer</th>
                <th className="text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-5 py-3 hidden lg:table-cell">Phone</th>
                <th className="text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-5 py-3">COD Amount</th>
                <th className="text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-5 py-3 hidden lg:table-cell">Delivery Amount</th>
                <th className="text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-5 py-3 hidden sm:table-cell">Status</th>
                <th className="text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-5 py-3 w-28">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {loading && Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}><td colSpan={10} className="px-5 py-3.5"><Pulse className="h-5 w-full" /></td></tr>
              ))}
              {!loading && filtered.map((sale, i) => {
                const isEditing = editingId === sale.id;
                const key = customerKey(sale);
                return (
                  <tr key={sale.id} className={cn("hover:bg-muted/20 transition-colors", selectedIds.has(sale.id) && "bg-primary/5")}>
                    <td className="px-5 py-3.5">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(sale.id)}
                        onChange={() => toggleSelected(sale.id)}
                        aria-label={`Select order ${sale.invoiceNumber}`}
                        className="w-4 h-4 rounded border-border cursor-pointer accent-primary"
                      />
                    </td>
                    <td className="px-5 py-3.5 text-xs text-muted-foreground font-medium hidden sm:table-cell">{i + 1}</td>
                    <td className="px-5 py-3.5 text-xs text-muted-foreground font-medium whitespace-nowrap hidden md:table-cell">{new Date(sale.createdAt).toLocaleDateString()}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5">
                        <Link href={`/customers/${encodeURIComponent(key)}`} className="font-bold text-xs font-mono hover:text-primary transition-colors cursor-pointer">
                          {sale.invoiceNumber}
                        </Link>
                        {sale.source === "website" && (
                          <span className="flex items-center gap-1 text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded-full whitespace-nowrap bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400">
                            <Globe size={9} /> Website
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground/70 mt-0.5 md:hidden">{new Date(sale.createdAt).toLocaleDateString()}</p>
                    </td>
                    <td className="px-5 py-3.5 font-semibold text-xs">
                      {isEditing ? (
                        <input
                          value={editForm.customerName}
                          onChange={e => setEditForm(f => ({ ...f, customerName: e.target.value }))}
                          placeholder="Customer name"
                          className="w-32 px-2 py-1.5 rounded-lg border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/20"
                        />
                      ) : (
                        <>
                          {sale.customerName || "Walk-in Customer"}
                          <p className="text-[10px] text-muted-foreground/70 mt-0.5 font-normal lg:hidden">{sale.customerPhone || "—"}</p>
                        </>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-xs hidden lg:table-cell">
                      {isEditing ? (
                        <div className="space-y-1.5">
                          <input
                            value={editForm.customerPhone}
                            onChange={e => setEditForm(f => ({ ...f, customerPhone: e.target.value }))}
                            placeholder="Phone"
                            className="w-32 px-2 py-1.5 rounded-lg border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/20"
                          />
                          <input
                            value={editForm.customerAddress}
                            onChange={e => setEditForm(f => ({ ...f, customerAddress: e.target.value }))}
                            placeholder="Address"
                            className="w-32 px-2 py-1.5 rounded-lg border border-border bg-background text-[10px] focus:outline-none focus:ring-2 focus:ring-primary/20"
                          />
                        </div>
                      ) : (
                        <>
                          <span className={cn(!sale.customerPhone && "text-muted-foreground/50 italic")}>
                            {sale.customerPhone || "—"}
                          </span>
                          {sale.customerAddress && (
                            <p className="text-[10px] text-muted-foreground/70 mt-0.5 truncate max-w-[140px]">{sale.customerAddress}</p>
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {isEditing ? (
                        <input
                          type="number"
                          step="0.01"
                          value={editForm.codAmount}
                          onChange={e => setEditForm(f => ({ ...f, codAmount: e.target.value }))}
                          title="Cash the customer pays on delivery — can be any amount"
                          className="w-24 px-2 py-1.5 rounded-lg border border-border bg-background text-xs text-right focus:outline-none focus:ring-2 focus:ring-primary/20"
                        />
                      ) : (
                        <span className="font-bold text-xs">{formatNPR(sale.codAmount ?? sale.totalAmount)}</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right hidden lg:table-cell">
                      {isEditing ? (
                        <input
                          type="number"
                          step="0.01"
                          value={editForm.deliveryAmount}
                          onChange={e => setEditForm(f => ({ ...f, deliveryAmount: e.target.value }))}
                          className="w-24 px-2 py-1.5 rounded-lg border border-border bg-background text-xs text-right focus:outline-none focus:ring-2 focus:ring-primary/20"
                        />
                      ) : (
                        <span className="font-extrabold text-xs">{formatNPR(sale.deliveryAmount ?? 0)}</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 hidden sm:table-cell">
                      {isEditing ? (
                        <Dropdown
                          value={editForm.deliveryStatus}
                          onChange={v => setEditForm(f => ({ ...f, deliveryStatus: v }))}
                          options={DELIVERY_STATUSES}
                          className="w-32"
                          triggerClassName="px-2 py-1.5 text-xs"
                        />
                      ) : (
                        <span className={cn("text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full whitespace-nowrap", DELIVERY_STYLES[sale.deliveryStatus] ?? DELIVERY_STYLES.IN_PROCESS)}>
                          {DELIVERY_STATUSES.find(d => d.value === sale.deliveryStatus)?.label ?? "In Process"}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-1.5">
                        {isEditing ? (
                          <>
                            <button onClick={cancelEdit} className="w-8 h-8 flex items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground hover:bg-muted/70 transition-colors cursor-pointer">
                              <X size={12} />
                            </button>
                            <button onClick={() => saveEdit(sale)} disabled={saving} className="w-8 h-8 flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50">
                              <Save size={12} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => startEdit(sale)} className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-muted transition-colors cursor-pointer">
                              <Edit2 size={12} />
                            </button>
                            <Link href={`/customers/${encodeURIComponent(key)}`} className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-muted transition-colors cursor-pointer">
                              <ChevronRight size={14} />
                            </Link>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!loading && filtered.length === 0 && (
          sales.length === 0 ? (
            <EmptyState icon={Users} title="No customers yet" description="Orders appear here automatically once a sale is recorded in the POS." />
          ) : (
            <EmptyState icon={Search} title="No matching orders" description="Try adjusting your search or date filter." />
          )
        )}
      </div>
      </div>
    </Skeleton>
  );
}

