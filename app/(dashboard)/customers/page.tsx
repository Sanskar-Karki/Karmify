"use client";

import React, { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search, Users, ChevronRight, Plus, Edit2, X, Calendar, RefreshCw, Globe, Trash2,
  ShoppingBag, Wallet, Truck, Download, Tag, Receipt,
} from "lucide-react";
import { toast } from "sonner";
import { updateDeliveryStatuses, updateSaleDetails, syncWebsiteOrders, deleteSales, refreshCourierShipments, bookSaleWithUpaya } from "@/app/actions";
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
import { Pagination, usePagination } from "@/components/shared/Pagination";
import { useResources } from "@/lib/useResources";
import { resources } from "@/lib/resources";
import { mutate } from "@/lib/mutate";
import { countsAsSale, customerKey, DELIVERY_STATUSES, DELIVERY_STYLES } from "@/lib/orders";
import { useUrlState } from "@/lib/useUrlState";
import { downloadCsv } from "@/lib/csv";
import { parseCustomerCode } from "@/lib/customerIdentity";
import { COURIER_FINAL_STATUSES, courierMobile, courierStatusLabel, courierStatusStyle } from "@/lib/courier";
import { useStoreProfile } from "@/lib/storeProfile";
import { channelOf } from "@/lib/analytics";
import { DateRangeCalendar, shortDay } from "@/components/shared/DateRangeCalendar";
import type { Sale } from "@/lib/types";

type DeliveryStatus = "IN_PROCESS" | "DELIVERED" | "RETURN_PROCESS" | "RETURNED" | "CANCELLED";

const DATE_FILTERS = [
  { value: "all", label: "All Time" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "3days", label: "Last 3 Days" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "custom", label: "Custom" },
];

// Where an order came from, matching the Analytics channels.
const SOURCE_FILTERS = [
  { value: "all", label: "All sources" },
  { value: "website", label: "Website" },
  { value: "pos", label: "Shop (POS)" },
  { value: "upaya", label: "Sent with Upaya" },
  { value: "store", label: "In store" },
];

const PAYMENT_FILTERS = [
  { value: "all", label: "Any payment" },
  { value: "PAID", label: "Paid" },
  { value: "UNPAID", label: "Unpaid" },
  { value: "PARTIAL", label: "Partly paid" },
];

function matchesSource(sale: Sale, source: string) {
  if (source === "all") return true;
  if (source === "website") return sale.source === "website";
  if (source === "pos") return sale.source !== "website";
  if (source === "upaya") return Boolean(sale.courierTrackingCode);
  return channelOf(sale) === "store";
}

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

