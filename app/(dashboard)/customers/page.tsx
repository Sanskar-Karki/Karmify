"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search, Users, ChevronRight, Plus, Edit2, X, Calendar, RefreshCw, Globe, Trash2,
  ShoppingBag, Wallet, Truck, Download, Tag, Receipt, ClipboardList, ArchiveRestore,
  ListChecks,
} from "lucide-react";
import { RecentlyDeletedDialog } from "@/components/orders/RecentlyDeletedDialog";
import { FutureOrdersPanel } from "@/components/orders/FutureOrdersPanel";
import { ExchangeBadge } from "@/components/orders/ExchangeInfo";
import { awaitingReturn, exchangeOf } from "@/lib/exchange";
import { editedTotal, linesFromSale, linesGoods, linesSignature, OrderItemsEditor, stockChanges, type EditLine } from "@/components/orders/OrderItemsEditor";
import { ItemChangeConfirm } from "@/components/orders/ItemChangeConfirm";
import { PackingListDialog } from "@/components/orders/PackingListDialog";
import { HubEditField, hubChanged, hubOf, serviceOf } from "@/components/orders/HubEditField";
import { VALLEY_LABELS, valleyOf, type CourierArea } from "@/lib/courier";
import { useValleyLocations } from "@/lib/useValleyLocations";
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
import { UpayaBatchDialog, type UpayaBatch, type UpayaServices } from "@/components/shared/UpayaBatchDialog";
import { ORDER_COLUMNS, PlaceholderRows } from "@/components/skeletons/placeholders";
import { Pagination, usePagination } from "@/components/shared/Pagination";
import { useResources } from "@/lib/useResources";
import { useCourierAutoRefresh } from "@/lib/useCourierAutoRefresh";
import { resources } from "@/lib/resources";
import { mutate } from "@/lib/mutate";
import { countsAsSale, customerKey, deliveryAddress, DELIVERY_STATUSES, DELIVERY_STYLES, sentWithUpaya, SENT_STATUS_BORDER,instantCourierLabel, isPR, itemName, codToCollect, codAmountOf, referralLabel, isFromAd,
} from "@/lib/orders";
import { useUrlState } from "@/lib/useUrlState";
import { useOwnerUnlocked } from "@/lib/ownerLock";
import { useOrderFilters } from "@/lib/useOrderFilters";
import { downloadCsv } from "@/lib/csv";
import { parseCustomerCode } from "@/lib/customerIdentity";
import { COURIER_FINAL_STATUSES, courierMobile, courierStatusLabel, courierStatusStyle, DOOR_TO_DOOR } from "@/lib/courier";
import { useStoreProfile } from "@/lib/storeProfile";
import { channelOf, upayaSentAt, upayaTotals } from "@/lib/analytics";
import { DateRangeCalendar, shortDay } from "@/components/shared/DateRangeCalendar";
import type { Sale } from "@/lib/types";

type DeliveryStatus = "IN_PROCESS" | "DELIVERED" | "RETURN_PROCESS" | "RETURNED" | "CANCELLED";

const DATE_FILTERS = [
  { value: "all", label: "All Time" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "3days", label: "Last 3 Days" },
  { value: "7days", label: "Last 7 Days" },
  { value: "week", label: "This Week" },
  { value: "30days", label: "Last 30 Days" },
  { value: "month", label: "This Month" },
  { value: "lastmonth", label: "Last Month" },
  { value: "custom", label: "Custom" },
];

const SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "high", label: "Highest total" },
  { value: "low", label: "Lowest total" },
];

/** A filter dropdown, tinted while it's set to something other than its default. */
const filterTrigger = (active: boolean) =>
  cn("py-2 sm:py-1.5 text-xs rounded-lg", active && "border-primary/50 bg-primary/5 font-semibold text-foreground");

/** Phone-like words ("+977 9841-234567") compare by digits, without the country code. */
const phoneDigits = (v: string) => v.replace(/\D/g, "").replace(/^977(?=\d{10}$)/, "");

/**
 * Search: every word typed must appear somewhere in the order (name, phone,
 * address, hub, items, order or customer ID, tracking code), in any order, so
 * "hoodie lalitpur" or "ram 9841" narrow it down. A scanned label's customer
 * code finds exactly that customer.
 */
function searchMatcher(search: string): (sale: Sale) => boolean {
  const code = parseCustomerCode(search);
  if (code) return s => (s.customer?.code ?? "").toLowerCase() === code.toLowerCase();
  // A pasted "+977 98…" keeps its number together without the country code.
  const words = search.replace(/(^|\s)\+?977[\s-]+(?=\d)/g, "$1").toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return () => true;
  const cache = new WeakMap<Sale, string>();
  const textOf = (s: Sale) => {
    let text = cache.get(s);
    if (text === undefined) {
      text = [
        s.customerName, s.customerPhone, phoneDigits(s.customerPhone ?? ""), s.customerAddress, s.courierAreaTitle,
        s.customer?.code, s.courierTrackingCode, s.invoiceNumber, ...s.items.map(itemName),
      ].filter(Boolean).join(" ").toLowerCase();
      cache.set(s, text);
    }
    return text;
  };
  return s => {
    const text = textOf(s);
    return words.every(w => {
      if (text.includes(w)) return true;
      const digits = /^[\d+\-()]+$/.test(w) ? phoneDigits(w) : "";
      return digits.length >= 3 && text.includes(digits);
    });
  };
}

// Where an order came from, matching the Analytics channels.
const SOURCE_FILTERS = [
  { value: "all", label: "All sources" },
  { value: "waiting", label: "Waiting to send" },
  { value: "upaya", label: "Sent with Upaya" },
  { value: "instant", label: "Sent with Yango" },
  { value: "website", label: "Website" },
  { value: "pos", label: "Shop (POS)" },
  { value: "store", label: "In store" },
  { value: "pr", label: "PR (given free)" },
  { value: "ad", label: "From an ad" },
  { value: "exchange", label: "Exchanges" },
  { value: "exchange-due", label: "Exchanges due back" },
];

