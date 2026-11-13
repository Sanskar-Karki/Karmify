"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ShoppingCart, Search, Plus, Minus, X, CheckCircle, User, Phone, MapPin,
  Receipt, Package, QrCode, Truck, Printer, Tag, Store, Banknote,
} from "lucide-react";
import { toast } from "sonner";
import { bookSaleWithUpaya, createSale, estimateCourierRate, getCourierStatus } from "@/app/actions";
import { UpayaHubPicker } from "@/components/shared/UpayaHubPicker";
import { courierMobile, type CourierArea } from "@/lib/courier";
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
import { mutate } from "@/lib/mutate";
import { countsAsSale, deliveryAddress, itemOptionsText, PAYMENT_STYLES } from "@/lib/orders";
import { nameProblem, normalizePhone, parseCustomerCode, phoneProblem } from "@/lib/customerIdentity";
import { useStoreProfile } from "@/lib/storeProfile";
import { shopOfProducts, useShop } from "@/lib/shop";
import { sortVariants } from "@/components/shared/VariantStock";
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

/** Walk-in: sold over the counter and paid now. Delivery: sent to the customer, usually cash on delivery. */
type SaleMode = "walkin" | "delivery";

// The sale in progress survives a reload or a closed tab on this device.
const DRAFT_KEY = "karmify-pos-draft";
type Draft = {
  cart: CartItem[];
  customer: typeof BLANK_CUSTOMER;
  mode: SaleMode;
  deliveryAmount: number;
  /** Delivery: the Upaya hub location chosen. */
  hub?: CourierArea | null;
};

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
  const [deliveryAmount, setDeliveryAmount] = useState(0);
  // null means "follow the computed total"; a string is a manual override.
  const [codOverride, setCodOverride] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"COD" | "QR">("COD");
  // Delivery orders: nothing paid yet, an advance paid, or paid in full.
  const [deliveryPay, setDeliveryPay] = useState<"cod" | "partial" | "paid">("cod");
  const [advance, setAdvance] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState<SaleMode>("delivery");
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
  const rateRequest = useRef(0);

  /** Chooses the hub and fills in Upaya's delivery charge for it (1 kg, door to door, as booked). */
  async function chooseHub(area: CourierArea | null) {
    setHub(area);
    const id = ++rateRequest.current;
    if (!area) return setHubRate(null);
    setHubRate({ state: "loading" });
    const result = await estimateCourierRate(area.locationId, 1, 3).catch(() => null);
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
        if (d.mode === "walkin" || d.mode === "delivery") setMode(d.mode);
        if (typeof d.deliveryAmount === "number") setDeliveryAmount(d.deliveryAmount);
        if (d.hub && Number.isInteger(d.hub.areaId)) setHub(d.hub);
      }
    } catch {
      // A broken or blocked draft just means starting fresh.
    }
    draftLoaded.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    if (!draftLoaded.current) return;
    try {
      const draft: Draft = { cart: rawCart, customer, mode, deliveryAmount, hub };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Storage full or blocked: the sale still works, it just won't survive a reload.
    }
  }, [rawCart, customer, mode, deliveryAmount, hub]);

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
    if (available <= 0) {
      if (variant) toast.info(`"${fullName}" is sold out.`, { id: "cart-stock-limit" });
      return;
    }
    if ((cart.find(c => lineKey(c) === lineKey(line))?.quantity ?? 0) >= available) {
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
    if (delta > 0 && item.quantity >= available) {
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
    const qty = Math.max(1, Math.min(Math.floor(value), Math.max(1, available)));
    if (value > available) notifyLimit(item.name, available);
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
    toast.info(`Returning customer: ${name}`, { id: "returning-customer", description: previous.customer?.code });
  }

  // Repeat customers are recognised by phone, so staff don't retype their details.
  function fillReturningCustomer() {
    const phone = normalizePhone(customer.phone);
    if (!phone || customer.name.trim()) return;
    const previous = sales.find(s => s.customerName && normalizePhone(s.customerPhone) === phone);
    if (previous) fillCustomerFrom(previous);
  }

  const walkIn = mode === "walkin";
  const subtotal = cart.reduce((a, c) => a + c.listPrice * c.quantity, 0);
  const discountAmount = cart.reduce((a, c) => a + Math.max(0, c.listPrice - c.unitPrice) * c.quantity, 0);
  const total = subtotal - discountAmount;
  const delivery = walkIn ? 0 : deliveryAmount;
  const grandTotal = total + delivery;
  // QR orders are paid up front, so the rider collects nothing.
  // Walk-in picks Cash or QR; a paid-in-full delivery is recorded like a QR prepayment (nothing to collect).
  const method: "COD" | "QR" = walkIn ? paymentMethod : deliveryPay === "paid" ? "QR" : "COD";
  const advancePaid = deliveryPay === "partial" ? Math.max(0, parseFloat(advance) || 0) : 0;
  const codAmount = walkIn || method === "QR"
    ? "0"
    : deliveryPay === "partial"
      ? Math.max(0, grandTotal - advancePaid).toFixed(2)
      : codOverride ?? grandTotal.toFixed(2);
  // Walk-in: what the customer actually handed over (cash or QR). Less than the
  // total means the rest was let go, so it's recorded as a discount.
  const cashGiven = parseFloat(cashReceived);
  const received = walkIn && Number.isFinite(cashGiven) && cashGiven >= 0 ? cashGiven : null;
  const shortDiscount = received !== null && received < grandTotal ? grandTotal - received : 0;
  const amountDue = grandTotal - shortDiscount;
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

  async function handleCheckout() {
    if (cart.length === 0) return;
    if (fieldErrors.name) return void toast.error(fieldErrors.name);
    if (fieldErrors.phone) return void toast.error(fieldErrors.phone);
    const cod = parseFloat(codAmount) || 0;
    if (walkIn) {
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
    const booking = !walkIn && upayaEnabled && bookUpaya;
    if (booking) {
      if (!hub) return void toast.error("Choose the Upaya hub location for this delivery.");
      if (!courierMobile(customer.phone)) return void toast.error("Upaya needs a 10-digit mobile number (98…) to book this delivery.");
    }

    setSubmitting(true);
    setCourierBooking(null);
    const result = await mutate(() => createSale({
      customerName: customer.name.trim() || undefined,
      customerPhone: customer.phone.trim() || undefined,
      customerAddress: walkIn ? undefined : customer.address.trim(),
      items: cart.map(c => ({ productId: c.productId, quantity: c.quantity, unitPrice: c.listPrice, variantId: c.variantId ?? null })),
      discount: discountAmount + shortDiscount,
      deliveryAmount: delivery,
      codAmount: walkIn ? 0 : cod,
      totalAmount: total - shortDiscount,
      paymentMethod: method,
      walkIn,
      partial: !walkIn && deliveryPay === "partial",
      courierArea: !walkIn && hub ? { areaId: hub.areaId, locationId: hub.locationId, title: hub.title } : null,
      // The shop being sold from; under "All shops", the cart's products' shop.
      brand: shop !== "all" ? shop : shopOfProducts(products.filter(p => cart.some(c => c.productId === p.id))),
    }));
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
      deliveryPay: walkIn ? null : deliveryPay,
      advance: advancePaid,
    });
    setDeliveryPay("cod");
    setAdvance("");
    setShowReceipt(true);
    setCashReceived("");
    setCart([]);
    setCustomer(BLANK_CUSTOMER);
    setDeliveryAmount(0);
    setCodOverride(null);
    setPaymentMethod("COD");
    setHub(null);
    setHubRate(null);

    // The sale is saved; now book it with Upaya. A failure leaves the sale as it
    // is, and it can be booked later from the customer's order.
    if (booking) {
      setCourierBooking({ state: "booking", text: "Booking with Upaya…" });
      const booked = await bookSaleWithUpaya(result.data.id).catch(() => null);
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
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Sales today</p>
              <p className="text-lg font-extrabold leading-tight">{todaySales.length}</p>
            </div>
            <div className="rounded-xl border border-border/80 bg-card px-4 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Taken today</p>
              <p className="text-lg font-extrabold leading-tight">{formatNPR(todayTotal)}</p>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[19rem_minmax(0,1fr)_20rem] xl:grid-cols-[22rem_minmax(0,1fr)_23rem] gap-4 items-start">
        {/* LEFT: Customer & payment (after the cart on phones) */}
        <div className="order-2 lg:order-none lg:sticky lg:top-0 min-w-0">
          <div className="bg-card border border-border/80 rounded-2xl shadow-sm p-4 space-y-2.5">
              {/* Sale type */}
              <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-muted" role="radiogroup" aria-label="Sale type">
                {([
                  { value: "walkin", label: "Walk-in (paid now)", icon: Store },
                  { value: "delivery", label: "Delivery", icon: Truck },
                ] as const).map(option => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={mode === option.value}
                    onClick={() => setMode(option.value)}
                    className={cn("flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg transition-all", mode === option.value ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
                  >
                    <option.icon size={12} /> {option.label}
                  </button>
                ))}
              </div>

              <p className="pt-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Customer{walkIn && <span className="font-medium normal-case tracking-normal"> · optional</span>}
              </p>
              <div className="grid grid-cols-1 gap-2.5">
                {CUSTOMER_FIELDS.filter(field => !(walkIn && field.key === "address")).map(field => (
                  <div key={field.key}>
                  <div className="relative">
                    <field.icon size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      required={!walkIn}
                      type={field.type}
                      value={customer[field.key]}
                      onChange={e => setCustomer(c => ({ ...c, [field.key]: e.target.value }))}
                      placeholder={walkIn ? `${field.placeholder} (optional)` : `${field.placeholder} *`}
                      aria-label={field.label}
                      onBlur={field.key === "phone" ? fillReturningCustomer : undefined}
                      inputMode={field.key === "phone" ? "tel" : undefined}
                      aria-invalid={field.key !== "address" && Boolean(fieldErrors[field.key]) || undefined}
                      className={cn(smallField, "py-2", field.key !== "address" && fieldErrors[field.key] && "border-red-400 focus:ring-red-200")}
                    />
                  </div>
                  {field.key !== "address" && fieldErrors[field.key] && (
                    <p className="mt-1 text-[10px] font-medium text-red-600">{fieldErrors[field.key]}</p>
                  )}
                  </div>
                ))}
              </div>

              {/* Upaya courier: the hub location, and booking on "Complete Sale" */}
              {!walkIn && upayaEnabled && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      <Truck size={11} /> Upaya courier
                    </p>
                    <label className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={bookUpaya}
                        onChange={e => setBookUpaya(e.target.checked)}
                        className="h-3.5 w-3.5 accent-[var(--primary)] cursor-pointer"
                      />
                      Book on complete
                    </label>
                  </div>
                  <UpayaHubPicker value={hub} onChange={chooseHub} address={customer.address} />
                  {hub && hubRate?.state === "loading" && <p className="text-[10px] text-muted-foreground">Getting Upaya&apos;s delivery charge…</p>}
                  {hub && hubRate?.state === "set" && (
                    <p className="text-[10px] text-emerald-700 dark:text-emerald-400">Upaya charge {formatNPR(hubRate.charge ?? 0)} filled in as Delivery. You can still change it.</p>
                  )}
                  {hub && hubRate?.state === "none" && (
                    <p className="text-[10px] text-amber-600">Upaya has no price for this hub right now. Enter the delivery charge yourself.</p>
                  )}
                  {bookUpaya && customer.phone.trim() && !courierMobile(customer.phone) && (
                    <p className="text-[10px] font-medium text-amber-600">Upaya needs a 10-digit mobile number (98…) to book.</p>
                  )}
                  {!bookUpaya && (
                    <p className="text-[10px] text-muted-foreground">Not booked now. Send it later from Customers & Orders (Send to Upaya).</p>
                  )}
                </div>
              )}

              <p className="pt-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Payment</p>
              <div className={cn("grid gap-2", walkIn ? "grid-cols-1" : "grid-cols-2")}>
                {walkIn && (
                  <label className="space-y-1">
                    <span className="text-[10px] font-semibold text-muted-foreground">
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
                  <span className="text-[10px] font-semibold text-muted-foreground">Delivery</span>
                  <span className="relative block">
                    <Truck size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input type="number" inputMode="decimal" min={0} step="0.01" value={deliveryAmount || ""} onChange={e => setDeliveryAmount(Math.max(0, parseFloat(e.target.value) || 0))} placeholder="0" className={smallField} />
                  </span>
                </label>
                {deliveryPay === "partial" && (
                  <label className="space-y-1">
                    <span className="text-[10px] font-semibold text-muted-foreground">Advance paid *</span>
                    <span className="relative block">
                      <Banknote size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <input type="number" inputMode="decimal" min={0} step="0.01" value={advance} onChange={e => setAdvance(e.target.value)} placeholder="0" className={smallField} />
                    </span>
                  </label>
                )}
                {deliveryPay === "cod" && (
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold text-muted-foreground">COD *</span>
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
                    { value: "COD", label: "Cash", icon: Banknote },
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
                      className={cn("flex flex-col items-center justify-center gap-1 px-2 py-2.5 text-[11px] font-semibold rounded-xl border transition-all", deliveryPay === option.value ? "bg-primary/10 border-primary/40 text-primary" : "bg-muted border-border text-muted-foreground hover:text-foreground")}
                    >
                      <option.icon size={13} /> {option.label}
                    </button>
                  ))}
                </div>
              )}
          </div>
        </div>

        {/* MIDDLE: Product Catalog */}
        <div className="order-1 lg:order-none min-w-0 space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1 min-w-0">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={searchRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder="Search, or scan a product or customer...  ( / )"
                aria-label="Search products or scan a barcode"
                className="w-full pl-8 pr-3 py-2.5 text-sm rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
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
              const exhausted = avail <= 0;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addToCart(p)}
                  disabled={exhausted}
                  aria-label={`Add ${p.name} to cart, ${avail} in stock`}
                  className={cn("relative flex flex-col items-start gap-1.5 p-2 bg-card border rounded-xl text-left transition-all", exhausted ? "opacity-50 cursor-not-allowed border-border/40" : "border-border/80 hover:border-primary/40 hover:shadow-md hover:shadow-primary/5 active:scale-[0.98]")}
                >
                  {inCart > 0 && (
                    <span className="absolute top-2 right-2 min-w-5 h-5 px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-extrabold flex items-center justify-center">{inCart}</span>
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
                    <p className="text-[11px] font-bold text-foreground line-clamp-2 leading-tight">{p.name}</p>
                  </div>
                  <div className="flex flex-wrap items-center justify-between w-full mt-auto gap-1">
                    <p className="text-xs font-extrabold text-primary">{formatNPR(p.sellingPrice)}</p>
                    <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap", avail <= p.minStockLevel ? "bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400" : "bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400")}>
                      {exhausted ? "Sold out" : `${avail} left`}
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
        <div className="order-3 lg:order-none lg:sticky lg:top-0 min-w-0 space-y-3">
          <div ref={cartRef} className="bg-card border border-border/80 rounded-2xl shadow-sm overflow-hidden scroll-mt-3">
            {/* Cart Header */}
            <div className="p-4 border-b border-border/60 flex items-center justify-between">
              <h2 className="font-bold flex items-center gap-2 text-sm"><ShoppingCart size={15} className="text-primary" />Cart ({cartUnits} {cartUnits === 1 ? "item" : "items"})</h2>
              {cart.length > 0 && <button type="button" onClick={() => setCart([])} className="text-[11px] text-red-500 font-semibold hover:underline">Clear All</button>}
            </div>

            {/* Cart Items */}
            <div className="divide-y divide-border/30 max-h-64 overflow-y-auto">
              {cart.length === 0 ? (
                <div className="flex flex-col items-center py-10 text-center text-muted-foreground gap-2">
                  <ShoppingCart size={28} className="opacity-30" />
                  <p className="text-xs font-semibold">Cart is empty</p>
                  <p className="text-[10px]">Tap a product or scan a barcode to add it.</p>
                </div>
              ) : (
                cart.map(item => (
                  <div key={lineKey(item)} className="flex items-center gap-2 sm:gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold leading-snug break-words">{item.name}</p>
                      {item.variantLabel && (
                        <p className="text-[10px] font-medium text-muted-foreground">{itemOptionsText({ variant: item.variantLabel })}</p>
                      )}
                      <div className="mt-1 flex items-center gap-1.5">
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
                          className="w-20 h-7 px-2 text-[11px] font-semibold rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        />
                        {item.unitPrice < item.listPrice && (
                          <span className="text-[10px] text-muted-foreground line-through">{formatNPR(item.listPrice)}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button type="button" onClick={() => updateQty(item, -1)} disabled={item.quantity <= 1} aria-label={`Decrease ${item.name}`} className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center hover:bg-muted/70 disabled:opacity-40"><Minus size={11} /></button>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        value={item.quantity}
                        onChange={e => setQty(item, parseInt(e.target.value, 10))}
                        onFocus={e => e.target.select()}
                        aria-label={`Quantity of ${item.name}`}
                        className="w-10 h-8 text-center text-xs font-bold rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                      <button type="button" onClick={() => updateQty(item, 1)} aria-label={`Increase ${item.name}`} className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center hover:bg-muted/70"><Plus size={11} /></button>
                    </div>
                    <span className="text-xs font-bold w-20 text-right shrink-0">{formatNPR(item.unitPrice * item.quantity)}</span>
                    <button type="button" onClick={() => removeFromCart(item)} aria-label={`Remove ${item.name}`} className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-red-500 hover:bg-red-500/10 shrink-0"><X size={14} /></button>
                  </div>
                ))
              )}
            </div>

            {/* Total + checkout */}
            <div className="p-4 border-t border-border/60 space-y-2.5">
              {/* Billing Summary */}
              <div className="bg-muted/30 rounded-xl p-3 space-y-1.5 text-xs">
                {discountAmount + shortDiscount > 0 && (
                  <div className="flex justify-between text-emerald-600">
                    <span>Discount{shortDiscount > 0 && " (paid less)"}</span><span>−{formatNPR(discountAmount + shortDiscount)}</span>
                  </div>
                )}
                {delivery > 0 && <div className="flex justify-between text-muted-foreground"><span>Delivery</span><span>{formatNPR(delivery)}</span></div>}
                <div className="flex justify-between font-extrabold text-base text-foreground pt-1 border-t border-border/60"><span>Total</span><span>{formatNPR(amountDue)}</span></div>
                {advancePaid > 0 && <div className="flex justify-between text-muted-foreground"><span>Advance paid</span><span>−{formatNPR(advancePaid)}</span></div>}
                {!walkIn && <div className="flex justify-between font-bold text-primary"><span>COD to Collect</span><span>{formatNPR(parseFloat(codAmount) || 0)}</span></div>}
                {change !== null && (
                  <div className="flex justify-between font-bold text-emerald-600">
                    <span>Change to give</span><span>{formatNPR(change)}</span>
                  </div>
                )}
              </div>

              <Button
                onClick={handleCheckout}
                disabled={cart.length === 0}
                loading={submitting}
                className="w-full py-3 font-bold"
              >
                {!submitting && <Receipt size={15} />}
                {submitting ? "Completing sale…" : `${walkIn ? "Complete Sale" : "Complete Sale & Invoice"} · ${formatNPR(amountDue)}`}
              </Button>
            </div>
          </div>

          {/* Recent Sales Mini-Feed: folded away so the order stays the focus */}
          <details className="group bg-card border border-border/80 rounded-2xl overflow-hidden shadow-sm">
            <summary className="p-4 flex items-center justify-between cursor-pointer list-none [&::-webkit-details-marker]:hidden">
              <h3 className="font-bold text-sm">Recent Transactions</h3>
              <span className="text-[11px] font-semibold text-muted-foreground group-open:hidden">Show</span>
              <span className="text-[11px] font-semibold text-muted-foreground hidden group-open:inline">Hide</span>
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
                        <span className="text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded-full whitespace-nowrap bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400">
                          Website
                        </span>
                      )}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">{s.customerName ?? "Walk-in"} · {new Date(s.createdAt).toLocaleDateString()}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-extrabold">{formatNPR(s.totalAmount)}</p>
                    <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded", PAYMENT_STYLES[s.paymentStatus])}>{s.paymentStatus}</span>
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
      <Modal open={picking !== null} onClose={() => setPicking(null)} title={picking ? `${picking.name}: pick size` : "Pick size"} size="sm">
        {picking && (
          <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-2">
            {sortVariants(picking.variants).map(v => {
              const label = [v.size, v.color].filter(Boolean).join(" · ") || "Standard";
              const left = v.quantity - (cart.find(c => c.variantId === v.id)?.quantity ?? 0);
              return (
                <button
                  key={v.id}
                  type="button"
                  disabled={left <= 0}
                  onClick={() => addToCart(picking, v)}
                  className={cn("flex flex-col items-start gap-0.5 px-3 py-2.5 rounded-xl border text-left transition-all", left <= 0 ? "opacity-40 cursor-not-allowed border-border/40" : "border-border/80 hover:border-primary/50 hover:bg-primary/5 cursor-pointer")}
                >
                  <span className="text-sm font-bold">{label}</span>
                  <span className="text-[10px] text-muted-foreground">{left <= 0 ? "Sold out" : `${left} left`}</span>
                </button>
              );
            })}
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
                <p className="text-[10px] text-muted-foreground">{[store.address, store.phone].filter(Boolean).join(" · ")}</p>
              )}
              <p className="text-xs text-muted-foreground font-mono">{lastSale.invoiceNumber}</p>
            </div>

            <div className="border-t border-dashed border-border/60 pt-4 space-y-2 text-xs">
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Customer</span><span className="font-semibold text-right">{lastSale.customerName ?? "Walk-in Customer"}</span></div>
              {lastSale.customer && <div className="flex justify-between gap-3"><span className="text-muted-foreground">Customer ID</span><span className="font-semibold font-mono text-right">{lastSale.customer.code}</span></div>}
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Date</span><span className="font-semibold text-right">{new Date(lastSale.createdAt).toLocaleString()}</span></div>
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Payment</span><span className="font-semibold text-right">{receiptExtras.walkIn
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
                  <p className="text-[11px] text-muted-foreground">
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

            <div className="text-center text-[9px] text-muted-foreground mt-2">
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
