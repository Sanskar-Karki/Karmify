"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ShoppingCart, Search, Plus, Minus, X, CheckCircle, User, Phone, MapPin,
  Receipt, Package, QrCode, Truck, Printer, Tag, Store, Banknote, Gift, Zap, UserCheck, Users, CalendarClock,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { bookSaleWithUpaya, createFutureOrder, createSale, estimateCourierRate, getCourierStatus, updateNote } from "@/app/actions";
import { NoteReference } from "@/components/notes/NoteReference";
import { UpayaHubPicker } from "@/components/shared/UpayaHubPicker";
import { BATCH_COURIER_SERVICES, courierMobile, DOOR_TO_DOOR, type CourierArea } from "@/lib/courier";
import { cn, formatNPR } from "@/lib/utils";
import { ProductCardPlaceholder, TransactionRowPlaceholder } from "@/components/skeletons/placeholders";
import { EmptyState } from "@/components/shared/EmptyState";
import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/shared/Button";
import { CustomerLabelDialog } from "@/components/shared/CustomerLabelDialog";
import { ReceiptDialog } from "@/components/shared/ReceiptDialog";
import { ShowMoreButton, useShowMore } from "@/components/shared/ShowMore";
import { useResources } from "@/lib/useResources";
import { resources } from "@/lib/resources";
import { fetchResource } from "@/lib/resourceCache";
import { mutate } from "@/lib/mutate";
import { countsAsSale, deliveryAddress, findCustomerMatches, itemOptions, itemOptionsText, PAYMENT_STYLES, type CustomerMatch } from "@/lib/orders";
import { nameProblem, normalizePhone, parseCustomerCode, phoneProblem } from "@/lib/customerIdentity";
import { useStoreProfile } from "@/lib/storeProfile";
import { shopOfProducts, useShop } from "@/lib/shop";
import { Swatch, VariantPicker } from "@/components/shared/VariantStock";

/** "size", "colour" or "colour and size": what a product makes you choose. */
const pickAxes = (p: { variants: { size: string; color: string }[] }) => {
  const sizes = p.variants.some(v => v.size.trim());
  const colours = p.variants.some(v => v.color.trim());
  return sizes && colours ? "colour and size" : colours ? "colour" : "size";
};
import type { ActionResult, Product, Sale } from "@/lib/types";

interface CartItem {
  productId: string;
  name: string;
  sku: string;
  /** The price charged; staff can lower it below listPrice, which shows as a discount. */
  unitPrice: number;
  /** The product's normal selling price. */
  listPrice: number;
  quantity: number;
  /** For products with sizes: the size/colour row sold, and its label ("M · Navy"). */
  variantId?: string | null;
  variantLabel?: string;
}

/** One cart line per product, or per size/colour of a sized product. */
const lineKey = (c: { productId: string; variantId?: string | null }) => `${c.productId}:${c.variantId ?? ""}`;

type CompletedSale = Awaited<ReturnType<typeof createSale>> extends ActionResult<infer T> ? T : never;

const CUSTOMER_FIELDS = [
  { label: "Customer Name", icon: User, key: "name", placeholder: "Customer name", type: "text" },
  { label: "Phone", icon: Phone, key: "phone", placeholder: "Phone number", type: "tel" },
  { label: "Address", icon: MapPin, key: "address", placeholder: "Delivery address", type: "text" },
] as const;

const BLANK_CUSTOMER = { name: "", address: "", phone: "" };

/**
 * Walk-in: sold over the counter and paid now. Delivery: sent to the customer,
 * usually cash on delivery. PR: given free to someone for promotion, so stock
 * goes out but nothing is charged or counted as a sale.
 */
type SaleMode = "walkin" | "delivery" | "pr";
/** Walk-in: handed over at the studio, or paid now and sent with Yango. */
type WalkInVia = "studio" | "yango";

// The sale in progress survives a reload or a closed tab on this device.
const DRAFT_KEY = "karmify-pos-draft";
type Draft = {
  cart: CartItem[];
  customer: typeof BLANK_CUSTOMER;
  mode: SaleMode;
  courierService?: number;
  walkInVia?: WalkInVia;
  deliveryAmount: number;
  /** Delivery: the Upaya hub location chosen. */
  hub?: CourierArea | null;
  /** The existing customer this order is linked to. */
  linkedId?: string | null;
  /** Saved as a future order (sent later, once restocked) instead of completed now. */
  future?: boolean;
  /** The note this order is being entered from (Notes → Enter as order). */
  noteId?: string | null;
};

/** Reloads the Notes list in the background, so it shows a note ticked off from here. */
const refreshNotes = () => fetchResource(resources.notes.key, resources.notes.fetcher, { force: true }).catch(() => {});

/** Ticks off the note an order was entered from, once the order is saved. */
async function tickOffNote(id: string) {
  const done = await updateNote(id, { done: true }).catch(() => null);
  if (!done?.ok) return; // deleted meanwhile: nothing left to tick
  void refreshNotes();
  toast.success("The note is ticked off.", {
    id: `note-done-${id}`,
    description: "It's under Notes → Done.",
    action: { label: "Undo", onClick: () => void updateNote(id, { done: false }).then(refreshNotes, () => {}) },
  });
}

const smallField = "w-full pl-8 pr-3 py-2.5 text-xs rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20";