const AREA_FILTERS = [
  { value: "all", label: "Any area" },
  { value: "inside", label: VALLEY_LABELS.inside },
  { value: "outside", label: VALLEY_LABELS.outside },
  { value: "none", label: VALLEY_LABELS.none },
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
  // Same rule as Analytics "Sent with Upaya": booked, and not cancelled there.
  if (source === "upaya") return upayaSentAt(sale) !== null;
  // Delivery orders still to go out: in process, not booked with Upaya or a ride app.
  if (source === "waiting") {
    return sale.deliveryStatus === "IN_PROCESS" && upayaSentAt(sale) === null && !sale.deliveryVia && channelOf(sale) !== "store";
  }
  if (source === "instant") return Boolean(sale.deliveryVia);
  if (source === "pr") return sale.kind === "pr";
  if (source === "ad") return isFromAd(sale.referral);
  // Exchange orders, and the ones whose old items haven't been ticked received yet.
  if (source === "exchange") return exchangeOf(sale) !== null;
  if (source === "exchange-due") return awaitingReturn(sale);
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
  if (filter === "7days" || filter === "30days") {
    const start = new Date(today);
    start.setDate(start.getDate() - (filter === "7days" ? 6 : 29));
    return date >= start;
  }
  if (filter === "lastmonth") {
    return date >= new Date(today.getFullYear(), today.getMonth() - 1, 1) && date < new Date(today.getFullYear(), today.getMonth(), 1);
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

/**
 * The COD column: what the rider still has to collect, or, once paid, the
 * amount collected with "Paid" under it. Orders paid at the till or by QR
 * have nothing to collect, so they show what was paid and how (Cash or QR).
 */
function CodAmount({ sale }: { sale: Sale }) {
  if (sale.paymentMethod === "COD" && sale.paymentStatus === "PAID") {
    return (
      <span title="Paid: nothing left to collect">
        {codAmountOf(sale) > 0 && <span className="block font-bold text-xs text-muted-foreground">{formatNPR(codAmountOf(sale))}</span>}
        <span className="block text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">Paid</span>
      </span>
    );
  }
  if (sale.paymentMethod === "COD") return <span className="font-bold text-xs">{formatNPR(codToCollect(sale))}</span>;
  // PR orders are given free: nothing was paid.
  if (sale.kind === "pr" || !(sale.totalAmount > 0)) return <span className="text-xs text-muted-foreground">—</span>;
  const method = sale.paymentMethod === "QR" ? "QR" : "Cash";
  const paid = sale.paymentStatus === "PAID";
  return (
    <span title={`${paid ? "Paid" : "To be paid"} by ${method}: nothing for the rider to collect`}>
      <span className="block font-bold text-xs text-muted-foreground">{formatNPR(sale.totalAmount)}</span>
      <span className={cn("block text-[11px] font-semibold", paid ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
        {paid ? method : `${method} · unpaid`}
      </span>
    </span>
  );
}

const fieldClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20";

export default function CustomersPage() {
  const { sales, loading, refetch } = useResources({ sales: resources.sales });
  const store = useStoreProfile();
  const router = useRouter();

  // A click anywhere on an order row opens that customer, except on the row's own
  // controls (tick box, menus, buttons, links) or menus/dialogs opened from it.
  const openCustomer = (e: React.MouseEvent<HTMLElement>, key: string) => {
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
  // Kept while moving between pages, reset by a reload. Analytics links here
  // with ?source=upaya&filter=custom&from=…&to=…, the search with ?q=….
  const { filters, update: updateFilters, reset: clearFilters } = useOrderFilters();
  const {
    q: search, filter: dateFilter, from: customStart, to: customEnd,
    source: sourceFilter, area: areaFilter, payment: paymentFilter, status: statusFilter, sort,
  } = filters;
  const setSearch = (q: string) => updateFilters({ q });
  const setStatusFilter = (status: string) => updateFilters({ status });
  // Area: inside or outside the Kathmandu valley, by the order's Upaya hub.
  const valleyLive = useValleyLocations();
  // ?future=1 (from the POS) opens the Future orders section.
  const [futureParam] = useUrlState("future");
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const dateAnchor = useRef<HTMLDivElement>(null);

  const [editing, setEditing] = useState<Sale | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState(BLANK_EDIT);
  const [initialEdit, setInitialEdit] = useState(BLANK_EDIT);
  // The order's items and discount as edited; COD follows the new total until it's typed by hand.
  const [editLines, setEditLines] = useState<EditLine[]>([]);
  const [editDiscount, setEditDiscount] = useState("0");
  const [codTouched, setCodTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  // Asked before saving when items come off or go on the order.
  const [confirmingItems, setConfirmingItems] = useState(false);

  const [syncing, setSyncing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // The last order ticked or unticked, where a Shift-click range starts.
  const selectAnchor = useRef<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // The orders shown in the delete confirmation: exactly these are deleted.
  const [toDelete, setToDelete] = useState<Sale[]>([]);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  // Orders whose status is being changed from their row's status menu.
  const [statusSaving, setStatusSaving] = useState<Set<string>>(() => new Set());
  const [bulkLabelsOpen, setBulkLabelsOpen] = useState(false);
  const [packingOpen, setPackingOpen] = useState(false);
  const [editHub, setEditHub] = useState<CourierArea | null>(null);
  const [editService, setEditService] = useState<number>(3);
  const [trashOpen, setTrashOpen] = useState(false);
  // Receipts to print: one order's (row button) or the ticked ones (bulk).
  const [receiptSales, setReceiptSales] = useState<Sale[]>([]);
  // Deleting puts the items back in stock unless unticked (the usual case).
  const [restock, setRestock] = useState(true);
  // Bulk "Send to Upaya": the ticked orders that can go, and the rest with why not.
  const [upayaBatch, setUpayaBatch] = useState<UpayaBatch | null>(null);
  const [sendingUpaya, setSendingUpaya] = useState(false);

  // With "Sent with Upaya" the dates mean the day it was sent, not the day it was ordered.
  const byUpayaSend = sourceFilter === "upaya";
  const dateOf = useCallback((s: Sale) => (byUpayaSend ? upayaSentAt(s) ?? s.createdAt : s.createdAt), [byUpayaSend]);

  // Everything except the status, so each status chip can show its own count.
  const beforeStatus = useMemo(() => {
    const matches = searchMatcher(search);
    const rows = sales.filter(s =>
      matches(s) &&
      isWithinDateFilter(dateOf(s), dateFilter, customStart, customEnd) &&
      matchesSource(s, sourceFilter) &&
      (areaFilter === "all" || valleyOf(s, valleyLive) === areaFilter) &&
      (paymentFilter === "all" || s.paymentStatus === paymentFilter)
    );
    // Newest/oldest go by the date the filters use (with "Sent with Upaya", the day it was sent).
    const time = (s: Sale) => new Date(dateOf(s)).getTime();
    const by: Record<string, (a: Sale, b: Sale) => number> = {
      newest: (a, b) => time(b) - time(a),
      oldest: (a, b) => time(a) - time(b),
      high: (a, b) => b.totalAmount - a.totalAmount || time(b) - time(a),
      low: (a, b) => a.totalAmount - b.totalAmount || time(b) - time(a),
    };
    return rows.sort(by[sort] ?? by.newest);
  }, [sales, search, dateFilter, customStart, customEnd, sourceFilter, areaFilter, valleyLive, paymentFilter, sort, dateOf]);

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of beforeStatus) counts.set(s.deliveryStatus, (counts.get(s.deliveryStatus) ?? 0) + 1);
    return counts;
  }, [beforeStatus]);

  const filtered = useMemo(
    () => (statusFilter === "all" ? beforeStatus : beforeStatus.filter(s => s.deliveryStatus === statusFilter)),
    [beforeStatus, statusFilter]
  );
  // How many filters differ from the defaults (the search counts as one).
  const activeCount = [
    search.trim() !== "", dateFilter !== "all", sourceFilter !== "all", areaFilter !== "all",
    paymentFilter !== "all", statusFilter !== "all", sort !== "newest",
  ].filter(Boolean).length;
  const customLabel = customStart
    ? customStart === customEnd || !customEnd ? shortDay(customStart) : `${shortDay(customStart)} – ${shortDay(customEnd)}`
    : "Pick dates";

  const pager = usePagination(filtered, "customers");
  const displayed = pager.visible;
  const tableScroll = useRef<HTMLDivElement>(null);
  const toListTop = () => {
    const box = tableScroll.current;
    if (!box) return;
    if (box.scrollHeight > box.clientHeight) box.scrollTo({ top: 0 });
    else box.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const goToPage = (p: number) => {
    pager.setPage(p);
    toListTop();
  };
  const changePageSize = (size: number) => {
    pager.setPageSize(size);
    toListTop();
  };

  // Only rows currently on screen count as selected, so changing a filter can
  // never leave hidden orders queued for deletion.
  const selectedVisible = useMemo(() => displayed.filter(s => selectedIds.has(s.id)), [displayed, selectedIds]);
  const allVisibleSelected = displayed.length > 0 && selectedVisible.length === displayed.length;

  // Sent with Upaya: the same three numbers Analytics shows for these days.
  // The owner unlocked Dashboard & Analytics on this device; elsewhere it's staff.
  const ownerUnlocked = useOwnerUnlocked();
  const upayaSummary = useMemo(() => (byUpayaSend ? upayaTotals(filtered) : null), [byUpayaSend, filtered]);
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
    if (e.key === "Escape" && search) {
      setSearch("");
      return;
    }
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

  /**
   * Ticks or unticks one order. With Shift held, every order between the last
   * one clicked and this one gets the same tick (like a file list or Gmail).
   */
  function toggleSelected(id: string, shiftKey = false) {
    const anchor = selectAnchor.current;
    selectAnchor.current = id;
    const checking = !selectedIds.has(id);
    const from = anchor ? displayed.findIndex(s => s.id === anchor) : -1;
    const to = displayed.findIndex(s => s.id === id);

    setSelectedIds(prev => {
      const next = new Set(prev);
      const ids = shiftKey && from !== -1 && to !== -1
        ? displayed.slice(Math.min(from, to), Math.max(from, to) + 1).map(s => s.id)
        : [id];
      for (const rowId of ids) {
        if (checking) next.add(rowId);
        else next.delete(rowId);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds(allVisibleSelected ? new Set() : new Set(displayed.map(s => s.id)));
  }

  /** One order's status, changed from the status menu in its row (COD payment follows it, as in Edit). */
  async function changeRowStatus(sale: Sale, status: string) {
    if (status === sale.deliveryStatus) return;
    const label = DELIVERY_STATUSES.find(d => d.value === status)?.label ?? status;
    setStatusSaving(prev => new Set(prev).add(sale.id));
    const result = await mutate(() => updateSaleDetails(sale.id, { deliveryStatus: status as DeliveryStatus }), {
      success: `${sale.invoiceNumber} marked ${label}.`,
    });
    if (result.ok) await refetch();
    setStatusSaving(prev => {
      const next = new Set(prev);
      next.delete(sale.id);
      return next;
    });
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
        : sale.deliveryVia
          ? `sent with ${instantCourierLabel(sale.deliveryVia) ?? "a ride app"}`
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
  async function sendBatchToUpaya(services: UpayaServices) {
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
      const result = await bookSaleWithUpaya(sale.id, services[sale.id] ?? sale.courierServiceId ?? DOOR_TO_DOOR).catch(() => null);
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
    setRestock(true);
    setToDelete(selectedVisible);
    setConfirmOpen(true);
  }

  async function handleBulkDelete() {
    const ids = toDelete.map(s => s.id);
    const result = await mutate(() => deleteSales(ids, { restock }), {
      success: data => `Deleted ${data.deleted} order${data.deleted === 1 ? "" : "s"}${data.restocked ? ` and returned ${data.restocked} unit${data.restocked === 1 ? "" : "s"} to stock` : ""}.`,
    });
    setConfirmOpen(false);
    if (!result.ok) return;
    setSelectedIds(new Set());
    await refetch();
  }

  /** Exports the ticked orders when any are ticked, otherwise every order the filters show. */
  function exportCsv() {
    const rows = selectedVisible.length > 0 ? selectedVisible : filtered;
    const which = selectedVisible.length > 0 ? "selected" : "filtered";
    downloadCsv(
      `karmify-orders-${which}-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Date", "Order ID", "Source", "Customer ID", "Customer", "Phone", "Address", "Items", "Total", "COD Amount", "Delivery Amount", "Delivery Status", "Payment Status", "Upaya Tracking Code", "Upaya Status"],
      rows.map(s => [
        new Date(s.createdAt).toLocaleString(),
        s.invoiceNumber,
        exchangeOf(s) ? `${s.source} · exchange for ${exchangeOf(s)!.ofInvoice}` : s.source,
        s.customer?.code,
        s.customerName,
        s.customerPhone,
        s.customerAddress,
        s.items.map(item => `${item.quantity} x ${itemName(item)}`).join("; "),
        s.totalAmount,
        s.codAmount,
        s.deliveryAmount,
        DELIVERY_STATUSES.find(d => d.value === s.deliveryStatus)?.label ?? s.deliveryStatus,
        s.paymentStatus,
        s.courierTrackingCode,
        s.courierStatus ? courierStatusLabel(s.courierStatus) : "",
      ])
    );
    toast.success(`Exported ${rows.length} ${which} order${rows.length === 1 ? "" : "s"}.`);
  }

  function startEdit(sale: Sale) {
    const next = {
      customerName: sale.customerName ?? "",
      customerPhone: sale.customerPhone ?? "",
      customerAddress: sale.customerAddress ?? "",
      // Cash at the till or QR: nothing to collect, so no COD amount is suggested.
      codAmount: String(codToCollect(sale)),
      deliveryAmount: String(sale.deliveryAmount ?? 0),
      deliveryStatus: sale.deliveryStatus ?? "IN_PROCESS",
    };
    setEditing(sale);
    setEditHub(hubOf(sale));
    setEditService(serviceOf(sale));
    setEditForm(next);
    setInitialEdit(next);
    setEditLines(linesFromSale(sale));
    setEditDiscount(String(sale.discount ?? 0));
    setCodTouched(false);
    setShowEdit(true);
  }


  /**
   * COD follows the order total plus delivery: it moves by the same amount they
   * moved from the saved order, until it's typed by hand.
   */
  function followCod(f: typeof BLANK_EDIT, lines: EditLine[], discount: string): typeof BLANK_EDIT {
    if (!editing || codTouched || editing.paymentMethod !== "COD" || editing.paymentStatus === "PAID" || editing.kind === "pr") return f;
    const total = itemsAreEdited(lines, discount) ? editedTotal(editing, lines, discount) : editing.totalAmount;
    const moved = total + (parseFloat(f.deliveryAmount) || 0) - editing.totalAmount - (editing.deliveryAmount ?? 0);
    const cod = Math.max(0, (parseFloat(initialEdit.codAmount) || 0) + moved);
    return { ...f, codAmount: String(Math.round(cod * 100) / 100) };
  }

  const itemsAreEdited = (lines: EditLine[], discount: string) => editing !== null && (
    linesSignature(lines) !== linesSignature(linesFromSale(editing)) || (parseFloat(discount) || 0) !== (editing.discount ?? 0)
  );

  /** New items or discount: the COD to collect follows the new total. */
  function changeItems(lines: EditLine[], discount: string) {
    setEditLines(lines);
    setEditDiscount(discount);
    setEditForm(f => followCod(f, lines, discount));
  }

  /** A new delivery charge, typed or from Upaya's price for a new hub: COD follows. */
  function changeDelivery(value: string) {
    setEditForm(f => followCod({ ...f, deliveryAmount: value }, editLines, editDiscount));
  }

  const itemsChanged = itemsAreEdited(editLines, editDiscount);
  const itemChanges = editing && itemsChanged ? stockChanges(editing, editLines) : { removed: [], added: [] };

  /** Checks the form, then asks first when items come off or go on the order. */
  function saveEdit() {
    if (!editing) return;
    if (!editForm.customerName.trim() && !editForm.customerPhone.trim()) {
      toast.error("Enter a customer name or phone number.");
      return;
    }
    if (itemsChanged && editing.kind !== "pr" && (parseFloat(editDiscount) || 0) > linesGoods(editLines)) {
      toast.error("The discount is more than the items are worth.");
      return;
    }
    if (itemChanges.removed.length > 0 || itemChanges.added.length > 0) {
      setConfirmingItems(true);
      return;
    }
    return commitEdit(false);
  }

  async function commitEdit(putBackRemoved: boolean) {
    if (!editing) return;
    setSaving(true);
    const result = await mutate(
      () => updateSaleDetails(editing.id, {
        // Items only when changed: saving moves stock by the difference.
        ...(itemsChanged && {
          items: editLines.map(l => ({ itemId: l.itemId, productId: l.productId, variantId: l.variantId, quantity: l.quantity, unitPrice: l.unitPrice })),
          discount: Math.max(0, parseFloat(editDiscount) || 0),
          putBackRemoved,
        }),
        customerName: editForm.customerName,
        customerPhone: editForm.customerPhone,
        customerAddress: editForm.customerAddress,
        // Only amounts that were changed are saved, so fixing a name can't rewrite them.
        ...(editForm.codAmount !== initialEdit.codAmount && { codAmount: parseFloat(editForm.codAmount) || 0 }),
        ...(editForm.deliveryAmount !== initialEdit.deliveryAmount && { deliveryAmount: parseFloat(editForm.deliveryAmount) || 0 }),
        deliveryStatus: editForm.deliveryStatus as DeliveryStatus,
        ...(editService !== serviceOf(editing) && { courierServiceId: editService }),
        ...(hubChanged(editing, editHub) && { courierArea: editHub ? { areaId: editHub.areaId, locationId: editHub.locationId, title: editHub.title } : null }),
      }),
      { success: `${editing.invoiceNumber} updated.` }
    );
    if (result.ok) {
      setShowEdit(false);
      await refetch();
    }
    setSaving(false);
    // Failed or not, back to the form: a stock error is fixed there.
    setConfirmingItems(false);
  }

  const setField = (field: keyof typeof BLANK_EDIT) => (e: React.ChangeEvent<HTMLInputElement>) => {
    if (field === "codAmount") setCodTouched(true);
    setEditForm(f => ({ ...f, [field]: e.target.value }));
  };

  const hasOpenShipments = sales.some(s => s.courierTrackingCode && !COURIER_FINAL_STATUSES.includes(s.courierStatus ?? ""));
  // Upaya statuses update in the list on their own, without opening each order's tracking popup.
  useCourierAutoRefresh(hasOpenShipments, () => refetch({ quiet: true }));
  const iconButton = "w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-muted transition-colors";
  // Phones: bigger, for fingers.
  const phoneIconButton = "w-9 h-9 flex items-center justify-center rounded-lg border border-border bg-background hover:bg-muted active:scale-95 transition";
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
            {(upayaSummary
              ? [
                  { label: upayaSummary.parcels === 1 ? "parcel sent with Upaya" : "parcels sent with Upaya", val: upayaSummary.parcels.toLocaleString(), icon: Truck },
                  { label: "order value sent", val: formatNPR(upayaSummary.value), icon: Wallet, money: true },
                  { label: "COD for Upaya to collect", val: formatNPR(upayaSummary.cod), icon: Receipt, money: true },
                ]
              : [
                  { label: filtered.length === 1 ? "order" : "orders", val: filtered.length.toLocaleString(), icon: ShoppingBag },
                  { label: "revenue", val: formatNPR(summary.revenue), icon: Wallet, money: true },
                  { label: "to deliver", val: summary.pending.toLocaleString(), icon: Truck },
                  { label: "unpaid", val: summary.unpaid.toLocaleString(), icon: Receipt },
                ]
            // Money totals are for the owner: staff (Dashboard not unlocked here) see only the counts.
            ).filter(stat => ownerUnlocked || !("money" in stat)).map(stat => (
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
              placeholder="Name, phone, address, item, order ID…"
              title="Every word must match: try “hoodie lalitpur” or “ram 9841”. Searches name, phone, address, hub, items, order and customer ID, and tracking code."
              aria-label="Search orders"
              className={cn(
                "w-full pl-8.5 py-2 rounded-lg border bg-background text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/20",
                search ? "pr-8 border-primary/50" : "pr-3 border-border"
              )}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X size={13} />
              </button>
            )}
          </div>
          {/* On phones the less-used buttons are icons only, so the actions fit on one row. */}
          <Button variant="secondary" onClick={() => setTrashOpen(true)} aria-label="Recently deleted" className="w-10 flex-none px-0 py-2 rounded-lg text-[13px] whitespace-nowrap sm:w-auto sm:px-3" title="Orders deleted in the last 30 days">
            <ArchiveRestore size={14} /> <span className="hidden sm:inline">Recently deleted</span>
          </Button>
          <Button
            variant="secondary"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            aria-label={selectedVisible.length > 0 ? `Export ${selectedVisible.length} selected` : "Export"}
            title={selectedVisible.length > 0 ? `Export ${selectedVisible.length} selected` : "Export the orders shown"}
            className="w-10 flex-none px-0 py-2 rounded-lg text-[13px] sm:w-auto sm:px-3"
          >
            <Download size={14} /> <span className="hidden sm:inline">{selectedVisible.length > 0 ? `Export ${selectedVisible.length} selected` : "Export"}</span>
          </Button>
          <Button variant="secondary" onClick={handleSyncWebsiteOrders} disabled={syncing} className="flex-1 sm:flex-none px-3 py-2 rounded-lg text-[13px] whitespace-nowrap" title="Check the website for new orders">
            <RefreshCw size={14} className={cn(syncing && "animate-spin")} />
            {syncing ? "Syncing..." : <><span className="sm:hidden">Sync</span><span className="hidden sm:inline">Sync Website</span></>}
          </Button>
          {hasOpenShipments && (
            <Button variant="secondary" onClick={handleRefreshCourier} disabled={refreshingCourier} aria-label="Refresh Upaya" title="Check Upaya for updates" className="w-10 flex-none px-0 py-2 rounded-lg text-[13px] whitespace-nowrap sm:w-auto sm:px-3">
              <Truck size={14} className={cn(refreshingCourier && "animate-pulse")} /> <span className="hidden sm:inline">Refresh Upaya</span>
            </Button>
          )}
          <Link
            href="/upaya"
            aria-label="Upaya follow-up"
            title="Only the orders booked with Upaya, by where they are now, for follow-up"
            className="flex w-10 flex-none items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-0 py-2 text-[13px] font-semibold text-foreground hover:bg-muted transition-colors whitespace-nowrap sm:w-auto sm:px-3"
          >
            <ListChecks size={14} /> <span className="hidden sm:inline">Upaya follow-up</span>
          </Link>
          <Link
            href="/sales"
            className="flex items-center justify-center gap-1.5 flex-1 sm:flex-none px-3.5 py-2 text-[13px] font-semibold bg-primary text-primary-foreground rounded-lg shadow-sm shadow-primary/20 hover:bg-primary/90 transition-colors whitespace-nowrap"
          >
            <Plus size={14} /> New Order
          </Link>
        </div>
      </div>

      {/* Orders to send later, once restocked: not in the table or the totals until moved */}
      <FutureOrdersPanel startOpen={futureParam === "1"} onMoved={() => refetch({ quiet: true })} />

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
                  "flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 sm:py-1 text-xs font-semibold transition-all whitespace-nowrap",
                  active ? "bg-card text-foreground shadow-sm ring-1 ring-border/60" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {st.label}
                <span className={cn("text-[11px] font-bold tabular-nums", active ? "text-primary" : "text-muted-foreground")}>{count}</span>
              </button>
            );
          })}
        </div>
        <div className="-mx-3 flex items-center gap-1.5 overflow-x-auto px-3 pb-0.5 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
          <div ref={dateAnchor} className="flex shrink-0 items-center gap-1.5">
            <Dropdown
              aria-label="Date"
              value={dateFilter}
              onChange={v => {
                updateFilters({ filter: v });
                if (v === "custom") setDatePickerOpen(true);
              }}
              options={DATE_FILTERS}
              className="w-32"
              triggerClassName={filterTrigger(dateFilter !== "all")}
            />
            {dateFilter === "custom" && (
              <button type="button" onClick={() => setDatePickerOpen(o => !o)} className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-muted whitespace-nowrap">
                <Calendar size={13} /> {customLabel}
              </button>
            )}
          </div>
          <Dropdown aria-label="Source" value={sourceFilter} onChange={v => updateFilters({ source: v })} options={SOURCE_FILTERS} className="w-36 shrink-0" triggerClassName={filterTrigger(sourceFilter !== "all")} />
          <Dropdown aria-label="Area" value={areaFilter} onChange={v => updateFilters({ area: v })} options={AREA_FILTERS} className="w-36 shrink-0" triggerClassName={filterTrigger(areaFilter !== "all")} />
          <Dropdown aria-label="Payment" value={paymentFilter} onChange={v => updateFilters({ payment: v })} options={PAYMENT_FILTERS} className="w-32 shrink-0" triggerClassName={filterTrigger(paymentFilter !== "all")} />
          <Dropdown aria-label="Sort" value={sort} onChange={v => updateFilters({ sort: v })} options={SORT_OPTIONS} className="w-36 shrink-0" triggerClassName={filterTrigger(sort !== "newest")} />
          {activeCount > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              title="Clear the search, every filter and the sort"
              className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground whitespace-nowrap"
            >
              <X size={12} /> Clear all
              <span className="rounded-full bg-primary/10 px-1.5 text-[11px] font-bold tabular-nums text-primary">{activeCount}</span>
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
              updateFilters({ from: start, to: end, filter: "custom" });
              setDatePickerOpen(false);
            }}
          />
        )}
      </div>

      {/* Bulk actions on phones: float above the tab bar, so they're in reach
          wherever you are in the list. One row that scrolls sideways. */}
      {selectedVisible.length > 0 && (
        <div
          className="md:hidden fixed inset-x-2 z-20 rounded-2xl border border-border/80 bg-card/95 p-2 shadow-xl shadow-black/10 backdrop-blur-xl animate-fade-in"
          style={{ bottom: "calc(max(0.5rem, env(safe-area-inset-bottom)) + 4.75rem)" }}
        >
          <div className="flex items-center justify-between gap-2 px-1.5 pb-1.5">
            <span className="text-xs font-bold text-foreground">
              {selectedVisible.length} order{selectedVisible.length > 1 ? "s" : ""} selected
            </span>
            <button type="button" onClick={() => setSelectedIds(new Set())} className="h-8 rounded-lg px-2.5 text-xs font-semibold text-muted-foreground hover:bg-muted">
              Clear
            </button>
          </div>
          <div className="-mx-2 flex items-center gap-1.5 overflow-x-auto px-2 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <Dropdown
              aria-label="Set delivery status for selected orders"
              value=""
              onChange={applyBulkStatus}
              disabled={bulkUpdating}
              placeholder={bulkUpdating ? "Updating…" : "Set status…"}
              options={DELIVERY_STATUSES}
              className="w-36 shrink-0"
              triggerClassName="h-10 px-3 text-xs rounded-xl"
            />
            <Button variant="secondary" onClick={askBulkUpaya} disabled={sendingUpaya} className="h-10 shrink-0 whitespace-nowrap px-3 text-xs rounded-xl">
              <Truck size={14} /> {sendingUpaya ? "Sending…" : "Send to Upaya"}
            </Button>
            <Button variant="secondary" onClick={() => setBulkLabelsOpen(true)} className="h-10 shrink-0 whitespace-nowrap px-3 text-xs rounded-xl">
              <Tag size={14} /> Labels
            </Button>
            <Button variant="secondary" onClick={() => setReceiptSales(selectedVisible)} className="h-10 shrink-0 whitespace-nowrap px-3 text-xs rounded-xl">
              <Receipt size={14} /> Receipts
            </Button>
            <Button variant="secondary" onClick={() => setPackingOpen(true)} className="h-10 shrink-0 whitespace-nowrap px-3 text-xs rounded-xl">
              <ClipboardList size={14} /> Packing list
            </Button>
            <Button variant="secondary" onClick={exportCsv} className="h-10 shrink-0 whitespace-nowrap px-3 text-xs rounded-xl">
              <Download size={14} /> Export
            </Button>
            <Button variant="danger" onClick={askBulkDelete} className="h-10 shrink-0 whitespace-nowrap px-3 text-xs rounded-xl">
              <Trash2 size={14} /> Delete
            </Button>
          </div>
        </div>
      )}

      {/* Bulk action bar (tablet and up; phones get the floating one above) */}
      {selectedVisible.length > 0 && (
        <div className="hidden md:flex flex-wrap items-center justify-between gap-3 bg-card border border-border/80 rounded-2xl shadow-sm px-5 py-3 animate-fade-in">
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
            <Button variant="secondary" onClick={() => setPackingOpen(true)} className="px-3 py-1.5 text-xs rounded-lg">
              <ClipboardList size={13} /> Packing list
            </Button>
            <Button variant="secondary" onClick={() => setBulkLabelsOpen(true)} className="px-3 py-1.5 text-xs rounded-lg">
              <Tag size={13} /> Print labels
            </Button>
            <Button variant="secondary" onClick={() => setReceiptSales(selectedVisible)} className="px-3 py-1.5 text-xs rounded-lg">
              <Receipt size={13} /> Print receipts
            </Button>
            <Button variant="secondary" onClick={exportCsv} className="px-3 py-1.5 text-xs rounded-lg">
              <Download size={13} /> Export
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

      {/* Orders: cards on phones (the page scrolls); a table from tablet width up,
          where the rows scroll in their box and the column names stay on top */}
      <div className="bg-card border border-border/80 rounded-2xl shadow-sm overflow-hidden flex flex-col lg:min-h-[20rem] lg:flex-1">
        <div ref={tableScroll} className="scroll-mt-3 md:max-h-[calc(100dvh-8rem)] md:overflow-auto md:overscroll-contain lg:max-h-none lg:min-h-0 lg:flex-1">
          <div className="md:hidden">
            {!loading && displayed.length > 0 && (
              <label className="flex cursor-pointer items-center gap-3 border-b border-border/60 bg-muted/40 px-3.5 py-2.5 text-xs font-semibold text-muted-foreground">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleSelectAll}
                  className="h-5 w-5 rounded border-border accent-primary"
                />
                Select all on this page
              </label>
            )}
            {loading && (
              <div className="divide-y divide-border/40" aria-hidden>
                {Array.from({ length: 5 }, (_, i) => (
                  <div key={i} className="space-y-2 px-3.5 py-3.5">
                    <Pulse className="h-4 w-1/2" />
                    <Pulse className="h-3.5 w-3/4" />
                    <Pulse className="h-7 w-2/3" />
                  </div>
                ))}
              </div>
            )}
            <ul className="divide-y divide-border/40">
              {!loading && displayed.map(sale => {
                const key = customerKey(sale);
                const address = deliveryAddress(sale.customerAddress);
                const selected = selectedIds.has(sale.id);
                return (
                  <li key={sale.id} onClick={e => openCustomer(e, key)} className={cn("data-row flex cursor-pointer gap-3 px-3.5 py-3", selected && "bg-primary/5")}>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleSelected(sale.id)}
                      aria-label={`Select order ${sale.invoiceNumber}`}
                      className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded border-border accent-primary"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono text-xs font-bold">{sale.invoiceNumber}</span>
                            {sale.source === "website" && (
                              <span className="flex items-center gap-1 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-extrabold uppercase text-blue-700 dark:bg-blue-950/30 dark:text-blue-400">
                                <Globe size={9} /> Website
                              </span>
                            )}
                            {isPR(sale) && (
                              <span className="rounded-full bg-pink-100 px-1.5 py-0.5 text-[10px] font-extrabold uppercase text-pink-700 dark:bg-pink-950/40 dark:text-pink-300" title="Given free for promotion">PR</span>
                            )}
                            <ExchangeBadge sale={sale} />
                          </p>
                          <p className="mt-1 truncate text-[13px] font-semibold text-foreground">{sale.customerName || "Walk-in Customer"}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <CodAmount sale={sale} />
                          <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                            {new Date(sale.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}, {new Date(sale.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                          </p>
                        </div>
                      </div>
                      {(sale.customer || sale.customerPhone) && (
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                          {sale.customer && <span className="font-mono">{sale.customer.code}</span>}
                          {sale.customerPhone && (
                            <a href={`tel:${sale.customerPhone}`} className="font-semibold text-foreground/80 underline-offset-2 hover:underline">{sale.customerPhone}</a>
                          )}
                        </p>
                      )}
                      {(address || sale.courierAreaTitle) && (
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {[address, sale.courierAreaTitle && `Hub: ${sale.courierAreaTitle}`].filter(Boolean).join(" · ")}
                        </p>
                      )}
                      {byUpayaSend && sale.courierBookedAt && (
                        <p className="mt-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                          Sent with Upaya {new Date(sale.courierBookedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}, {new Date(sale.courierBookedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                        </p>
                      )}
                      {(sale.courierStatus || instantCourierLabel(sale.deliveryVia) || referralLabel(sale.referral)) && (
                        <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {sale.courierStatus && (
                            <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold", courierStatusStyle(sale.courierStatus))}>
                              Upaya: {courierStatusLabel(sale.courierStatus)}
                            </span>
                          )}
                          {instantCourierLabel(sale.deliveryVia) && (
                            <span className="whitespace-nowrap text-[10px] font-bold text-sky-700 dark:text-sky-300">via {instantCourierLabel(sale.deliveryVia)}</span>
                          )}
                          {referralLabel(sale.referral) && (
                            <span className="whitespace-nowrap text-[10px] font-bold text-violet-700 dark:text-violet-300" title={sale.referral ?? ""}>from {referralLabel(sale.referral)}</span>
                          )}
                        </p>
                      )}
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <Dropdown
                            aria-label={`Delivery status of ${sale.invoiceNumber}`}
                            value={sale.deliveryStatus}
                            onChange={status => changeRowStatus(sale, status)}
                            options={DELIVERY_STATUSES}
                            disabled={statusSaving.has(sale.id)}
                            className="w-fit"
                            triggerClassName={cn(
                              "w-auto gap-1 px-2.5 py-1 rounded-full border-transparent text-[10px] font-extrabold uppercase whitespace-nowrap [&>svg]:text-current [&>svg]:opacity-70",
                              DELIVERY_STYLES[sale.deliveryStatus] ?? DELIVERY_STYLES.IN_PROCESS,
                              sentWithUpaya(sale) && SENT_STATUS_BORDER,
                              statusSaving.has(sale.id) && "animate-pulse"
                            )}
                          />
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {(sale.courierTrackingCode || (sale.deliveryStatus === "IN_PROCESS" && !sale.deliveryVia)) && (
                            <button
                              type="button"
                              onClick={() => openCourier(sale)}
                              aria-label={`${sale.courierTrackingCode ? "Track" : "Send to Upaya:"} order ${sale.invoiceNumber}`}
                              className={cn(phoneIconButton, sale.courierTrackingCode && "text-primary border-primary/40")}
                            >
                              <Truck size={15} />
                            </button>
                          )}
                          <button type="button" onClick={() => openLabel(sale)} aria-label={`Print label for order ${sale.invoiceNumber}`} className={phoneIconButton}>
                            <Tag size={15} />
                          </button>
                          <button type="button" onClick={() => setReceiptSales([sale])} aria-label={`Print receipt for order ${sale.invoiceNumber}`} className={phoneIconButton}>
                            <Receipt size={15} />
                          </button>
                          <button type="button" onClick={() => startEdit(sale)} aria-label={`Edit order ${sale.invoiceNumber}`} className={phoneIconButton}>
                            <Edit2 size={15} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
          <table className="hidden w-full text-sm md:table">
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
                    {/* The whole cell ticks the box (a click on the box lands here too), so a Shift-click
                        just beside the small box still selects the range instead of doing nothing. */}
                    <td
                      className="px-5 py-3.5 cursor-pointer"
                      onClick={e => { e.stopPropagation(); toggleSelected(sale.id, e.shiftKey); }}
                      // Shift-click would otherwise select the text between the rows.
                      onMouseDown={e => { if (e.shiftKey) e.preventDefault(); }}
                      title="Shift-click to select a range"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(sale.id)}
                        onChange={() => {}}
                        aria-label={`Select order ${sale.invoiceNumber}`}
                        className="w-4 h-4 rounded border-border cursor-pointer accent-primary"
                      />
                    </td>
                    <td className="px-5 py-3.5 text-xs text-muted-foreground font-medium hidden sm:table-cell">{pager.offset + i + 1}</td>
                    <td className="px-5 py-3.5 text-xs text-muted-foreground font-medium whitespace-nowrap hidden md:table-cell">
                      {new Date(sale.createdAt).toLocaleDateString()}
                      <span className="block text-[11px] font-normal tabular-nums">{new Date(sale.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                      {byUpayaSend && sale.courierBookedAt && (
                        <span className="mt-1 block text-[10px] font-bold text-emerald-700 dark:text-emerald-400" title="When it was sent with Upaya">
                          Sent {new Date(sale.courierBookedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}, {new Date(sale.courierBookedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                        </span>
                      )}
                    </td>
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
                        {isPR(sale) && (
                          <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded-full whitespace-nowrap bg-pink-100 dark:bg-pink-950/40 text-pink-700 dark:text-pink-300" title="Given free for promotion">PR</span>
                        )}
                        <ExchangeBadge sale={sale} className="whitespace-nowrap" />
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5 md:hidden">{new Date(sale.createdAt).toLocaleDateString()} · {new Date(sale.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>
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
                      <CodAmount sale={sale} />
                    </td>
                    <td className="px-5 py-3.5 text-right hidden lg:table-cell whitespace-nowrap">
                      <span className="font-extrabold text-xs">{formatNPR(sale.deliveryAmount ?? 0)}</span>
                    </td>
                    <td className="px-5 py-3.5 hidden sm:table-cell">
                      {/* Click the status pill to change it right here */}
                      <Dropdown
                        aria-label={`Delivery status of ${sale.invoiceNumber}`}
                        value={sale.deliveryStatus}
                        onChange={status => changeRowStatus(sale, status)}
                        options={DELIVERY_STATUSES}
                        disabled={statusSaving.has(sale.id)}
                        className="w-fit"
                        triggerClassName={cn(
                          "w-auto gap-1 px-2 py-0.5 rounded-full border-transparent text-[10px] font-extrabold uppercase whitespace-nowrap hover:border-current/30 [&>svg]:text-current [&>svg]:opacity-70",
                          DELIVERY_STYLES[sale.deliveryStatus] ?? DELIVERY_STYLES.IN_PROCESS,
                          sentWithUpaya(sale) && SENT_STATUS_BORDER,
                          statusSaving.has(sale.id) && "animate-pulse"
                        )}
                      />
                      {referralLabel(sale.referral) && (
                        <p className="mt-1 text-[10px] font-bold text-violet-700 dark:text-violet-300 whitespace-nowrap" title={sale.referral ?? ""}>from {referralLabel(sale.referral)}</p>
                      )}
                      {instantCourierLabel(sale.deliveryVia) && (
                        <p className="mt-1 text-[10px] font-bold text-sky-700 dark:text-sky-300 whitespace-nowrap">via {instantCourierLabel(sale.deliveryVia)}</p>
                      )}
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
                        {(sale.courierTrackingCode || (sale.deliveryStatus === "IN_PROCESS" && !sale.deliveryVia)) && (
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

      {/* Room to scroll the last orders and the page buttons above the floating bulk bar (phones). */}
      {selectedVisible.length > 0 && <div aria-hidden className="h-24 shrink-0 md:hidden" />}

      <Modal
        open={showEdit}
        onClose={() => setShowEdit(false)}
        title="Edit order"
        description={editing?.invoiceNumber}
        size="lg"
        busy={saving}
        dirty={itemsChanged || JSON.stringify(editForm) !== JSON.stringify(initialEdit) || (editing !== null && (hubChanged(editing, editHub) || editService !== serviceOf(editing)))}
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
          {editing && (editing.source === "website" || editing.customerAddress || editing.courierLocationId) && !editing.deliveryVia && (
            <div className="sm:col-span-2">
              <HubEditField
                sale={editing} value={editHub} onChange={setEditHub} service={editService} onServiceChange={setEditService} address={editForm.customerAddress} labelClass="text-xs font-semibold text-muted-foreground"
                onRate={charge => changeDelivery(String(charge))}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <label htmlFor="edit-cod" className="text-xs font-semibold text-muted-foreground">COD amount (Rs.)</label>
            <input id="edit-cod" type="number" inputMode="decimal" min={0} step="0.01" value={editForm.codAmount} onChange={setField("codAmount")} className={fieldClass} />
            {editing && editing.kind !== "pr" && (editing.paymentMethod !== "COD" || editing.paymentStatus === "PAID") && (
              <p className="text-[12px] text-muted-foreground">
                {editing.paymentMethod === "QR" ? "Paid by QR" : editing.paymentMethod === "CASH" ? "Paid at the till" : "Fully paid"}, so 0 to collect. Type an amount if the rider still has to collect something: the order becomes {editing.paymentMethod === "COD" ? "unpaid" : "part paid, cash on delivery"}.
              </p>
            )}
            {editing?.courierTrackingCode && <p className="text-[12px] text-muted-foreground">Upaya keeps the amount it was booked with. Changing it here doesn&apos;t update the rider.</p>}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="edit-delivery" className="text-xs font-semibold text-muted-foreground">Delivery amount (Rs.)</label>
            <input id="edit-delivery" type="number" inputMode="decimal" min={0} step="0.01" value={editForm.deliveryAmount} onChange={e => changeDelivery(e.target.value)} className={fieldClass} />
          </div>
          {editing && (
            <div className="space-y-2 sm:col-span-2">
              <div className="flex items-baseline justify-between gap-2 border-t border-border/60 pt-4">
                <span className="text-xs font-semibold text-muted-foreground">Items</span>
                {itemsChanged && (
                  <span className="text-[11px] text-muted-foreground">Saving takes added units out of stock and asks about removed ones.</span>
                )}
              </div>
              {editing.deliveryStatus === "CANCELLED" || editing.deliveryStatus === "RETURNED" ? (
                <p className="rounded-xl bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
                  This order is {editing.deliveryStatus === "CANCELLED" ? "cancelled" : "returned"}, so its items can&apos;t be changed.
                </p>
              ) : (
                <OrderItemsEditor
                  sale={editing}
                  lines={editLines}
                  onLinesChange={lines => changeItems(lines, editDiscount)}
                  discount={editDiscount}
                  onDiscountChange={d => changeItems(editLines, d)}
                />
              )}
              {itemsChanged && editing.courierTrackingCode && (
                <p className="text-[12px] text-amber-700 dark:text-amber-400">This order is already booked with Upaya, which keeps the amount it was booked with.</p>
              )}
            </div>
          )}
        </div>
      </Modal>
      {editing && (
        <ItemChangeConfirm
          open={confirmingItems}
          invoiceNumber={editing.invoiceNumber}
          changes={itemChanges}
          onClose={() => setConfirmingItems(false)}
          onConfirm={commitEdit}
        />
      )}

      {courierSale && (
        <CourierDialog key={courierSale.id} open={showCourier} onClose={() => setShowCourier(false)} sale={courierSale} onChanged={() => refetch({ quiet: true })} />
      )}

      <UpayaBatchDialog batch={upayaBatch} onClose={() => setUpayaBatch(null)} onSend={sendBatchToUpaya} />

      {receiptSales.length > 0 && (
        <ReceiptDialog open onClose={() => setReceiptSales([])} sales={receiptSales} store={store} />
      )}
      <RecentlyDeletedDialog open={trashOpen} onClose={() => setTrashOpen(false)} onRestored={() => refetch({ quiet: true })} />
      {packingOpen && selectedVisible.length > 0 && (
        <PackingListDialog open={packingOpen} onClose={() => setPackingOpen(false)} orders={selectedVisible} />
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
        title={`Delete ${toDelete.length} order${toDelete.length === 1 ? "" : "s"}?`}
        description="You can restore them from Recently deleted for 30 days. These are the orders that will be deleted:"
        confirmLabel={`Delete ${toDelete.length}`}
        size="lg"
      >
        <ul className="mt-3 max-h-[50vh] overflow-y-auto divide-y divide-border rounded-lg border border-border text-sm">
          {toDelete.map(sale => (
            <li key={sale.id} className="flex items-start justify-between gap-4 px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono text-muted-foreground">{sale.invoiceNumber}</span>
                  <span className="font-semibold text-foreground">{sale.customerName ?? "Walk-in"}</span>
                </p>
                <p className="mt-0.5 text-muted-foreground">
                  {sale.customerPhone ? `${sale.customerPhone} · ` : ""}
                  {sale.items.reduce((n, i) => n + i.quantity, 0)} item(s) · {new Date(sale.createdAt).toLocaleDateString()}
                </p>
                {sale.courierTrackingCode && sale.courierStatus !== "cancelled" && (
                  <p className="mt-0.5 font-semibold text-amber-700 dark:text-amber-400">
                    Already with Upaya ({sale.courierTrackingCode}): deleting here doesn&apos;t cancel the pickup.
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="font-bold text-foreground">{formatNPR(sale.totalAmount)}</span>
                <span className={cn("text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded-full whitespace-nowrap", DELIVERY_STYLES[sale.deliveryStatus] ?? DELIVERY_STYLES.IN_PROCESS)}>
                  {DELIVERY_STATUSES.find(d => d.value === sale.deliveryStatus)?.label ?? "In Process"}
                </span>
              </div>
            </li>
          ))}
        </ul>
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