export default function CustomersPage() {
  const { sales, loading, refetch } = useResources({ sales: resources.sales });
  const store = useStoreProfile();
  const router = useRouter();

  // A click anywhere on an order row opens that customer, except on the row's own
  // controls (tick box, menus, buttons, links) or menus/dialogs opened from it.
  const openCustomer = (e: React.MouseEvent<HTMLTableRowElement>, key: string) => {
    const target = e.target as HTMLElement;
    if (!e.currentTarget.contains(target)) return;
    if (target.closest("a, button, input, select, textarea, label, [role='menu'], [role='listbox'], [role='dialog']")) return;
    if (window.getSelection()?.toString()) return; // selecting text to copy it
    const href = `/customers/${encodeURIComponent(key)}`;
    if (e.ctrlKey || e.metaKey) window.open(href, "_blank");
    else router.push(href);
  };
  const [labelSale, setLabelSale] = useState<Sale | null>(null);
  const [showLabel, setShowLabel] = useState(false);
  const [courierSale, setCourierSale] = useState<Sale | null>(null);
  const [showCourier, setShowCourier] = useState(false);
  const [refreshingCourier, setRefreshingCourier] = useState(false);
  const [search, setSearch] = useUrlState("q");
  const [dateFilter, setDateFilter] = useUrlState("filter", "all");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useUrlState("status", "all");
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const dateAnchor = useRef<HTMLDivElement>(null);

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
  // Bulk "Send to Upaya": the ticked orders that can go, and the rest with why not.
  const [upayaBatch, setUpayaBatch] = useState<{ ready: Sale[]; skipped: { sale: Sale; reason: string }[] } | null>(null);
  const [sendingUpaya, setSendingUpaya] = useState(false);

  // Everything except the status, so each status chip can show its own count.
  const beforeStatus = useMemo(() => {
    const q = (parseCustomerCode(search) ?? search.trim()).toLowerCase();
    return sales.filter(s =>
      ((s.customerName ?? "").toLowerCase().includes(q) ||
        (s.customerPhone ?? "").toLowerCase().includes(q) ||
        (s.customer?.code ?? "").toLowerCase().includes(q) ||
        (s.courierTrackingCode ?? "").toLowerCase().includes(q) ||
        s.invoiceNumber.toLowerCase().includes(q)) &&
      isWithinDateFilter(s.createdAt, dateFilter, customStart, customEnd) &&
      matchesSource(s, sourceFilter) &&
      (paymentFilter === "all" || s.paymentStatus === paymentFilter)
    );
  }, [sales, search, dateFilter, customStart, customEnd, sourceFilter, paymentFilter]);

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of beforeStatus) counts.set(s.deliveryStatus, (counts.get(s.deliveryStatus) ?? 0) + 1);
    return counts;
  }, [beforeStatus]);

  const filtered = useMemo(
    () => (statusFilter === "all" ? beforeStatus : beforeStatus.filter(s => s.deliveryStatus === statusFilter)),
    [beforeStatus, statusFilter]
  );
  const filtersOn = dateFilter !== "all" || sourceFilter !== "all" || paymentFilter !== "all" || statusFilter !== "all";
  const clearFilters = () => {
    setDateFilter("all");
    setCustomStart("");
    setCustomEnd("");
    setSourceFilter("all");
    setPaymentFilter("all");
    setStatusFilter("all");
  };
  const customLabel = customStart
    ? customStart === customEnd || !customEnd ? shortDay(customStart) : `${shortDay(customStart)} – ${shortDay(customEnd)}`
    : "Pick dates";

  const pager = usePagination(filtered, "customers");
  const displayed = pager.visible;
  const tableScroll = useRef<HTMLDivElement>(null);
  const goToPage = (p: number) => {
    pager.setPage(p);
    tableScroll.current?.scrollTo({ top: 0 });
  };
  const changePageSize = (size: number) => {
    pager.setPageSize(size);
    tableScroll.current?.scrollTo({ top: 0 });
  };

  // Only rows currently on screen count as selected, so changing a filter can
  // never leave hidden orders queued for deletion.
  const selectedVisible = useMemo(() => displayed.filter(s => selectedIds.has(s.id)), [displayed, selectedIds]);
  const allVisibleSelected = displayed.length > 0 && selectedVisible.length === displayed.length;

  const summary = useMemo(() => ({
    revenue: filtered.filter(countsAsSale).reduce((total, s) => total + s.totalAmount, 0),
    pending: filtered.filter(s => s.deliveryStatus === "IN_PROCESS" || s.deliveryStatus === "RETURN_PROCESS").length,
    unpaid: filtered.filter(s => countsAsSale(s) && s.paymentStatus !== "PAID").length,
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

  /** Sorts the ticked orders into ones Upaya can take now and ones it can't (with the reason). */
  function askBulkUpaya() {
    const ready: Sale[] = [];
    const skipped: { sale: Sale; reason: string }[] = [];
    for (const sale of selectedVisible) {
      const withUpaya = Boolean(sale.courierTrackingCode) && sale.courierStatus !== "cancelled";
      const reason = withUpaya
        ? "already with Upaya"
        : sale.deliveryStatus !== "IN_PROCESS"
          ? "not in process"
          : !sale.courierAreaId
            ? "no hub location: choose one with its truck button"
            : !courierMobile(sale.customerPhone)
              ? "phone isn't a 10-digit mobile"
              : null;
      if (reason) skipped.push({ sale, reason });
      else ready.push(sale);
    }
    setUpayaBatch({ ready, skipped });
  }

  /** Books the ready orders one after another, so Upaya isn't flooded and each gets its own answer. */
  async function sendBatchToUpaya() {
    const batch = upayaBatch;
    if (!batch || batch.ready.length === 0) return;
    setUpayaBatch(null);
    setSendingUpaya(true);
    const total = batch.ready.length;
    const toastId = toast.loading(`Sending 1 of ${total} to Upaya…`);
    let booked = 0;
    const failed: string[] = [];
    for (const [i, sale] of batch.ready.entries()) {
      toast.loading(`Sending ${i + 1} of ${total} to Upaya…`, { id: toastId });
      const result = await bookSaleWithUpaya(sale.id).catch(() => null);
      if (result?.ok) booked += 1;
      else failed.push(`${sale.invoiceNumber} (${result && !result.ok ? result.message : "no connection"})`);
      if (i < total - 1) await new Promise(resolve => setTimeout(resolve, 300));
    }
    if (failed.length) {
      toast.error(
        `Booked ${booked} of ${total} with Upaya. Not booked: ${failed.slice(0, 3).join("; ")}${failed.length > 3 ? ` and ${failed.length - 3} more` : ""}.`,
        { id: toastId, duration: 12000 }
      );
    } else {
      toast.success(`Booked ${booked} order${booked === 1 ? "" : "s"} with Upaya.`, { id: toastId });
    }
    setSendingUpaya(false);
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
  // Opaque and sticky, with its bottom line drawn as a shadow (borders don't stick with the cell).
  const stickyTh = "sticky top-0 z-10 bg-muted shadow-[inset_0_-1px_0_hsl(var(--border))]";
  const th = cn(stickyTh, "text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground px-5 py-3");

  return (
<>
      {/* On laptops the page fills the screen down to just above its bottom edge (reaching into the room
          the layout keeps for the dock, which is small there) and only the orders table scrolls. */}
      <div className="space-y-3 animate-fade-in lg:flex lg:h-[calc(100%+4.75rem)] lg:-mb-[4.75rem] lg:flex-col lg:space-y-0 lg:gap-3">
      {/* Title with a one-line summary of what's shown, and the page actions */}
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold tracking-tight">Customers &amp; Orders</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-muted-foreground" aria-live="polite">
            {[
              { label: filtered.length === 1 ? "order" : "orders", val: filtered.length.toLocaleString(), icon: ShoppingBag },
              { label: "revenue", val: formatNPR(summary.revenue), icon: Wallet },
              { label: "to deliver", val: summary.pending.toLocaleString(), icon: Truck },
              { label: "unpaid", val: summary.unpaid.toLocaleString(), icon: Receipt },
            ].map(stat => (
              <span key={stat.label} className="flex items-center gap-1.5 whitespace-nowrap">
                <stat.icon size={13} aria-hidden />
                {loading ? <Pulse className="h-3.5 w-10" /> : <span className="font-bold text-foreground tabular-nums">{stat.val}</span>}
                {stat.label}
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto">
          <div className="relative flex-1 min-w-full sm:min-w-56 xl:w-64 xl:flex-none">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder="Search name, phone, order, customer ID or tracking..."
              aria-label="Search orders"
              className="w-full pl-8.5 pr-3 py-2 rounded-lg border border-border bg-background text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <Button variant="secondary" onClick={exportCsv} disabled={filtered.length === 0} className="flex-1 sm:flex-none px-3 py-2 rounded-lg text-[13px]">
            <Download size={14} /> Export
          </Button>
          <Button variant="secondary" onClick={handleSyncWebsiteOrders} disabled={syncing} className="flex-1 sm:flex-none px-3 py-2 rounded-lg text-[13px] whitespace-nowrap">
            <RefreshCw size={14} className={cn(syncing && "animate-spin")} /> {syncing ? "Syncing..." : "Sync Website"}
          </Button>
          {hasOpenShipments && (
            <Button variant="secondary" onClick={handleRefreshCourier} disabled={refreshingCourier} className="flex-1 sm:flex-none px-3 py-2 rounded-lg text-[13px] whitespace-nowrap">
              <Truck size={14} className={cn(refreshingCourier && "animate-pulse")} /> Refresh Upaya
            </Button>
          )}
          <Link
            href="/sales"
            className="flex items-center justify-center gap-1.5 flex-1 sm:flex-none px-3.5 py-2 text-[13px] font-semibold bg-primary text-primary-foreground rounded-lg shadow-sm shadow-primary/20 hover:bg-primary/90 transition-colors whitespace-nowrap"
          >
            <Plus size={14} /> New Order
          </Link>
        </div>
      </div>

      {/* Filters: a status switch with counts, then date, source and payment */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div role="group" aria-label="Delivery status" className="flex max-w-full items-center gap-0.5 self-start overflow-x-auto rounded-xl border border-border/70 bg-muted/70 p-1">
          {[{ value: "all", label: "All" }, ...DELIVERY_STATUSES].map(st => {
            const count = st.value === "all" ? beforeStatus.length : statusCounts.get(st.value) ?? 0;
            const active = statusFilter === st.value;
            return (
              <button
                key={st.value}
                type="button"
                aria-pressed={active}
                onClick={() => setStatusFilter(st.value)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all whitespace-nowrap",
                  active ? "bg-card text-foreground shadow-sm ring-1 ring-border/60" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {st.label}
                <span className={cn("text-[11px] font-bold tabular-nums", active ? "text-primary" : "text-muted-foreground/70")}>{count}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <div ref={dateAnchor} className="flex items-center gap-1.5">
            <Dropdown
              aria-label="Date"
              value={dateFilter}
              onChange={v => {
                setDateFilter(v);
                if (v === "custom") setDatePickerOpen(true);
              }}
              options={DATE_FILTERS}
              className="w-32"
              triggerClassName="py-1.5 text-xs rounded-lg"
            />
            {dateFilter === "custom" && (
              <button type="button" onClick={() => setDatePickerOpen(o => !o)} className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-muted whitespace-nowrap">
                <Calendar size={13} /> {customLabel}
              </button>
            )}
          </div>
          <Dropdown aria-label="Source" value={sourceFilter} onChange={setSourceFilter} options={SOURCE_FILTERS} className="w-36" triggerClassName="py-1.5 text-xs rounded-lg" />
          <Dropdown aria-label="Payment" value={paymentFilter} onChange={setPaymentFilter} options={PAYMENT_FILTERS} className="w-32" triggerClassName="py-1.5 text-xs rounded-lg" />
          {filtersOn && (
            <button type="button" onClick={clearFilters} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
              <X size={12} /> Clear
            </button>
          )}
        </div>
        {datePickerOpen && (
          <DateRangeCalendar
            open={datePickerOpen}
            onClose={() => setDatePickerOpen(false)}
            anchorRef={dateAnchor}
            initialStart={customStart || undefined}
            initialEnd={customEnd || undefined}
            onApply={(start, end) => {
              setCustomStart(start);
              setCustomEnd(end);
              setDateFilter("custom");
              setDatePickerOpen(false);
            }}
          />
        )}
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
            <Button variant="secondary" onClick={askBulkUpaya} disabled={sendingUpaya} className="px-3 py-1.5 text-xs rounded-lg">
              <Truck size={13} /> {sendingUpaya ? "Sending…" : "Send to Upaya"}
            </Button>
            <Button variant="secondary" onClick={() => setSelectedIds(new Set())} className="px-3 py-1.5 text-xs rounded-lg">Clear</Button>
            <Button variant="danger" onClick={askBulkDelete} className="px-3 py-1.5 text-xs rounded-lg">
              <Trash2 size={13} /> Delete Selected
            </Button>
          </div>
        </div>
      )}

      {/* Orders Table: the rows scroll, the column names stay on top */}
      <div className="bg-card border border-border/80 rounded-2xl shadow-sm overflow-hidden flex flex-col lg:min-h-[20rem] lg:flex-1">
        <div ref={tableScroll} className="max-h-[calc(100dvh-8rem)] overflow-auto overscroll-contain lg:max-h-none lg:min-h-0 lg:flex-1">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={cn(stickyTh, "px-5 py-3 w-10")}>
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
                  <tr key={sale.id} onClick={(e) => openCustomer(e, key)} className={cn("data-row cursor-pointer", selectedIds.has(sale.id) && "bg-primary/5")}>
                    <td className="px-5 py-3.5">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(sale.id)}
                        onChange={() => toggleSelected(sale.id)}
                        aria-label={`Select order ${sale.invoiceNumber}`}
                        className="w-4 h-4 rounded border-border cursor-pointer accent-primary"
                      />
                    </td>
                    <td className="px-5 py-3.5 text-xs text-muted-foreground font-medium hidden sm:table-cell">{pager.offset + i + 1}</td>
                    <td className="px-5 py-3.5 text-xs text-muted-foreground font-medium whitespace-nowrap hidden md:table-cell">{new Date(sale.createdAt).toLocaleDateString()}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5">
                        <Link href={`/customers/${encodeURIComponent(key)}`} className="font-bold text-xs font-mono hover:text-primary transition-colors whitespace-nowrap">
                          {sale.invoiceNumber}
                        </Link>
                        {sale.source === "website" && (
                          <span className="flex items-center gap-1 text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded-full whitespace-nowrap bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400">
                            <Globe size={9} /> Website
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5 md:hidden">{new Date(sale.createdAt).toLocaleDateString()}</p>
                    </td>
                    <td className="px-5 py-3.5 font-semibold text-xs">
                      {sale.customerName || "Walk-in Customer"}
                      {sale.customer && <p className="text-[11px] text-muted-foreground mt-0.5 font-mono font-medium">{sale.customer.code}</p>}
                      <p className="text-[11px] text-muted-foreground mt-0.5 font-normal lg:hidden">{sale.customerPhone || "—"}</p>
                    </td>
                    <td className="px-5 py-3.5 text-xs hidden lg:table-cell">
                      <span className={cn(!sale.customerPhone && "text-muted-foreground italic")}>
                        {sale.customerPhone || "—"}
                      </span>
                      {sale.customerAddress && (
                        <p className="text-[11px] text-muted-foreground mt-0.5 truncate max-w-[140px]" title={sale.customerAddress}>{sale.customerAddress}</p>
                      )}
                      {sale.courierAreaTitle && (
                        <p className="text-[11px] text-muted-foreground mt-0.5 truncate max-w-[140px]" title={sale.courierAreaTitle}>Hub: {sale.courierAreaTitle}</p>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right whitespace-nowrap">
                      <span className="font-bold text-xs">{formatNPR(sale.codAmount || sale.totalAmount)}</span>
                    </td>
                    <td className="px-5 py-3.5 text-right hidden lg:table-cell whitespace-nowrap">
                      <span className="font-extrabold text-xs">{formatNPR(sale.deliveryAmount ?? 0)}</span>
                    </td>
                    <td className="px-5 py-3.5 hidden sm:table-cell">
                      <span className={cn("text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full whitespace-nowrap", DELIVERY_STYLES[sale.deliveryStatus] ?? DELIVERY_STYLES.IN_PROCESS)}>
                        {DELIVERY_STATUSES.find(d => d.value === sale.deliveryStatus)?.label ?? "In Process"}
                      </span>
                      {sale.courierStatus && (
                        <p className="mt-1">
                          <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap", courierStatusStyle(sale.courierStatus))}>
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
          {!loading && filtered.length === 0 && (
            sales.length === 0 ? (
              <EmptyState icon={Users} title="No customers yet" description="Orders appear here automatically once a sale is recorded in the POS." />
            ) : (
              <EmptyState icon={Search} title="No matching orders" description="Try adjusting your search or filters." />
            )
          )}
        </div>

        {!loading && (
          <Pagination
            page={pager.page}
            pageCount={pager.pageCount}
            pageSize={pager.pageSize}
            total={pager.total}
            offset={pager.offset}
            onPage={goToPage}
            onPageSize={changePageSize}
          />
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
            {editing?.courierTrackingCode && <p className="text-[12px] text-muted-foreground">Upaya keeps the amount it was booked with. Changing it here doesn&apos;t update the rider.</p>}
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

      <Modal
        open={upayaBatch !== null}
        onClose={() => setUpayaBatch(null)}
        title={upayaBatch && upayaBatch.ready.length > 0 ? `Send ${upayaBatch.ready.length} order${upayaBatch.ready.length === 1 ? "" : "s"} to Upaya?` : "Nothing to send to Upaya"}
        size="sm"
      >
        {upayaBatch && (
          <div className="p-5 space-y-4 text-sm">
            {upayaBatch.ready.length > 0 && (
              <p className="text-muted-foreground">
                Each is booked door to door with its hub location, COD amount and items, and Upaya will come to collect it.
              </p>
            )}
            {upayaBatch.skipped.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground">Not sent ({upayaBatch.skipped.length})</p>
                <ul className="mt-1.5 max-h-48 overflow-y-auto space-y-1 text-xs">
                  {upayaBatch.skipped.map(({ sale, reason }) => (
                    <li key={sale.id} className="flex gap-2">
                      <span className="font-mono shrink-0">{sale.invoiceNumber}</span>
                      <span className="text-muted-foreground min-w-0">{sale.customerName ?? "Walk-in"}: {reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <Button variant="secondary" onClick={() => setUpayaBatch(null)} className="flex-1">
                {upayaBatch.ready.length > 0 ? "Cancel" : "Close"}
              </Button>
              {upayaBatch.ready.length > 0 && (
                <Button onClick={sendBatchToUpaya} className="flex-1">
                  <Truck size={14} /> Send {upayaBatch.ready.length}
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>

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
