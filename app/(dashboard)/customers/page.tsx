"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search, Users, ChevronRight, Plus, Edit2, X, Calendar, RefreshCw, Globe, Trash2,
  ShoppingBag, Wallet, Truck, Download, Tag, Receipt,
} from "lucide-react";
import { toast } from "sonner";
import { updateDeliveryStatuses, updateSaleDetails, syncWebsiteOrders, deleteSales, refreshCourierShipments } from "@/app/actions";
import { cn, formatNPR } from "@/lib/utils";
import { Pulse } from "@/components/shared/Pulse";
import { EmptyState } from "@/components/shared/EmptyState";
import { Modal } from "@/components/shared/Modal";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/shared/Button";
import { Dropdown } from "@/components/shared/Dropdown";
import { CustomerLabelDialog } from "@/components/shared/CustomerLabelDialog";
import { ReceiptDialog } from "@/components/shared/ReceiptDialog";
import { CourierDialog } from "@/components/shared/CourierDialog";
import { ORDER_COLUMNS, PlaceholderRows } from "@/components/skeletons/placeholders";
import { ShowMoreButton, useShowMore } from "@/components/shared/ShowMore";
import { useResources } from "@/lib/useResources";
import { resources } from "@/lib/resources";
import { mutate } from "@/lib/mutate";
import { customerKey, DELIVERY_STATUSES, DELIVERY_STYLES } from "@/lib/orders";
import { useUrlState } from "@/lib/useUrlState";
import { downloadCsv } from "@/lib/csv";
import { parseCustomerCode } from "@/lib/customerIdentity";
import { COURIER_FINAL_STATUSES, courierStatusLabel, courierStatusStyle } from "@/lib/courier";
import { useStoreProfile } from "@/lib/storeProfile";
import type { Sale } from "@/lib/types";

type DeliveryStatus = "IN_PROCESS" | "DELIVERED" | "RETURN_PROCESS" | "RETURNED";

const DATE_FILTERS = [
  { value: "all", label: "All Time" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "3days", label: "Last 3 Days" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "custom", label: "Custom" },
];

const SOURCE_FILTERS = [
  { value: "all", label: "All Orders" },
  { value: "pos", label: "POS Sales" },
  { value: "website", label: "Website Orders" },
] as const;

type SourceFilter = (typeof SOURCE_FILTERS)[number]["value"];

const BLANK_EDIT = { customerName: "", customerPhone: "", customerAddress: "", codAmount: "", deliveryAmount: "", deliveryStatus: "IN_PROCESS" };

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** "YYYY-MM-DD" from a date input, read as local time rather than UTC. */
const localDay = (value: string) => new Date(`${value}T00:00:00`);

function isWithinDateFilter(dateStr: string | Date, filter: string, customStart: string, customEnd: string) {
  if (filter === "all") return true;
  const date = new Date(dateStr);
  const today = startOfDay(new Date());

  if (filter === "today") return date >= today;
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
  if (filter === "month") return date >= new Date(today.getFullYear(), today.getMonth(), 1);
  if (filter === "custom") {
    if (customStart && date < localDay(customStart)) return false;
    if (customEnd) {
      const end = localDay(customEnd);
      end.setDate(end.getDate() + 1);
      if (date >= end) return false;
    }
  }
  return true;
}

const fieldClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20";

function FilterChips<T extends string>({ options, value, onChange }: { options: readonly { value: T; label: string }[]; value: string; onChange: (value: T) => void }) {
  return (
    <>
      {options.map(f => (
        <button
          key={f.value}
          type="button"
          aria-pressed={value === f.value}
          onClick={() => onChange(f.value)}
          className={cn(
            "px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap shrink-0",
            value === f.value
              ? "bg-primary text-primary-foreground border-primary shadow-sm shadow-primary/20"
              : "bg-background text-muted-foreground border-border hover:bg-muted"
          )}
        >
          {f.label}
        </button>
      ))}
    </>
  );
}