export default function SalesPage() {
  const { products, categories, stocks, sales, loading, refetch } = useResources({
    products: resources.activeProducts,
    categories: resources.categories,
    stocks: resources.stocks,
    sales: resources.sales,
  });
  const store = useStoreProfile();
  const shop = useShop();

  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");

  const [rawCart, setCart] = useState<CartItem[]>([]);
  const [customer, setCustomer] = useState(BLANK_CUSTOMER);
  // The note this order is being entered from, shown above the details.
  const [noteId, setNoteId] = useState<string | null>(null);
  // An existing customer staff confirmed this is, and the ones they said it isn't.
  const [linkedId, setLinkedId] = useState<string | null>(null);
  const [notSame, setNotSame] = useState<string[]>([]);
  const [deliveryAmount, setDeliveryAmount] = useState(0);
  // null means "follow the computed total"; a string is a manual override.
  const [codOverride, setCodOverride] = useState<string | null>(null);
  // A final total staff typed in, kept with the full total it was typed against so
  // it lapses by itself when the cart or the delivery charge changes.
  const [totalOverride, setTotalOverride] = useState<{ value: string; base: number } | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "QR">("CASH");
  // Delivery orders: nothing paid yet, an advance paid, or paid in full.
  const [deliveryPay, setDeliveryPay] = useState<"cod" | "partial" | "paid">("cod");
  const [advance, setAdvance] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState<SaleMode>("delivery");
  // A future order: taken now, sent in a few days once restocked. Any size/colour can be
  // added, sold out or not, and saving it takes no stock and isn't counted as a sale.
  const [future, setFuture] = useState(false);
  const [walkInVia, setWalkInVia] = useState<WalkInVia>("studio");
  const [cashReceived, setCashReceived] = useState("");
  const [receiptExtras, setReceiptExtras] = useState<{
    walkIn: boolean;
    cashReceived: number | null;
    deliveryPay: "cod" | "partial" | "paid" | null;
    advance: number;
  }>({ walkIn: false, cashReceived: null, deliveryPay: null, advance: 0 });
  const searchRef = useRef<HTMLInputElement>(null);
  // The sized product whose size/colour is being picked.
  const [picking, setPicking] = useState<Product | null>(null);
  // Upaya courier: whether this store books with Upaya, the hub location for
  // this delivery, whether to book on "Complete Sale", and how the last booking went.
  const [upayaEnabled, setUpayaEnabled] = useState(false);
  const [hub, setHub] = useState<CourierArea | null>(null);
  // Off until staff tick it: a booking sends a real Upaya pickup.
  const [bookUpaya, setBookUpaya] = useState(false);
  const [courierBooking, setCourierBooking] = useState<{ state: "booking" | "booked" | "failed"; text: string } | null>(null);
  // Upaya's delivery charge for the chosen hub, filled into the Delivery field.
  const [hubRate, setHubRate] = useState<{ state: "loading" | "set" | "none"; charge?: number } | null>(null);
  // Upaya service: the rider brings it to the door (default), or the customer collects it from Upaya's branch.
  const [courierService, setCourierService] = useState<number>(DOOR_TO_DOOR);
  const serviceLabel = BATCH_COURIER_SERVICES.find(sv => sv.id === courierService)?.label.toLowerCase() ?? "door to door";
  const rateRequest = useRef(0);

  /** Chooses the hub and fills in Upaya's delivery charge for it (1 kg, with the chosen service, as booked). */
  async function chooseHub(area: CourierArea | null, service = courierService) {
    setHub(area);
    const id = ++rateRequest.current;
    if (!area) return setHubRate(null);
    setHubRate({ state: "loading" });
    const result = await estimateCourierRate(area.locationId, 1, service).catch(() => null);
    if (id !== rateRequest.current) return; // a newer hub was chosen meanwhile
    if (result?.ok && typeof result.data === "number" && result.data > 0) {
      setDeliveryAmount(result.data);
      setHubRate({ state: "set", charge: result.data });
    } else {
      setHubRate({ state: "none" });
    }
  }
  useEffect(() => {
    getCourierStatus().then(result => { if (result.ok) setUpayaEnabled(result.data.enabled); }).catch(() => {});
  }, []);

  // Restore the unfinished sale once, then keep saving it as it changes.
  const draftLoaded = useRef(false);
  useEffect(() => {
    // Read after the first paint, so the server-rendered page and the first client render match.
    const frame = requestAnimationFrame(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw) as Partial<Draft>;
        if (Array.isArray(d.cart)) setCart(d.cart.map(c => ({ ...c, listPrice: c.listPrice ?? c.unitPrice })));
        if (d.customer) setCustomer({ ...BLANK_CUSTOMER, ...d.customer });
        if (d.mode === "walkin" || d.mode === "delivery" || d.mode === "pr") setMode(d.mode);
        if (d.walkInVia === "studio" || d.walkInVia === "yango") setWalkInVia(d.walkInVia);
        if (typeof d.deliveryAmount === "number") setDeliveryAmount(d.deliveryAmount);
        if (d.hub && Number.isInteger(d.hub.areaId)) setHub(d.hub);
        if (BATCH_COURIER_SERVICES.some(sv => sv.id === d.courierService)) setCourierService(d.courierService as number);
        if (typeof d.linkedId === "string") setLinkedId(d.linkedId);
        if (d.future === true) setFuture(true);
        if (typeof d.noteId === "string") setNoteId(d.noteId);
      }
    } catch {
      // A broken or blocked draft just means starting fresh.
    }
    // Notes → Enter as order: the link names the note (over one kept in the draft).
    // It's then dropped from the address, so a reload doesn't bring back a finished note.
    const fromNote = new URLSearchParams(window.location.search).get("note");
    if (fromNote) {
      setNoteId(fromNote);
      window.history.replaceState(null, "", window.location.pathname);
    }
    draftLoaded.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    if (!draftLoaded.current) return;
    try {
      const draft: Draft = { cart: rawCart, customer, mode, walkInVia, deliveryAmount, hub, courierService, linkedId, future, noteId };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Storage full or blocked: the sale still works, it just won't survive a reload.
    }
  }, [rawCart, customer, mode, walkInVia, deliveryAmount, hub, courierService, linkedId, future, noteId]);

  // "/" jumps to the search/scan box from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const [showReceipt, setShowReceipt] = useState(false);
  const [lastSale, setLastSale] = useState<CompletedSale | null>(null);
  const [showLabel, setShowLabel] = useState(false);
  const [printReceipt, setPrintReceipt] = useState(false);

  // On phones the cart sits below the catalog; a shortcut bar shows until it's in view.
  const cartRef = useRef<HTMLDivElement>(null);
  const [cartInView, setCartInView] = useState(false);
  useEffect(() => {
    if (!cartRef.current) return;
    const observer = new IntersectionObserver(([entry]) => setCartInView(entry.isIntersecting), { rootMargin: "0px 0px -35% 0px" });
    observer.observe(cartRef.current);
    return () => observer.disconnect();
  }, []);

  const stockByProduct = useMemo(() => {
    const totals = new Map<string, number>();
    for (const s of stocks) totals.set(s.productId, (totals.get(s.productId) ?? 0) + s.quantity);
    return totals;
  }, [stocks]);

  const getStock = (productId: string) => stockByProduct.get(productId) ?? 0;

  // A restored cart may name products that were since deleted or deactivated; leave those out.
  const cart = useMemo(() => {
    if (loading) return rawCart;
    const ids = new Set(products.map(p => p.id));
    return rawCart.every(c => ids.has(c.productId)) ? rawCart : rawCart.filter(c => ids.has(c.productId));
  }, [loading, products, rawCart]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(p => {
      const matchCat = catFilter === "all" || p.categoryId === catFilter;
      const matchSearch = !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.barcode?.toLowerCase().includes(q);
      return matchCat && matchSearch;
    });
  }, [products, search, catFilter]);

  const { visible: displayedProducts, remaining, step, showMore } = useShowMore(filteredProducts, 60);

  function notifyLimit(name: string, available: number) {
    toast.info(`Only ${available} of "${name}" in stock.`, { id: "cart-stock-limit" });
  }

  /** What's left for a cart line: that size's own stock for sized products. */
  function lineStock(item: { productId: string; variantId?: string | null }) {
    if (!item.variantId) return getStock(item.productId);
    return products.find(p => p.id === item.productId)?.variants.find(v => v.id === item.variantId)?.quantity ?? 0;
  }

  /** Products with sizes ask which one; others go straight in. */
  function addToCart(p: Product, variant?: Product["variants"][number]) {
    if (!variant && p.variants.length > 0) {
      setPicking(p);
      return;
    }
    const line = { productId: p.id, variantId: variant?.id ?? null };
    const available = lineStock(line);
    const label = variant ? [variant.size, variant.color].filter(Boolean).join(" · ") : undefined;
    const fullName = label ? `${p.name} (${label})` : p.name;
    // A future order is sent after restocking, so what's in stock today doesn't limit it.
    if (!future && available <= 0) {
      if (variant) toast.info(`"${fullName}" is sold out.`, { id: "cart-stock-limit" });
      return;
    }
    if (!future && (cart.find(c => lineKey(c) === lineKey(line))?.quantity ?? 0) >= available) {
      notifyLimit(fullName, available);
      return;
    }
    setCart(prev => {
      const existing = prev.find(c => lineKey(c) === lineKey(line));
      if (existing) return prev.map(c => (lineKey(c) === lineKey(line) ? { ...c, quantity: c.quantity + 1 } : c));
      return [...prev, { ...line, name: p.name, sku: p.sku, unitPrice: p.sellingPrice, listPrice: p.sellingPrice, quantity: 1, variantLabel: label }];
    });
    setPicking(null);
  }

  // Barcode scanners type the code and press Enter.
  function onSearchKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Enter") return;
    const q = search.trim().toLowerCase();
    if (!q) return;

    const customerCode = parseCustomerCode(q);
    if (customerCode) {
      const previous = sales.find(s => s.customer?.code === customerCode);
      if (previous) fillCustomerFrom(previous);
      else toast.error(`No customer found with ID ${customerCode}.`);
      setSearch("");
      return;
    }

    const exact = products.find(p => p.barcode?.toLowerCase() === q || p.sku.toLowerCase() === q);
    const target = exact ?? (filteredProducts.length === 1 ? filteredProducts[0] : undefined);
    if (target) {
      addToCart(target);
      setSearch("");
    }
  }

  function updateQty(item: CartItem, delta: number) {
    const available = lineStock(item);
    if (!future && delta > 0 && item.quantity >= available) {
      notifyLimit(item.name, available);
      return;
    }
    setCart(prev => prev.map(c => (lineKey(c) === lineKey(item) ? { ...c, quantity: Math.max(1, c.quantity + delta) } : c)));
  }

  /** A typed line price, between 0 and the product's normal price. */
  function setPrice(item: CartItem, value: number) {
    if (!Number.isFinite(value)) return;
    const price = Math.max(0, Math.min(value, item.listPrice));
    setCart(prev => prev.map(c => (lineKey(c) === lineKey(item) ? { ...c, unitPrice: price } : c)));
  }

  /** A typed quantity, kept between 1 and what's in stock. */
  function setQty(item: CartItem, value: number) {
    if (!Number.isFinite(value)) return;
    const available = lineStock(item);
    const qty = future ? Math.max(1, Math.floor(value)) : Math.max(1, Math.min(Math.floor(value), Math.max(1, available)));
    if (!future && value > available) notifyLimit(item.name, available);
    setCart(prev => prev.map(c => (lineKey(c) === lineKey(item) ? { ...c, quantity: qty } : c)));
  }

  function removeFromCart(item: CartItem) {
    setCart(prev => prev.filter(c => lineKey(c) !== lineKey(item)));
  }

  function fillCustomerFrom(previous: Sale) {
    const name = previous.customerName ?? "";
    const phone = previous.customerPhone ?? "";
    const address = deliveryAddress(previous.customerAddress);
    setCustomer(c => ({ name, phone: c.phone || phone, address: c.address || address }));
    if (previous.customerId) setLinkedId(previous.customerId);
    toast.info(`Returning customer: ${name}`, { id: "returning-customer", description: previous.customer?.code });
  }

  // Repeat customers are recognised by phone, so staff don't retype their details.
  function fillReturningCustomer() {
    const phone = normalizePhone(customer.phone);
    if (!phone || customer.name.trim()) return;
    const previous = sales.find(s => s.customerName && normalizePhone(s.customerPhone) === phone);
    if (previous) fillCustomerFrom(previous);
  }

  // Someone with this name or phone already in Karmify. One phone match is them;
  // a name match (or several) is asked about, so their orders build one history.
  const matches = useMemo(
    () => findCustomerMatches(sales, { name: customer.name, phone: customer.phone }),
    [sales, customer.name, customer.phone]
  );
  const openMatches = matches.filter(m => !notSame.includes(m.customerId));
  const phoneMatches = openMatches.filter(m => m.by === "phone");
  const linkedCustomer =
    matches.find(m => m.customerId === linkedId) ??
    (phoneMatches.length === 1 ? phoneMatches[0] : null);
  const askAbout = linkedCustomer ? [] : openMatches;

  function linkCustomer(match: CustomerMatch) {
    setLinkedId(match.customerId);
    // Fill only what's still empty: a new phone or address is kept.
    setCustomer(c => ({
      name: c.name.trim() ? c.name : match.name,
      phone: c.phone.trim() ? c.phone : match.phone ?? "",
      address: c.address.trim() ? c.address : match.address ?? "",
    }));
  }
  function notThisCustomer(ids: string[]) {
    setNotSame(prev => [...new Set([...prev, ...ids])]);
    setLinkedId(null);
  }

  const walkIn = mode === "walkin";
  const pr = mode === "pr";
  // PR orders may be handed over (no address) or sent like a delivery.
  const sending = mode === "delivery" || (pr && customer.address.trim() !== "");
  // A walk-in sent with Yango: paid in full now, so nothing to charge for delivery or collect.
  const instant = walkIn && walkInVia === "yango" ? "yango" : null;
  const instantLabel = instant ? "Yango" : null;
  const subtotal = cart.reduce((a, c) => a + c.listPrice * c.quantity, 0);
  const discountAmount = cart.reduce((a, c) => a + Math.max(0, c.listPrice - c.unitPrice) * c.quantity, 0);
  const total = subtotal - discountAmount;
  const delivery = walkIn || pr ? 0 : deliveryAmount;
  const fullTotal = total + delivery;
  // Staff can type a lower final total; the gap is recorded as discount. It can't go
  // above the full price (that would be a negative discount) or below the delivery charge.
  const totalEdit = !pr && totalOverride && totalOverride.base === fullTotal ? totalOverride : null;
  const typedTotal = totalEdit ? parseFloat(totalEdit.value) : NaN;
  const grandTotal = Number.isFinite(typedTotal) ? Math.min(fullTotal, Math.max(delivery, typedTotal)) : fullTotal;
  const totalCut = fullTotal - grandTotal;
  // QR orders are paid up front, so the rider collects nothing.
  // Walk-in picks Cash or QR; a paid-in-full delivery is recorded like a QR prepayment (nothing to collect).
  const method: "COD" | "QR" | "CASH" = walkIn ? paymentMethod : deliveryPay === "paid" ? "QR" : "COD";
  const advancePaid = !pr && deliveryPay === "partial" ? Math.max(0, parseFloat(advance) || 0) : 0;
  const codAmount = walkIn || pr || method === "QR"
    ? "0"
    : deliveryPay === "partial"
      ? Math.max(0, grandTotal - advancePaid).toFixed(2)
      : codOverride ?? grandTotal.toFixed(2);
  // Walk-in: what the customer actually handed over (cash or QR). Less than the
  // total means the rest was let go, so it's recorded as a discount.
  const cashGiven = parseFloat(cashReceived);
  const received = walkIn && Number.isFinite(cashGiven) && cashGiven >= 0 ? cashGiven : null;
  const shortDiscount = received !== null && received < grandTotal ? grandTotal - received : 0;
  const amountDue = pr ? 0 : grandTotal - shortDiscount;
  const change = received !== null && received > grandTotal ? received - grandTotal : null;
  const cartUnits = cart.reduce((a, c) => a + c.quantity, 0);

  const fieldErrors: Partial<Record<"name" | "phone", string>> = {
    ...(customer.name.trim() && nameProblem(customer.name) ? { name: nameProblem(customer.name)! } : {}),
    ...(customer.phone.trim() && phoneProblem(customer.phone) ? { phone: phoneProblem(customer.phone)! } : {}),
  };

  // Today's takings for the header (Nepal date).
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kathmandu" }).format(new Date());
  const todaySales = sales.filter(s => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kathmandu" }).format(new Date(s.createdAt)) === today);
  const todayTotal = todaySales.filter(countsAsSale).reduce((sum, s) => sum + s.totalAmount + s.deliveryAmount, 0);

  /** Clears the order just completed or saved, ready for the next one. */
  function resetOrder() {
    setDeliveryPay("cod");
    setAdvance("");
    setCashReceived("");
    setCart([]);
    setCustomer(BLANK_CUSTOMER);
    setLinkedId(null);
    setNotSame([]);
    setDeliveryAmount(0);
    setCodOverride(null);
    setTotalOverride(null);
    setPaymentMethod("CASH");
    setHub(null);
    setHubRate(null);
    setCourierService(DOOR_TO_DOOR);
  }

  /** The order is saved: tick off the note it was entered from, and put the note away. */
  function finishNote() {
    if (!noteId) return;
    setNoteId(null);
    void tickOffNote(noteId);
  }

  async function handleCheckout() {
    if (cart.length === 0) return;
    if (fieldErrors.name) return void toast.error(fieldErrors.name);
    if (fieldErrors.phone) return void toast.error(fieldErrors.phone);
    const cod = parseFloat(codAmount) || 0;
    // A future order is looked up by whose it is when it's sent.
    if (future && !customer.name.trim()) return void toast.error("Enter who the future order is for.");
    if (pr) {
      if (!customer.name.trim()) return void toast.error("Enter who the PR order is for.");
    } else if (walkIn) {
      if (received === 0) return void toast.error("Amount received can't be 0.");
    } else {
      if (!customer.name.trim()) return void toast.error("Customer name is required.");
      if (!customer.phone.trim()) return void toast.error("Phone number is required.");
      if (!customer.address.trim()) return void toast.error("Delivery address is required.");
      if (deliveryPay === "partial" && (advancePaid <= 0 || advancePaid >= grandTotal)) {
        return void toast.error("Enter the advance paid: more than 0 and less than the total.");
      }
      if (deliveryPay === "cod" && cod <= 0) return void toast.error("COD amount is required.");
    }
    // Delivery booked with Upaya on completion: it needs a hub location and a mobile number.
    // A future order isn't booked now: it's sent with Upaya once it's moved to the orders.
    const booking = !future && sending && upayaEnabled && bookUpaya;
    if (booking) {
      if (!hub) return void toast.error("Choose the Upaya hub location for this delivery.");
      if (!courierMobile(customer.phone)) return void toast.error("Upaya needs a 10-digit mobile number (98…) to book this delivery.");
    }

    const payload = {
      customerName: customer.name.trim() || undefined,
      customerPhone: customer.phone.trim() || undefined,
      customerAddress: walkIn && !instant ? undefined : customer.address.trim() || undefined,
      items: cart.map(c => ({ productId: c.productId, quantity: c.quantity, unitPrice: c.listPrice, variantId: c.variantId ?? null })),
      discount: discountAmount + totalCut + shortDiscount,
      deliveryAmount: delivery,
      codAmount: walkIn || pr ? 0 : cod,
      totalAmount: total - totalCut - shortDiscount,
      paymentMethod: method,
      walkIn,
      partial: !walkIn && !pr && deliveryPay === "partial",
      courierArea: sending && hub ? { areaId: hub.areaId, locationId: hub.locationId, title: hub.title } : null,
      courierServiceId: sending ? courierService : null,
      pr,
      deliveryVia: instant,
      customerId: linkedCustomer?.customerId ?? null,
      // The shop being sold from; under "All shops", the cart's products' shop.
      brand: shop !== "all" ? shop : shopOfProducts(products.filter(p => cart.some(c => c.productId === p.id))),
    };

    setSubmitting(true);
    setCourierBooking(null);

    if (future) {
      const saved = await mutate(() => createFutureOrder({ sale: payload, mode, advance: advancePaid }), {
        success: r => `Future order saved for ${r.customerName}. It's waiting in Customers & Orders → Future orders.`,
      });
      setSubmitting(false);
      if (!saved.ok) return;
      resetOrder();
      setFuture(false);
      finishNote();
      return;
    }

    const result = await mutate(() => createSale(payload), {
      success: sale => {
        const who = sale.customerName?.trim();
        if (sale.kind === "pr") return `PR order ${sale.invoiceNumber} recorded for ${who}.`;
        if (walkIn) return `Sale ${sale.invoiceNumber} completed${who ? ` for ${who}` : ""} · ${formatNPR(sale.totalAmount)}.`;
        return `Order ${sale.invoiceNumber} added for ${who} · ${sale.paymentMethod === "COD" ? `COD ${formatNPR(sale.codAmount)}` : "paid"}.`;
      },
    });
    setSubmitting(false);

    if (!result.ok) {
      // Stock may have changed under this cart, so the cards should reflect it.
      // Quiet, because the failure has already been reported once.
      await refetch({ quiet: true });
      return;
    }

    setLastSale(result.data);
    setReceiptExtras({
      walkIn,
      cashReceived: received,
      deliveryPay: walkIn || pr ? null : deliveryPay,
      advance: advancePaid,
    });
    setShowReceipt(true);
    const bookedService = courierService;
    resetOrder();
    finishNote();

    // The sale is saved; now book it with Upaya. A failure leaves the sale as it
    // is, and it can be booked later from the customer's order.
    if (booking) {
      setCourierBooking({ state: "booking", text: "Booking with Upaya…" });
      const booked = await bookSaleWithUpaya(result.data.id, bookedService).catch(() => null);
      if (booked?.ok) {
        const text = `Booked · tracking ${booked.data.trackingCode}`;
        setCourierBooking({ state: "booked", text });
        toast.success(`${result.data.invoiceNumber} booked with Upaya (tracking ${booked.data.trackingCode}).`);
      } else {
        const reason = booked && !booked.ok ? booked.message : "Could not reach the server.";
        setCourierBooking({ state: "failed", text: `Not booked: ${reason}` });
        toast.error(`Sale saved, but Upaya didn't take it: ${reason} Book it from Customers → this order.`, { duration: 10000 });
      }
    }
    await refetch();
  }

  return (
<>
      <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">POS &amp; Sales Terminal</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Tap or scan products, fill in the customer, then take payment.</p>
        </div>
        {!loading && (
          <div className="flex gap-2">
            <div className="rounded-xl border border-border/80 bg-card px-4 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Sales today</p>
              <p className="text-lg font-extrabold leading-tight">{todaySales.filter(s => s.kind !== "pr").length}</p>
            </div>
            <div className="rounded-xl border border-border/80 bg-card px-4 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Taken today</p>
              <p className="text-lg font-extrabold leading-tight">{formatNPR(todayTotal)}</p>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[19rem_minmax(0,1fr)_20rem] xl:grid-cols-[22rem_minmax(0,1fr)_23rem] gap-4 items-start">
        {/* LEFT: Customer & payment. Phones stack the three columns in the same
            order as a computer: details, then products, then the cart. */}
        <div className="lg:sticky lg:top-0 min-w-0">
          {noteId && (
            <NoteReference
              noteId={noteId}
              customer={customer}
              onFill={(field, value) => setCustomer(c => ({ ...c, [field]: value }))}
              onClose={() => setNoteId(null)}
            />
          )}
          <div className="bg-card border border-border/80 rounded-2xl shadow-sm p-4 space-y-2.5">
              {/* Sale type */}
              <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-muted" role="radiogroup" aria-label="Sale type">
                {([
                  { value: "walkin", label: "Walk-in", icon: Store, title: "Sold over the counter, paid now" },
                  { value: "delivery", label: "Delivery", icon: Truck, title: "Sent to the customer" },
                  { value: "pr", label: "PR", icon: Gift, title: "Given free for promotion: stock goes out, no money in" },
                ] as const).map(option => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={mode === option.value}
                    onClick={() => setMode(option.value)}
                    title={option.title}
                    className={cn("flex items-center justify-center gap-1.5 px-2 py-2 text-xs font-semibold rounded-lg transition-all", mode === option.value ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
                  >
                    <option.icon size={12} /> {option.label}
                  </button>
                ))}
              </div>

              {/* Walk-in: picked up at the studio, or sent with Yango (paid up front, so no delivery charge or COD) */}
              {walkIn && (
                <div className="space-y-1.5">
                  <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-muted" role="radiogroup" aria-label="How the walk-in order leaves">
                    {([
                      { value: "studio", label: "Studio", icon: Store, title: "Handed over at the studio" },
                      { value: "yango", label: "Yango", icon: Zap, title: "Paid now and sent with Yango" },
                    ] as const).map(option => (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={walkInVia === option.value}
                        onClick={() => setWalkInVia(option.value)}
                        title={option.title}
                        className={cn("flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-semibold rounded-lg transition-all", walkInVia === option.value ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
                      >
                        <option.icon size={12} /> {option.label}
                      </button>
                    ))}
                  </div>
                  {instant && (
                    <p className="text-[11px] text-muted-foreground">Paid in full now. Book the Yango ride yourself; no delivery charge or COD is added.</p>
                  )}
                </div>
              )}

              {pr && (
                <p className="flex items-start gap-2 rounded-xl border border-pink-200 bg-pink-50 px-3 py-2 text-[12px] text-pink-800 dark:border-pink-900/50 dark:bg-pink-950/30 dark:text-pink-200">
                  <Gift size={14} className="mt-0.5 shrink-0" />
                  <span>Given free for promotion. Stock goes out, nothing is charged, and it isn&apos;t counted as a sale. Leave the address empty if it&apos;s handed over.</span>
                </p>
              )}

              {/* Future order: taken now, sent once the items are restocked */}
              <label
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 transition-colors",
                  future ? "border-amber-300 bg-amber-50 dark:border-amber-800/60 dark:bg-amber-950/30" : "border-border bg-muted/40 hover:border-primary/30"
                )}
              >
                <input
                  type="checkbox"
                  checked={future}
                  onChange={e => {
                    const on = e.target.checked;
                    setFuture(on);
                    // Back to a normal sale: lines added beyond today's stock can't be completed now.
                    const over = on ? [] : cart.filter(c => c.quantity > lineStock(c));
                    if (over.length) {
                      toast.warning(
                        `More than is in stock: ${over.slice(0, 3).map(c => `${c.name} (${Math.max(0, lineStock(c))} left)`).join(", ")}${over.length > 3 ? "…" : ""}. Lower the quantity or keep it a future order.`,
                        { id: "future-off-stock", duration: 8000 },
                      );
                    }
                  }}
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-primary"
                />
                <span className="min-w-0 text-[12px]">
                  <span className={cn("flex items-center gap-1.5 font-semibold", future ? "text-amber-900 dark:text-amber-100" : "text-foreground")}>
                    <CalendarClock size={13} /> Future order · send later
                  </span>
                  <span className={cn("block text-[11px]", future ? "text-amber-800 dark:text-amber-200" : "text-muted-foreground")}>
                    {future
                      ? "Any size or colour can be added, even sold out. Saving takes no stock and isn't counted as a sale until you move it to the orders."
                      : "For items you'll restock and send in a few days."}
                  </span>
                </span>
              </label>

              <p className="pt-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                {pr ? "Given to" : "Customer"}{walkIn && <span className="font-medium normal-case tracking-normal"> · optional</span>}
              </p>
              <div className="grid grid-cols-1 gap-2.5">
                {CUSTOMER_FIELDS.filter(field => !(walkIn && !instant && field.key === "address")).map(field => {
                  // Delivery needs everything; PR needs only the name; walk-in needs nothing.
                  const required = mode === "delivery" || (pr && field.key === "name");
                  const placeholder = pr && field.key === "name" ? "Name (e.g. the influencer)" : field.placeholder;
                  return (
                  <div key={field.key}>
                  <div className="relative">
                    <field.icon size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      required={required}
                      type={field.type}
                      value={customer[field.key]}
                      onChange={e => setCustomer(c => ({ ...c, [field.key]: e.target.value }))}
                      placeholder={required ? `${placeholder} *` : `${placeholder} (optional)`}
                      aria-label={field.label}
                      onBlur={field.key === "phone" ? fillReturningCustomer : undefined}
                      inputMode={field.key === "phone" ? "tel" : undefined}
                      aria-invalid={field.key !== "address" && Boolean(fieldErrors[field.key]) || undefined}
                      className={cn(smallField, "py-2", field.key !== "address" && fieldErrors[field.key] && "border-red-400 focus:ring-red-200")}
                    />
                  </div>
                  {field.key !== "address" && fieldErrors[field.key] && (
                    <p className="mt-1 text-[11px] font-medium text-red-600">{fieldErrors[field.key]}</p>
                  )}
                  </div>
                  );
                })}
              </div>

              {/* Same person as an existing customer? Then this order joins their history. */}
              {linkedCustomer ? (
                <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 dark:border-emerald-900/50 dark:bg-emerald-950/30">
                  <UserCheck size={15} className="mt-0.5 shrink-0 text-emerald-700 dark:text-emerald-400" />
                  <div className="min-w-0 flex-1 text-[12px] text-emerald-900 dark:text-emerald-100">
                    <p className="font-semibold">
                      {linkedCustomer.name} <span className="font-mono text-[11px] font-normal opacity-80">{linkedCustomer.code}</span>
                    </p>
                    <p className="text-[11px] opacity-90">
                      {linkedCustomer.orders} earlier order{linkedCustomer.orders === 1 ? "" : "s"}
                      {linkedCustomer.by === "phone" && linkedId !== linkedCustomer.customerId ? " · same phone" : ""}. This order goes into their history.
                    </p>
                  </div>
                  {/* A typed phone that matches is the same customer anyway; a link staff picked can be undone. */}
                  {linkedId === linkedCustomer.customerId && (
                    <button
                      type="button"
                      onClick={() => notThisCustomer([linkedCustomer.customerId])}
                      className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
                    >
                      Not them
                    </button>
                  )}
                </div>
              ) : askAbout.length > 0 && (
                <div className="space-y-2 rounded-xl border border-sky-200 bg-sky-50 p-3 dark:border-sky-900/50 dark:bg-sky-950/30">
                  <div className="text-[12px] text-sky-900 dark:text-sky-100">
                    <p className="flex items-center gap-1.5 font-semibold"><Users size={13} /> Is this the same person?</p>
                    <p className="text-[11px] opacity-90">
                      {askAbout.length === 1 ? "A customer" : `${askAbout.length} customers`} with this {askAbout.some(m => m.by === "phone") ? "phone or name" : "name"} already {askAbout.length === 1 ? "has" : "have"} orders. Pick them to keep one history.
                    </p>
                  </div>
                  <ul className="space-y-1.5">
                    {askAbout.map(m => (
                      <li key={m.customerId}>
                        <button
                          type="button"
                          onClick={() => linkCustomer(m)}
                          className="flex w-full items-center gap-3 rounded-lg border border-sky-200 bg-card px-3 py-2 text-left transition-colors hover:border-primary/50 hover:bg-primary/5 dark:border-sky-900/50"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-baseline gap-x-1.5 text-xs font-semibold text-foreground">
                              {m.name}
                              <span className="font-mono text-[10.5px] font-normal text-muted-foreground">{m.code}</span>
                              <span className="rounded bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground">Same {m.by}</span>
                            </span>
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {[m.phone, m.address, `${m.orders} order${m.orders === 1 ? "" : "s"}`, `last ${new Date(m.lastOrderAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`].filter(Boolean).join(" · ")}
                            </span>
                          </span>
                          <span className="shrink-0 rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground">Same person</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    onClick={() => notThisCustomer(askAbout.map(m => m.customerId))}
                    className="text-[11px] font-semibold text-sky-800 underline-offset-2 hover:underline dark:text-sky-300"
                  >
                    No, this is someone new
                  </button>
                </div>
              )}

              {/* Upaya courier: the hub location, and booking on "Complete Sale" */}
              {sending && upayaEnabled && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      <Truck size={11} /> Upaya courier
                    </p>
                    <label className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={bookUpaya}
                        onChange={e => setBookUpaya(e.target.checked)}
                        className="h-3.5 w-3.5 accent-primary cursor-pointer"
                      />
                      Book on complete
                    </label>
                  </div>
                  <div role="radiogroup" aria-label="Upaya delivery service" className="grid grid-cols-2 gap-2">
                    {BATCH_COURIER_SERVICES.map(sv => {
                      const on = courierService === sv.id;
                      return (
                        <button
                          key={sv.id}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => {
                            if (on) return;
                            setCourierService(sv.id);
                            if (hub) void chooseHub(hub, sv.id); // re-price for this service
                          }}
                          className={cn(
                            "flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2 text-left transition-all",
                            on ? "border-primary/50 bg-primary/10" : "border-border bg-muted hover:border-primary/30"
                          )}
                        >
                          <span className={cn("text-xs font-semibold", on ? "text-primary" : "text-foreground")}>{sv.label}</span>
                          <span className="text-[10.5px] leading-tight text-muted-foreground">
                            {sv.id === DOOR_TO_DOOR ? "Rider brings it to the customer" : "Customer collects it at Upaya's branch"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <UpayaHubPicker value={hub} onChange={area => chooseHub(area)} address={customer.address} />
                  {hub && hubRate?.state === "loading" && <p className="text-[11px] text-muted-foreground">Getting Upaya&apos;s delivery charge…</p>}
                  {hub && hubRate?.state === "set" && (
                    <p className="text-[11px] text-emerald-700 dark:text-emerald-400">Upaya {serviceLabel} charge {formatNPR(hubRate.charge ?? 0)} filled in as Delivery. You can still change it.</p>
                  )}
                  {hub && hubRate?.state === "none" && (
                    <p className="text-[11px] text-amber-600">Upaya has no {serviceLabel} price for this hub right now. Enter the delivery charge yourself.</p>
                  )}
                  {bookUpaya && customer.phone.trim() && !courierMobile(customer.phone) && (
                    <p className="text-[11px] font-medium text-amber-600">Upaya needs a 10-digit mobile number (98…) to book.</p>
                  )}
                  {!bookUpaya && (
                    <p className="text-[11px] text-muted-foreground">Not booked now. Send it later from Customers & Orders (Send to Upaya).</p>
                  )}
                </div>
              )}

              {!pr && (<>
              <p className="pt-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Payment</p>
              <div className={cn("grid gap-2", walkIn ? "grid-cols-1" : "grid-cols-2")}>
                {walkIn && (
                  <label className="space-y-1">
                    <span className="text-[11px] font-semibold text-muted-foreground">
                      {paymentMethod === "QR" ? "QR amount received" : "Cash received"} <span className="font-normal">(less = discount)</span>
                    </span>
                    <span className="relative block">
                      <Banknote size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <input type="number" inputMode="decimal" min={0} step="0.01" value={cashReceived} onChange={e => setCashReceived(e.target.value)} placeholder={grandTotal.toFixed(0)} className={smallField} />
                    </span>
                  </label>
                )}
                {!walkIn && (<>
                <label className="space-y-1">
                  <span className="text-[11px] font-semibold text-muted-foreground">Delivery</span>
                  <span className="relative block">
                    <Truck size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input type="number" inputMode="decimal" min={0} step="0.01" value={deliveryAmount || ""} onChange={e => setDeliveryAmount(Math.max(0, parseFloat(e.target.value) || 0))} placeholder="0" className={smallField} />
                  </span>
                </label>
                {deliveryPay === "partial" && (
                  <label className="space-y-1">
                    <span className="text-[11px] font-semibold text-muted-foreground">Advance paid *</span>
                    <span className="relative block">
                      <Banknote size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <input type="number" inputMode="decimal" min={0} step="0.01" value={advance} onChange={e => setAdvance(e.target.value)} placeholder="0" className={smallField} />
                    </span>
                  </label>
                )}
                {deliveryPay === "cod" && (
                <label className="space-y-1">
                  <span className="text-[11px] font-semibold text-muted-foreground">COD *</span>
                  <span className="relative block">
                    <Receipt size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      required
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      value={codAmount}
                      onChange={e => setCodOverride(e.target.value)}
                      title="Cash the customer pays on delivery. Defaults to the total, but can be overridden."
                      className={smallField}
                    />
                  </span>
                </label>
                )}
                </>)}
              </div>

              {/* Payment Method */}
              {walkIn ? (
                <div className="flex items-center gap-2" role="radiogroup" aria-label="Payment method">
                  {([
                    { value: "CASH", label: "Cash", icon: Banknote },
                    { value: "QR", label: "QR", icon: QrCode },
                  ] as const).map(option => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={paymentMethod === option.value}
                      onClick={() => setPaymentMethod(option.value)}
                      className={cn("flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold rounded-xl border transition-all", paymentMethod === option.value ? "bg-primary/10 border-primary/40 text-primary" : "bg-muted border-border text-muted-foreground hover:text-foreground")}
                    >
                      <option.icon size={12} /> {option.label}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Payment status">
                  {([
                    { value: "cod", label: "Full COD", icon: Truck },
                    { value: "partial", label: "Partially paid", icon: Banknote },
                    { value: "paid", label: "Fully paid", icon: CheckCircle },
                  ] as const).map(option => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={deliveryPay === option.value}
                      onClick={() => setDeliveryPay(option.value)}
                      className={cn("flex flex-col items-center justify-center gap-1 px-2 py-2.5 text-[12px] font-semibold rounded-xl border transition-all", deliveryPay === option.value ? "bg-primary/10 border-primary/40 text-primary" : "bg-muted border-border text-muted-foreground hover:text-foreground")}
                    >
                      <option.icon size={13} /> {option.label}
                    </button>
                  ))}
                </div>
              )}
              </>)}
          </div>
        </div>

        {/* MIDDLE: Product Catalog */}
        <div className="min-w-0 space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1 min-w-0">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={searchRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder="Search or scan a product or customer…"
                aria-label="Search products or scan a barcode"
                aria-keyshortcuts="/"
                className="w-full pl-8 pr-3 lg:pr-10 py-2.5 text-sm rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              {/* The "/" shortcut is for keyboards: shown on computers only. */}
              <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded bg-muted px-1.5 py-0.5 font-sans text-[11px] font-semibold text-muted-foreground lg:block">/</kbd>
            </div>
          </div>

          {/* Categories: one tap instead of a dropdown */}
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="radiogroup" aria-label="Filter by category">
            {[{ id: "all", name: "All" }, ...categories].map(c => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={catFilter === c.id}
                onClick={() => setCatFilter(c.id)}
                className={cn(
                  "shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all",
                  catFilter === c.id ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border/80 text-muted-foreground hover:text-foreground"
                )}
              >
                {c.name}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 gap-2">
            {loading && Array.from({ length: 6 }).map((_, i) => <ProductCardPlaceholder key={i} />)}
            {!loading && displayedProducts.map(p => {
              const avail = getStock(p.id);
              const inCart = cart.filter(c => c.productId === p.id).reduce((sum, c) => sum + c.quantity, 0);
              // A future order can take sold-out products: they'll be restocked before it's sent.
              const exhausted = avail <= 0 && !future;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addToCart(p)}
                  disabled={exhausted}
                  className={cn("relative flex flex-col items-start gap-1.5 p-2 bg-card border rounded-xl text-left transition-all", exhausted ? "opacity-50 cursor-not-allowed border-border/40" : "border-border/80 hover:border-primary/40 hover:shadow-md hover:shadow-primary/5 active:scale-[0.98]")}
                >
                  {/* Spoken name: "Add to cart: <name> <price> <N left>", the visible text with what it does. */}
                  <span className="sr-only">Add to cart: </span>
                  {inCart > 0 && (
                    <span className="absolute top-2 right-2 min-w-5 h-5 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-extrabold flex items-center justify-center" aria-label={`${inCart} in cart`}>{inCart}</span>
                  )}
                  <div className="w-full aspect-[4/3] rounded-lg bg-primary/10 border border-border/40 flex items-center justify-center overflow-hidden">
                    {p.imageUrl ? (
                      // Product photos can come from any host (e.g. the website's Cloudinary), so a plain img.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.imageUrl} alt="" loading="lazy" className="w-full h-full object-cover" />
                    ) : (
                      <Package size={18} className="text-primary/70" />
                    )}
                  </div>
                  <div className="min-w-0 w-full">
                    <p className="text-[12px] font-bold text-foreground line-clamp-2 leading-tight">{p.name}</p>
                  </div>
                  <div className="flex flex-wrap items-center justify-between w-full mt-auto gap-1">
                    <p className="text-xs font-extrabold text-primary">{formatNPR(p.sellingPrice)}</p>
                    <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap", avail <= p.minStockLevel ? "bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400" : "bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400")}>
                      {avail <= 0 ? (future ? "Out · order" : "Sold out") : `${avail} left`}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
          {!loading && <ShowMoreButton remaining={remaining} step={step} onClick={showMore} />}
          {!loading && filteredProducts.length === 0 && (
            <div className="bg-card border border-border/80 rounded-2xl">
              {products.length === 0 ? (
                <EmptyState icon={Package} title="No products to sell yet" description="Add active products in the catalog and they will appear here." />
              ) : (
                <EmptyState icon={Search} title="No matching products" description="Try a different search or category." />
              )}
            </div>
          )}
        </div>

        {/* RIGHT: Cart, total & checkout */}
        <div className="lg:sticky lg:top-0 min-w-0 space-y-3">
          <div ref={cartRef} className="bg-card border border-border/80 rounded-2xl shadow-sm overflow-hidden scroll-mt-3">
            {/* Cart Header */}
            <div className="p-4 border-b border-border/60 flex items-center justify-between">
              <h2 className="font-bold flex items-center gap-2 text-sm"><ShoppingCart size={15} className="text-primary" />Cart ({cartUnits} {cartUnits === 1 ? "item" : "items"})</h2>
              {cart.length > 0 && <button type="button" onClick={() => setCart([])} className="text-[12px] text-red-500 font-semibold hover:underline">Clear All</button>}
            </div>

            {/* Cart Items */}
            <div className="divide-y divide-border/40 max-h-[28rem] overflow-y-auto">
              {cart.length === 0 ? (
                <div className="flex flex-col items-center py-10 text-center text-muted-foreground gap-2">
                  <ShoppingCart size={28} className="opacity-30" />
                  <p className="text-xs font-semibold">Cart is empty</p>
                  <p className="text-[11px]">Tap a product or scan a barcode to add it.</p>
                </div>
              ) : (
                cart.map(item => {
                  const product = products.find(p => p.id === item.productId);
                  const { size, color } = itemOptions({ variant: item.variantLabel });
                  const inStock = lineStock(item);
                  const discounted = item.unitPrice < item.listPrice;
                  return (
                    <div key={lineKey(item)} className="px-4 py-3.5 space-y-3">
                      <div className="flex items-start gap-3">
                        <div className="w-12 h-12 shrink-0 rounded-lg bg-primary/10 border border-border/40 flex items-center justify-center overflow-hidden">
                          {product?.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={product.imageUrl} alt="" loading="lazy" className="w-full h-full object-cover" />
                          ) : (
                            <Package size={16} className="text-primary/70" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold leading-snug text-foreground break-words">{item.name}</p>
                          {(size || color) && (
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              {size && (
                                <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground">
                                  Size <span className="font-extrabold text-foreground">{size}</span>
                                </span>
                              )}
                              {color && (
                                <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-bold text-foreground">
                                  <Swatch colour={color} /> {color}
                                </span>
                              )}
                            </div>
                          )}
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {formatNPR(item.listPrice)} each · <span className={cn(inStock - item.quantity <= 0 && "font-semibold text-amber-600 dark:text-amber-400")}>{inStock} in stock</span>
                          </p>
                        </div>
                        <button type="button" onClick={() => removeFromCart(item)} aria-label={`Remove ${item.name}`} title="Remove" className="w-8 h-8 -mr-1 -mt-1 rounded-lg flex items-center justify-center text-muted-foreground hover:text-red-500 hover:bg-red-500/10 shrink-0"><X size={15} /></button>
                      </div>
                      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2 sm:pl-[3.75rem]">
                        <label className="flex flex-col gap-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Price</span>
                          <span className="relative">
                            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">Rs</span>
                            <input
                              type="number"
                              inputMode="decimal"
                              min={0}
                              max={item.listPrice}
                              value={item.unitPrice}
                              onChange={e => setPrice(item, parseFloat(e.target.value))}
                              onFocus={e => e.target.select()}
                              aria-label={`Price of ${item.name}`}
                              title="Lower the price to give a discount"
                              className={cn("w-24 h-9 pl-7 pr-2 text-[13px] font-semibold rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none", discounted ? "border-primary/50" : "border-border")}
                            />
                          </span>
                        </label>
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Qty</span>
                          <div className="flex items-center gap-1">
                            <button type="button" onClick={() => updateQty(item, -1)} disabled={item.quantity <= 1} aria-label={`Decrease ${item.name}`} className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center hover:bg-muted/70 disabled:opacity-40"><Minus size={12} /></button>
                            <input
                              type="number"
                              inputMode="numeric"
                              min={1}
                              value={item.quantity}
                              onChange={e => setQty(item, parseInt(e.target.value, 10))}
                              onFocus={e => e.target.select()}
                              aria-label={`Quantity of ${item.name}`}
                              className="w-11 h-9 text-center text-sm font-bold rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            />
                            <button type="button" onClick={() => updateQty(item, 1)} aria-label={`Increase ${item.name}`} className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center hover:bg-muted/70"><Plus size={12} /></button>
                          </div>
                        </div>
                        <div className="ml-auto text-right">
                          {discounted && <p className="text-[11px] text-muted-foreground line-through">{formatNPR(item.listPrice * item.quantity)}</p>}
                          <p className="text-sm font-extrabold text-foreground tabular-nums">{formatNPR(item.unitPrice * item.quantity)}</p>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Total + checkout */}
            <div className="p-4 border-t border-border/60 space-y-2.5">
              {/* Billing Summary */}
              <div className="bg-muted/30 rounded-xl p-3 space-y-1.5 text-xs">
                {pr ? (<>
                <div className="flex justify-between text-muted-foreground"><span>Value of goods given</span><span>{formatNPR(total)}</span></div>
                <div className="flex justify-between font-extrabold text-base text-foreground pt-1 border-t border-border/60"><span>Charged</span><span>{formatNPR(0)}</span></div>
                {instantLabel && <div className="flex justify-between text-muted-foreground"><span>Sent with</span><span>{instantLabel}</span></div>}
                </>) : (<>
                {discountAmount + totalCut + shortDiscount > 0 && (
                  <div className="flex justify-between text-emerald-600">
                    <span>Discount{shortDiscount > 0 && " (paid less)"}</span><span>−{formatNPR(discountAmount + totalCut + shortDiscount)}</span>
                  </div>
                )}
                {delivery > 0 && <div className="flex justify-between text-muted-foreground"><span>Delivery</span><span>{formatNPR(delivery)}</span></div>}
                <div className="flex items-center justify-between gap-2 font-extrabold text-base text-foreground pt-1 border-t border-border/60">
                  <label htmlFor="pos-final-total">Total</label>
                  <span className="flex items-center gap-2">
                    {totalCut > 0 && (
                      <button
                        type="button"
                        onClick={() => setTotalOverride(null)}
                        title={`Back to the full total, ${formatNPR(fullTotal)}`}
                        className="text-[11px] font-semibold text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      >
                        Reset
                      </button>
                    )}
                    <span className="relative">
                      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-muted-foreground">Rs</span>
                      <input
                        id="pos-final-total"
                        type="number"
                        inputMode="decimal"
                        min={delivery}
                        max={fullTotal}
                        step="0.01"
                        value={totalEdit ? totalEdit.value : String(Math.round(grandTotal * 100) / 100)}
                        onChange={e => {
                          setTotalOverride({ value: e.target.value, base: fullTotal });
                          // COD follows the new total rather than an amount typed earlier.
                          setCodOverride(null);
                        }}
                        onBlur={() => { if (totalEdit && !Number.isFinite(typedTotal)) setTotalOverride(null); }}
                        onFocus={e => e.target.select()}
                        disabled={cart.length === 0}
                        title="Type a lower final total; the difference is recorded as a discount"
                        className={cn("w-28 h-8 pl-7 pr-2 text-right text-sm font-extrabold rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none", totalCut > 0 ? "border-primary/50" : "border-border")}
                      />
                    </span>
                  </span>
                </div>
                {Number.isFinite(typedTotal) && typedTotal > fullTotal && (
                  <p className="text-[11px] font-medium text-amber-600">The total can&apos;t be more than {formatNPR(fullTotal)}. Raise item prices or the delivery charge instead.</p>
                )}
                {Number.isFinite(typedTotal) && typedTotal < delivery && (
                  <p className="text-[11px] font-medium text-amber-600">The total can&apos;t be less than the delivery charge ({formatNPR(delivery)}).</p>
                )}
                {shortDiscount > 0 && <div className="flex justify-between font-bold text-foreground"><span>Paid</span><span>{formatNPR(amountDue)}</span></div>}
                {advancePaid > 0 && <div className="flex justify-between text-muted-foreground"><span>Advance paid</span><span>−{formatNPR(advancePaid)}</span></div>}
                {!walkIn && <div className="flex justify-between font-bold text-primary"><span>COD to Collect</span><span>{formatNPR(parseFloat(codAmount) || 0)}</span></div>}
                {change !== null && (
                  <div className="flex justify-between font-bold text-emerald-600">
                    <span>Change to give</span><span>{formatNPR(change)}</span>
                  </div>
                )}
                {instantLabel && <div className="flex justify-between text-muted-foreground"><span>Sent with</span><span>{instantLabel}</span></div>}
                </>)}
              </div>

              {future && (
                <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
                  <CalendarClock size={13} className="mt-0.5 shrink-0" />
                  <span>
                    Saved as a future order: no stock is taken and it isn&apos;t counted in sales yet. Send it from{" "}
                    <Link href="/customers?future=1" className="font-semibold underline underline-offset-2">Customers &amp; Orders → Future orders</Link>.
                  </span>
                </p>
              )}

              <Button
                onClick={handleCheckout}
                disabled={cart.length === 0}
                loading={submitting}
                className="w-full py-3 font-bold"
              >
                {!submitting && (future ? <CalendarClock size={15} /> : pr ? <Gift size={15} /> : <Receipt size={15} />)}
                {submitting
                  ? future ? "Saving future order…" : pr ? "Recording PR order…" : "Completing sale…"
                  : future ? `Save future order · ${pr ? `${cartUnits} item${cartUnits === 1 ? "" : "s"}` : formatNPR(amountDue)}`
                  : pr ? `Record PR order · ${cartUnits} item${cartUnits === 1 ? "" : "s"} free` : `${walkIn ? "Complete Sale" : "Complete Sale & Invoice"} · ${formatNPR(amountDue)}`}
              </Button>
            </div>
          </div>

          {/* Recent Sales Mini-Feed: folded away so the order stays the focus */}
          <details className="group bg-card border border-border/80 rounded-2xl overflow-hidden shadow-sm">
            <summary className="p-4 flex items-center justify-between cursor-pointer list-none [&::-webkit-details-marker]:hidden">
              <h3 className="font-bold text-sm">Recent Transactions</h3>
              <span className="text-[12px] font-semibold text-muted-foreground group-open:hidden">Show</span>
              <span className="text-[12px] font-semibold text-muted-foreground hidden group-open:inline">Hide</span>
            </summary>
            <div className="border-t border-border/60" />
            <div tabIndex={0} aria-label="Recent transactions" className="divide-y divide-border/30 max-h-56 overflow-y-auto">
              {loading && Array.from({ length: 3 }).map((_, i) => <TransactionRowPlaceholder key={i} />)}
              {!loading && sales.length === 0 && (
                <p className="px-4 py-6 text-center text-xs text-muted-foreground">No sales recorded yet.</p>
              )}
              {!loading && sales.slice(0, 8).map(s => (
                <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-foreground flex items-center gap-1.5">
                      <span className="truncate">{s.invoiceNumber}</span>
                      {s.source === "website" && (
                        <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded-full whitespace-nowrap bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400">
                          Website
                        </span>
                      )}
                      {s.kind === "pr" && (
                        <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded-full whitespace-nowrap bg-pink-100 dark:bg-pink-950/40 text-pink-700 dark:text-pink-300">PR</span>
                      )}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">{s.customerName ?? "Walk-in"} · {new Date(s.createdAt).toLocaleDateString()}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-extrabold">{formatNPR(s.totalAmount)}</p>
                    <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded", PAYMENT_STYLES[s.paymentStatus])}>{s.paymentStatus}</span>
                  </div>
                </div>
              ))}
            </div>
          </details>
        </div>
      </div>

      {cart.length > 0 && !cartInView && (
        <button
          type="button"
          onClick={() => cartRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
          className="lg:hidden fixed left-3 right-3 z-20 flex items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-primary text-primary-foreground text-sm font-bold shadow-lg shadow-primary/30 animate-fade-in"
          style={{ bottom: "calc(max(0.5rem, env(safe-area-inset-bottom)) + 4.75rem)" }}
        >
          <span className="flex items-center gap-2"><ShoppingCart size={15} /> View cart ({cartUnits})</span>
          <span>{formatNPR(grandTotal)}</span>
        </button>
      )}

      {/* Size / colour picker */}
      <Modal
        open={picking !== null}
        onClose={() => setPicking(null)}
        title={picking ? `${picking.name}: pick ${pickAxes(picking)}` : "Pick size"}
        size={picking && new Set(picking.variants.map(v => v.size.trim().toLowerCase())).size > 4 ? "lg" : "md"}
      >
        {picking && (
          <div className="p-4 sm:p-5">
            <VariantPicker
              variants={picking.variants}
              available={id => (picking.variants.find(v => v.id === id)?.quantity ?? 0) - (cart.find(c => c.variantId === id)?.quantity ?? 0)}
              onPick={id => {
                const v = picking.variants.find(x => x.id === id);
                if (v) addToCart(picking, v);
              }}
              allowSoldOut={future}
            />
          </div>
        )}
      </Modal>

      {/* Receipt */}
      <Modal open={showReceipt} onClose={() => setShowReceipt(false)} title="Sale completed" size="sm" hideHeader className="print-area">
        {lastSale && (
          <div className="p-6 space-y-3">
            <div className="text-center space-y-1">
              <div className="no-print w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-950/30 flex items-center justify-center mx-auto mb-2">
                <CheckCircle size={24} className="text-emerald-500" />
              </div>
              <h2 className="text-lg font-extrabold">{store.name}</h2>
              {(store.address || store.phone) && (
                <p className="text-[11px] text-muted-foreground">{[store.address, store.phone].filter(Boolean).join(" · ")}</p>
              )}
              <p className="text-xs text-muted-foreground font-mono">{lastSale.invoiceNumber}</p>
            </div>

            <div className="border-t border-dashed border-border/60 pt-4 space-y-2 text-xs">
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Customer</span><span className="font-semibold text-right">{lastSale.customerName ?? "Walk-in Customer"}</span></div>
              {lastSale.customer && <div className="flex justify-between gap-3"><span className="text-muted-foreground">Customer ID</span><span className="font-semibold font-mono text-right">{lastSale.customer.code}</span></div>}
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Date</span><span className="font-semibold text-right">{new Date(lastSale.createdAt).toLocaleString()}</span></div>
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Payment</span><span className="font-semibold text-right">{lastSale.kind === "pr"
                ? "PR · given free"
                : receiptExtras.walkIn
                ? (lastSale.paymentMethod === "QR" ? "QR (paid)" : "Cash (paid)")
                : receiptExtras.deliveryPay === "paid" ? "Fully paid" : receiptExtras.deliveryPay === "partial" ? "Partially paid" : "Cash on Delivery"}</span></div>
              {courierBooking && (
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Upaya</span>
                  <span className={cn("font-semibold text-right break-words min-w-0", courierBooking.state === "booked" && "text-emerald-600", courierBooking.state === "failed" && "text-red-600")}>
                    {courierBooking.text}
                  </span>
                </div>
              )}
            </div>

            <div className="border-t border-dashed border-border/60 pt-4 space-y-1.5">
              {lastSale.items.map(item => (
                <div key={item.id} className="text-xs">
                  <div className="flex justify-between gap-3">
                    <span className="min-w-0 break-words font-semibold">{item.product.name}</span>
                    <span className="font-semibold shrink-0">{formatNPR(item.unitPrice * item.quantity)}</span>
                  </div>
                  <p className="text-[12px] text-muted-foreground">
                    {[itemOptionsText(item), `${item.quantity} × ${formatNPR(item.unitPrice)}`].filter(Boolean).join(" · ")}
                  </p>
                </div>
              ))}
            </div>

            <div className="border-t border-dashed border-border/60 pt-4 space-y-1.5 text-xs">
              {lastSale.discount > 0 && <div className="flex justify-between text-emerald-600"><span>Discount</span><span>−{formatNPR(lastSale.discount)}</span></div>}
              {lastSale.deliveryAmount > 0 && <div className="flex justify-between text-muted-foreground"><span>Delivery</span><span>{formatNPR(lastSale.deliveryAmount)}</span></div>}
              <div className="flex justify-between font-extrabold text-base text-foreground pt-1 border-t border-border/60"><span>TOTAL</span><span>{formatNPR(lastSale.totalAmount + lastSale.deliveryAmount)}</span></div>
              {receiptExtras.advance > 0 && <div className="flex justify-between text-muted-foreground"><span>Advance paid</span><span>−{formatNPR(receiptExtras.advance)}</span></div>}
              {!receiptExtras.walkIn && lastSale.paymentMethod === "COD" && <div className="flex justify-between font-bold text-primary"><span>COD to Collect</span><span>{formatNPR(lastSale.codAmount)}</span></div>}
              {receiptExtras.cashReceived !== null && (
                <>
                  <div className="flex justify-between text-muted-foreground"><span>{lastSale.paymentMethod === "QR" ? "QR received" : "Cash received"}</span><span>{formatNPR(receiptExtras.cashReceived)}</span></div>
                  {receiptExtras.cashReceived > lastSale.totalAmount + lastSale.deliveryAmount && (
                    <div className="flex justify-between font-bold"><span>Change</span><span>{formatNPR(receiptExtras.cashReceived - (lastSale.totalAmount + lastSale.deliveryAmount))}</span></div>
                  )}
                </>
              )}
            </div>

            <div className="text-center text-[10px] text-muted-foreground mt-2">
              Thank you for shopping at {store.name}!
            </div>

            <div className="no-print space-y-2">
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setPrintReceipt(true)} className="flex-1 px-2 whitespace-nowrap">
                  <Printer size={14} /> Print Receipt
                </Button>
                <Button variant="secondary" onClick={() => setShowLabel(true)} className="flex-1 px-2 whitespace-nowrap">
                  <Tag size={14} /> Customer Label
                </Button>
              </div>
              <Button onClick={() => setShowReceipt(false)} className="w-full font-bold" data-autofocus>
                Done
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {lastSale && (
        <CustomerLabelDialog open={showLabel} onClose={() => setShowLabel(false)} order={lastSale} store={store} />
      )}
      {lastSale && printReceipt && (
        <ReceiptDialog open onClose={() => setPrintReceipt(false)} sales={[lastSale]} store={store} />
      )}
      </div>
</>
  );
}