export default function CustomersPage() {
  const { sales, loading, refetch } = useResources({ sales: resources.sales });
  const store = useStoreProfile();
  const router = useRouter();
  const [labelSale, setLabelSale] = useState<Sale | null>(null);
  const [showLabel, setShowLabel] = useState(false);
  const [courierSale, setCourierSale] = useState<Sale | null>(null);
  const [showCourier, setShowCourier] = useState(false);
  const [refreshingCourier, setRefreshingCourier] = useState(false);
  const [search, setSearch] = useUrlState("q");
  const [dateFilter, setDateFilter] = useUrlState("filter", "all");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");

  const [editing, setEditing] = useState<Sale | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState(BLANK_EDIT);
  const [initialEdit, setInitialEdit] = useState(BLANK_EDIT);
  const [saving, setSaving] = useState(false);

  const [syncing, setSyncing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteCount, setDeleteCount] = useState(0);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [bulkLabelsOpen, setBulkLabelsOpen] = useState(false);
  // Receipts to print: one order's (row button) or the ticked ones (bulk).
  const [receiptSales, setReceiptSales] = useState<Sale[]>([]);
  const [restock, setRestock] = useState(false);

  const filtered = useMemo(() => {
    const q = (parseCustomerCode(search) ?? search.trim()).toLowerCase();
    return sales.filter(s =>
      ((s.customerName ?? "").toLowerCase().includes(q) ||
        (s.customerPhone ?? "").toLowerCase().includes(q) ||
        (s.customer?.code ?? "").toLowerCase().includes(q) ||
        (s.courierTrackingCode ?? "").toLowerCase().includes(q) ||
        s.invoiceNumber.toLowerCase().includes(q)) &&
      isWithinDateFilter(s.createdAt, dateFilter, customStart, customEnd) &&
      (sourceFilter === "all" || (s.source ?? "pos") === sourceFilter)
    );
  }, [sales, search, dateFilter, customStart, customEnd, sourceFilter]);

  const { visible: displayed, remaining, step, showMore } = useShowMore(filtered);

  // Only rows currently on screen count as selected, so changing a filter can
  // never leave hidden orders queued for deletion.
  const selectedVisible = useMemo(() => displayed.filter(s => selectedIds.has(s.id)), [displayed, selectedIds]);
  const allVisibleSelected = displayed.length > 0 && selectedVisible.length === displayed.length;

  const summary = useMemo(() => ({
    revenue: filtered.reduce((total, s) => total + s.totalAmount, 0),
    pending: filtered.filter(s => s.deliveryStatus === "IN_PROCESS" || s.deliveryStatus === "RETURN_PROCESS").length,
  }), [filtered]);

  async function handleSyncWebsiteOrders() {
    setSyncing(true);
    const response = await mutate(() => syncWebsiteOrders(), { loading: "Checking the website for new orders…" });
    setSyncing(false);
    if (!response.ok) return;

    const { imported, unmatchedItems, failedOrderIds } = response.data;
    if (imported > 0) await refetch();

    if (failedOrderIds.length > 0) {
      toast.error(`Imported ${imported}, but ${failedOrderIds.length} failed: ${failedOrderIds.slice(0, 3).join(", ")}${failedOrderIds.length > 3 ? "…" : ""}`, { duration: 8000 });
    } else if (imported === 0) {
      toast.info("No new website orders to import.");
    } else {
      toast.success(`Imported ${imported} website order${imported > 1 ? "s" : ""}${unmatchedItems ? ` (${unmatchedItems} item${unmatchedItems > 1 ? "s" : ""} not matched to a product)` : ""}.`);
    }
  }

  // Scanning a label into the search box opens that customer.
  function onSearchKeyDown(e: React.KeyboardEvent) {
    const code = e.key === "Enter" ? parseCustomerCode(search) : null;
    if (code) router.push(`/customers/${code}`);
  }

  function openLabel(sale: Sale) {
    setLabelSale(sale);
    setShowLabel(true);
  }

  function openCourier(sale: Sale) {
    setCourierSale(sale);
    setShowCourier(true);
  }

  async function handleRefreshCourier() {
    setRefreshingCourier(true);
    const result = await mutate(() => refreshCourierShipments(), {
      loading: "Checking Upaya for updates…",
      success: data => `Checked ${data.checked} shipment${data.checked === 1 ? "" : "s"}, ${data.updated} updated${data.failed ? `, ${data.failed} couldn't be read` : ""}.`,
    });
    setRefreshingCourier(false);
    if (result.ok && result.data.updated > 0) await refetch();
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
    setSelectedIds(allVisibleSelected ? new Set() : new Set(displayed.map(s => s.id)));
  }

  async function applyBulkStatus(status: string) {
    const ids = selectedVisible.map(s => s.id);
    setBulkUpdating(true);
    const result = await mutate(() => updateDeliveryStatuses(ids, status as DeliveryStatus), {
      success: data => `Updated ${data.updated} order${data.updated === 1 ? "" : "s"}.`,
    });
    setBulkUpdating(false);
    if (!result.ok) return;
    setSelectedIds(new Set());
    await refetch();
  }

  function askBulkDelete() {
    setRestock(false);
    setDeleteCount(selectedVisible.length);
    setConfirmOpen(true);
  }

  async function handleBulkDelete() {
    const ids = selectedVisible.map(s => s.id);
    const result = await mutate(() => deleteSales(ids, { restock }), {
      success: data => `Deleted ${data.deleted} order${data.deleted === 1 ? "" : "s"}${data.restocked ? ` and returned ${data.restocked} unit${data.restocked === 1 ? "" : "s"} to stock` : ""}.`,
    });
    setConfirmOpen(false);
    if (!result.ok) return;
    setSelectedIds(new Set());
    await refetch();
  }

  function exportCsv() {
    downloadCsv(
      `karmify-orders-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Date", "Order ID", "Source", "Customer ID", "Customer", "Phone", "Address", "Total", "COD Amount", "Delivery Amount", "Delivery Status", "Payment Status", "Upaya Tracking Code", "Upaya Status"],
      filtered.map(s => [
        new Date(s.createdAt).toLocaleString(),
        s.invoiceNumber,
        s.source,
        s.customer?.code,
        s.customerName,
        s.customerPhone,
        s.customerAddress,
        s.totalAmount,
        s.codAmount,
        s.deliveryAmount,
        DELIVERY_STATUSES.find(d => d.value === s.deliveryStatus)?.label ?? s.deliveryStatus,
        s.paymentStatus,
        s.courierTrackingCode,
        s.courierStatus ? courierStatusLabel(s.courierStatus) : "",
      ])
    );
    toast.success(`Exported ${filtered.length} order${filtered.length === 1 ? "" : "s"}.`);
  }

  function startEdit(sale: Sale) {
    const next = {
      customerName: sale.customerName ?? "",
      customerPhone: sale.customerPhone ?? "",
      customerAddress: sale.customerAddress ?? "",
      codAmount: String(sale.codAmount || sale.totalAmount),
      deliveryAmount: String(sale.deliveryAmount ?? 0),
      deliveryStatus: sale.deliveryStatus ?? "IN_PROCESS",
    };
    setEditing(sale);
    setEditForm(next);
    setInitialEdit(next);
    setShowEdit(true);
  }

  async function saveEdit() {
    if (!editing) return;
    if (!editForm.customerName.trim() && !editForm.customerPhone.trim()) {
      toast.error("Enter a customer name or phone number.");
      return;
    }

    setSaving(true);
    const result = await mutate(
      () => updateSaleDetails(editing.id, {
        customerName: editForm.customerName,
        customerPhone: editForm.customerPhone,
        customerAddress: editForm.customerAddress,
        codAmount: parseFloat(editForm.codAmount) || 0,
        deliveryAmount: parseFloat(editForm.deliveryAmount) || 0,
        deliveryStatus: editForm.deliveryStatus as DeliveryStatus,
      }),
      { success: `${editing.invoiceNumber} updated.` }
    );
    if (result.ok) {
      setShowEdit(false);
      await refetch();
    }
    setSaving(false);
  }

  const setField = (field: keyof typeof BLANK_EDIT) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setEditForm(f => ({ ...f, [field]: e.target.value }));

  const hasOpenShipments = sales.some(s => s.courierTrackingCode && !COURIER_FINAL_STATUSES.includes(s.courierStatus ?? ""));
  const iconButton = "w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-muted transition-colors";
  const th = "text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-5 py-3";

  return (
<>
      <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Customers &amp; Orders</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Every order placed, with delivery &amp; payment status</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full xl:w-auto">
          <div className="relative flex-1 min-w-full sm:min-w-56 xl:w-72">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder="Search name, phone, order, customer ID or tracking..."
              aria-label="Search orders"
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <Button variant="secondary" onClick={exportCsv} disabled={filtered.length === 0} className="flex-1 sm:flex-none px-3 sm:px-4">
            <Download size={15} /> Export
          </Button>
          <Button variant="secondary" onClick={handleSyncWebsiteOrders} disabled={syncing} className="flex-1 sm:flex-none px-3 sm:px-4 whitespace-nowrap">
            <RefreshCw size={15} className={cn(syncing && "animate-spin")} /> {syncing ? "Syncing..." : "Sync Website"}
          </Button>
          {hasOpenShipments && (
            <Button variant="secondary" onClick={handleRefreshCourier} disabled={refreshingCourier} className="flex-1 sm:flex-none px-3 sm:px-4 whitespace-nowrap">
              <Truck size={15} className={cn(refreshingCourier && "animate-pulse")} /> Refresh Upaya
            </Button>
          )}
          <Link
            href="/sales"
            className="flex items-center justify-center gap-1.5 flex-1 sm:flex-none px-3 sm:px-4 py-2.5 text-sm font-semibold bg-primary text-primary-foreground rounded-xl shadow-sm shadow-primary/20 hover:bg-primary/90 transition-colors whitespace-nowrap"
          >
            <Plus size={15} /> New Order
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-card border border-border/80 rounded-2xl shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-2 overflow-x-auto sm:flex-wrap sm:overflow-visible -mx-1 px-1 pb-0.5">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground mr-1 shrink-0">
            <Calendar size={13} /> Date:
          </span>
          <FilterChips options={DATE_FILTERS} value={dateFilter} onChange={setDateFilter} />
        </div>
        <div className="flex items-center gap-2 overflow-x-auto sm:flex-wrap sm:overflow-visible -mx-1 px-1 pb-0.5">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground mr-1 shrink-0">
            <Globe size={13} /> Source:
          </span>
          <FilterChips options={SOURCE_FILTERS} value={sourceFilter} onChange={setSourceFilter} />
        </div>
        {dateFilter === "custom" && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <label htmlFor="orders-from" className="text-xs font-semibold text-muted-foreground">From</label>
            <input id="orders-from" type="date" value={customStart} max={customEnd || undefined} onChange={e => setCustomStart(e.target.value)} className="px-3 py-1.5 rounded-lg border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/20" />
            <label htmlFor="orders-to" className="text-xs font-semibold text-muted-foreground">To</label>
            <input id="orders-to" type="date" value={customEnd} min={customStart || undefined} onChange={e => setCustomEnd(e.target.value)} className="px-3 py-1.5 rounded-lg border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/20" />
            {(customStart || customEnd) && (
              <button type="button" onClick={() => { setCustomStart(""); setCustomEnd(""); }} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-muted-foreground border border-border hover:bg-muted transition-colors">
                <X size={12} /> Clear
              </button>
            )}
          </div>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: "Total Orders", val: filtered.length, color: "text-amber-500", icon: ShoppingBag },
          { label: "Total Revenue", val: formatNPR(summary.revenue), color: "text-emerald-500", icon: Wallet },
          { label: "Pending Deliveries", val: summary.pending, color: "text-blue-500", icon: Truck },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border/80 p-5 rounded-2xl shadow-sm flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-muted-foreground">{s.label}</p>
              {loading ? <Pulse className="h-8 xl:h-9 w-16 mt-1" /> : <p className="text-2xl xl:text-3xl font-black mt-1 truncate">{s.val}</p>}
            </div>
            <s.icon size={32} className={cn("opacity-10 shrink-0", s.color)} />
          </div>
        ))}
      </div>

      {/* Bulk action bar */}
      {selectedVisible.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-card border border-border/80 rounded-2xl shadow-sm px-5 py-3 animate-fade-in">
          <span className="text-xs font-semibold text-muted-foreground">
            {selectedVisible.length} order{selectedVisible.length > 1 ? "s" : ""} selected
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Dropdown
              aria-label="Set delivery status for selected orders"
              value=""
              onChange={applyBulkStatus}
              disabled={bulkUpdating}
              placeholder={bulkUpdating ? "Updating…" : "Set status…"}
              options={DELIVERY_STATUSES}
              className="w-36"
              triggerClassName="px-3 py-1.5 text-xs rounded-lg"
            />
            <Button variant="secondary" onClick={() => setBulkLabelsOpen(true)} className="px-3 py-1.5 text-xs rounded-lg">
              <Tag size={13} /> Print labels
            </Button>
            <Button variant="secondary" onClick={() => setReceiptSales(selectedVisible)} className="px-3 py-1.5 text-xs rounded-lg">
              <Receipt size={13} /> Print receipts
            </Button>
            <Button variant="secondary" onClick={() => setSelectedIds(new Set())} className="px-3 py-1.5 text-xs rounded-lg">Clear</Button>
            <Button variant="danger" onClick={askBulkDelete} className="px-3 py-1.5 text-xs rounded-lg">
              <Trash2 size={13} /> Delete Selected
            </Button>
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
                    checked={allVisibleSelected}
                    onChange={toggleSelectAll}
                    aria-label="Select all orders"
                    className="w-4 h-4 rounded border-border cursor-pointer accent-primary"
                  />
                </th>
                <th className={cn(th, "hidden sm:table-cell")}>SN</th>
                <th className={cn(th, "hidden md:table-cell")}>Date</th>
                <th className={th}>Order ID</th>
                <th className={th}>Customer</th>
                <th className={cn(th, "hidden lg:table-cell")}>Phone</th>
                <th className={cn(th, "text-right")}>COD Amount</th>
                <th className={cn(th, "text-right hidden lg:table-cell")}>Delivery Amount</th>
                <th className={cn(th, "hidden sm:table-cell")}>Status</th>
                <th className={cn(th, "text-right w-32 sm:w-40")}>Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {loading && <PlaceholderRows columns={ORDER_COLUMNS} />}
              {!loading && displayed.map((sale, i) => {
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
                        <Link href={`/customers/${encodeURIComponent(key)}`} className="font-bold text-xs font-mono hover:text-primary transition-colors whitespace-nowrap">
                          {sale.invoiceNumber}
                        </Link>
                        {sale.source === "website" && (
                          <span className="flex items-center gap-1 text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded-full whitespace-nowrap bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400">
                            <Globe size={9} /> Website
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5 md:hidden">{new Date(sale.createdAt).toLocaleDateString()}</p>
                    </td>
                    <td className="px-5 py-3.5 font-semibold text-xs">
                      {sale.customerName || "Walk-in Customer"}
                      {sale.customer && <p className="text-[10px] text-muted-foreground mt-0.5 font-mono font-medium">{sale.customer.code}</p>}
                      <p className="text-[10px] text-muted-foreground mt-0.5 font-normal lg:hidden">{sale.customerPhone || "—"}</p>
                    </td>
                    <td className="px-5 py-3.5 text-xs hidden lg:table-cell">
                      <span className={cn(!sale.customerPhone && "text-muted-foreground italic")}>
                        {sale.customerPhone || "—"}
                      </span>
                      {sale.customerAddress && (
                        <p className="text-[10px] text-muted-foreground mt-0.5 truncate max-w-[140px]" title={sale.customerAddress}>{sale.customerAddress}</p>
                      )}
                      {sale.courierAreaTitle && (
                        <p className="text-[10px] text-muted-foreground mt-0.5 truncate max-w-[140px]" title={sale.courierAreaTitle}>Hub: {sale.courierAreaTitle}</p>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right whitespace-nowrap">
                      <span className="font-bold text-xs">{formatNPR(sale.codAmount || sale.totalAmount)}</span>
                    </td>
                    <td className="px-5 py-3.5 text-right hidden lg:table-cell whitespace-nowrap">
                      <span className="font-extrabold text-xs">{formatNPR(sale.deliveryAmount ?? 0)}</span>
                    </td>
                    <td className="px-5 py-3.5 hidden sm:table-cell">
                      <span className={cn("text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full whitespace-nowrap", DELIVERY_STYLES[sale.deliveryStatus] ?? DELIVERY_STYLES.IN_PROCESS)}>
                        {DELIVERY_STATUSES.find(d => d.value === sale.deliveryStatus)?.label ?? "In Process"}
                      </span>
                      {sale.courierStatus && (
                        <p className="mt-1">
                          <span className={cn("text-[9px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap", courierStatusStyle(sale.courierStatus))}>
                            {courierStatusLabel(sale.courierStatus)}
                          </span>
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-1.5">
                        {(sale.courierTrackingCode || sale.deliveryStatus === "IN_PROCESS") && (
                          <button
                            type="button"
                            onClick={() => openCourier(sale)}
                            aria-label={`${sale.courierTrackingCode ? "Track" : "Send to Upaya:"} order ${sale.invoiceNumber}`}
                            title={sale.courierTrackingCode ? "Track with Upaya" : "Send to Upaya"}
                            className={cn(iconButton, sale.courierTrackingCode && "text-primary border-primary/40")}
                          >
                            <Truck size={12} />
                          </button>
                        )}
                        <button type="button" onClick={() => openLabel(sale)} aria-label={`Print label for order ${sale.invoiceNumber}`} title="Print label" className={iconButton}>
                          <Tag size={12} />
                        </button>
                        <button type="button" onClick={() => setReceiptSales([sale])} aria-label={`Print receipt for order ${sale.invoiceNumber}`} title="Print receipt" className={iconButton}>
                          <Receipt size={12} />
                        </button>
                        <button type="button" onClick={() => startEdit(sale)} aria-label={`Edit order ${sale.invoiceNumber}`} className={iconButton}>
                          <Edit2 size={12} />
                        </button>
                        <Link href={`/customers/${encodeURIComponent(key)}`} aria-label={`View customer for order ${sale.invoiceNumber}`} className={cn(iconButton, "hidden sm:flex")}>
                          <ChevronRight size={14} />
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!loading && <ShowMoreButton remaining={remaining} step={step} onClick={showMore} />}

        {!loading && filtered.length === 0 && (
          sales.length === 0 ? (
            <EmptyState icon={Users} title="No customers yet" description="Orders appear here automatically once a sale is recorded in the POS." />
          ) : (
            <EmptyState icon={Search} title="No matching orders" description="Try adjusting your search or filters." />
          )
        )}
      </div>

      <Modal
        open={showEdit}
        onClose={() => setShowEdit(false)}
        title="Edit order"
        description={editing?.invoiceNumber}
        busy={saving}
        dirty={JSON.stringify(editForm) !== JSON.stringify(initialEdit)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowEdit(false)} disabled={saving} className="flex-1">Cancel</Button>
            <Button onClick={saveEdit} loading={saving} className="flex-1">{saving ? "Saving…" : "Save Changes"}</Button>
          </>
        }
      >
        <div className="p-5 sm:p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor="edit-name" className="text-xs font-semibold text-muted-foreground">Customer name</label>
            <input id="edit-name" data-autofocus value={editForm.customerName} onChange={setField("customerName")} className={fieldClass} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="edit-phone" className="text-xs font-semibold text-muted-foreground">Phone</label>
            <input id="edit-phone" type="tel" value={editForm.customerPhone} onChange={setField("customerPhone")} className={fieldClass} />
          </div>
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Delivery status</span>
            <Dropdown aria-label="Delivery status" value={editForm.deliveryStatus} onChange={v => setEditForm(f => ({ ...f, deliveryStatus: v }))} options={DELIVERY_STATUSES} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor="edit-address" className="text-xs font-semibold text-muted-foreground">Address</label>
            <input id="edit-address" value={editForm.customerAddress} onChange={setField("customerAddress")} className={fieldClass} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="edit-cod" className="text-xs font-semibold text-muted-foreground">COD amount (Rs.)</label>
            <input id="edit-cod" type="number" inputMode="decimal" min={0} step="0.01" value={editForm.codAmount} onChange={setField("codAmount")} className={fieldClass} />
            {editing?.courierTrackingCode && <p className="text-[11px] text-muted-foreground">Upaya keeps the amount it was booked with. Changing it here doesn&apos;t update the rider.</p>}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="edit-delivery" className="text-xs font-semibold text-muted-foreground">Delivery amount (Rs.)</label>
            <input id="edit-delivery" type="number" inputMode="decimal" min={0} step="0.01" value={editForm.deliveryAmount} onChange={setField("deliveryAmount")} className={fieldClass} />
          </div>
        </div>
      </Modal>

      {courierSale && (
        <CourierDialog key={courierSale.id} open={showCourier} onClose={() => setShowCourier(false)} sale={courierSale} onChanged={() => refetch({ quiet: true })} />
      )}

      {receiptSales.length > 0 && (
        <ReceiptDialog open onClose={() => setReceiptSales([])} sales={receiptSales} store={store} />
      )}
      {bulkLabelsOpen && selectedVisible.length > 0 && (
        <CustomerLabelDialog open={bulkLabelsOpen} onClose={() => setBulkLabelsOpen(false)} orders={selectedVisible} store={store} />
      )}
      {labelSale && (
        <CustomerLabelDialog open={showLabel} onClose={() => setShowLabel(false)} order={labelSale} store={store} />
      )}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleBulkDelete}
        title={`Delete ${deleteCount} order${deleteCount === 1 ? "" : "s"}?`}
        description="This can't be undone."
        confirmLabel="Delete"
      >
        <label className="mt-3 flex items-start gap-2 text-sm text-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={restock}
            onChange={e => setRestock(e.target.checked)}
            className="mt-0.5 w-4 h-4 rounded border-border cursor-pointer accent-primary shrink-0"
          />
          Add these orders&apos; items back to stock
        </label>
      </ConfirmDialog>
      </div>
</>
  );
}
