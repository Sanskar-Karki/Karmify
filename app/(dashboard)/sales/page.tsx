"use client";

import { Skeleton } from "boneyard-js/react";
import { SalesFixture } from "@/components/skeletons/fixtures";
import React, { useState, useEffect, useRef } from "react";
import {
  ShoppingCart, Search, Plus, Minus, X,
  CheckCircle, User, Phone, MapPin, Percent, Receipt, Package, QrCode, Truck
} from "lucide-react";
import {
  createSale,
} from "@/app/actions";
import { cn, formatNPR } from "@/lib/utils";
import { Pulse } from "@/components/shared/Pulse";
import { useResources } from "@/lib/useResources";
import { resources } from "@/lib/resources";

interface CartItem {
  productId: string;
  name: string;
  sku: string;
  unitPrice: number;
  quantity: number;
  maxQty: number;
}

export default function SalesPage() {
  const { products, categories, stocks, sales, loading, refetch } = useResources({
    products: resources.activeProducts,
    categories: resources.categories,
    stocks: resources.stocks,
    sales: resources.sales,
  });

  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");

  const [cart, setCart] = useState<CartItem[]>([]);
  const [customer, setCustomer] = useState({ name: "", address: "", phone: "" });
  const [discount, setDiscount] = useState(0);
  const [deliveryAmount, setDeliveryAmount] = useState(0);
  const [codAmount, setCodAmount] = useState("0");
  const [codTouched, setCodTouched] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"COD" | "QR">("COD");

  const [showReceipt, setShowReceipt] = useState(false);
  const [lastSale, setLastSale] = useState<any | null>(null);

  function getStock(productId: string) {
    return stocks.filter(s => s.productId === productId).reduce((a, s) => a + s.quantity, 0);
  }

  const filteredProducts = products.filter(p => {
    const matchCat = catFilter === "all" || p.categoryId === catFilter;
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  function addToCart(p: any) {
    const avail = getStock(p.id);
    if (avail <= 0) return;
    setCart(prev => {
      const existing = prev.find(c => c.productId === p.id);
      if (existing) {
        if (existing.quantity >= avail) return prev;
        return prev.map(c => c.productId === p.id ? { ...c, quantity: c.quantity + 1 } : c);
      }
      return [...prev, { productId: p.id, name: p.name, sku: p.sku, unitPrice: p.sellingPrice, quantity: 1, maxQty: avail }];
    });
  }

  function updateQty(productId: string, delta: number) {
    setCart(prev => prev.map(c => {
      if (c.productId !== productId) return c;
      const newQty = Math.max(1, Math.min(c.quantity + delta, c.maxQty));
      return { ...c, quantity: newQty };
    }));
  }

  function removeFromCart(productId: string) {
    setCart(prev => prev.filter(c => c.productId !== productId));
  }

  const subtotal = cart.reduce((a, c) => a + c.unitPrice * c.quantity, 0);
  const discountAmount = Math.min((subtotal * discount) / 100, subtotal);
  const total = subtotal - discountAmount;
  const defaultCodAmount = total + deliveryAmount;

  // Cash-on-delivery amount defaults to product total + delivery charge,
  // but stays editable in case the courier needs to collect a different amount.
  useEffect(() => {
    if (!codTouched) setCodAmount(defaultCodAmount.toFixed(2));
  }, [defaultCodAmount, codTouched]);

  async function handleCheckout() {
    if (cart.length === 0) return;

    const newSale = await createSale({
      customerName: customer.name || undefined,
      customerPhone: customer.phone || undefined,
      customerAddress: customer.address || undefined,
      items: cart.map(c => ({ productId: c.productId, quantity: c.quantity, unitPrice: c.unitPrice })),
      discount: discountAmount,
      deliveryAmount,
      codAmount: parseFloat(codAmount) || 0,
      totalAmount: total,
      paymentMethod,
    });

    setLastSale(newSale);
    setShowReceipt(true);
    setCart([]);
    setCustomer({ name: "", address: "", phone: "" });
    setDiscount(0);
    setDeliveryAmount(0);
    setCodAmount("0");
    setCodTouched(false);
    setPaymentMethod("COD");
    await refetch();
  }

  return (
    <Skeleton name="sales" loading={false} fixture={<SalesFixture />} fallback={<SalesFixture />}>
      <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">POS & Sales Terminal</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Checkout counter & live billing station</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* LEFT: Product Catalog */}
        <div className="lg:col-span-7 space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products..." className="w-full pl-8 pr-3 py-2.5 text-sm rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
            <select value={catFilter} onChange={e => setCatFilter(e.target.value)} className="px-3 py-2.5 text-sm rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer">
              <option value="all">All</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {loading && Array.from({ length: 6 }).map((_, i) => <Pulse key={i} className="h-32 w-full" />)}
            {!loading && filteredProducts.map(p => {
              const avail = getStock(p.id);
              const inCart = cart.find(c => c.productId === p.id)?.quantity ?? 0;
              const exhausted = avail <= 0;
              return (
                <button key={p.id} onClick={() => addToCart(p)} disabled={exhausted} className={cn("relative flex flex-col items-start gap-2 p-4 bg-card border rounded-2xl text-left transition-all cursor-pointer group", exhausted ? "opacity-50 cursor-not-allowed border-border/40" : "border-border/80 hover:border-primary/40 hover:shadow-md hover:shadow-primary/5 hover:scale-[1.01]")}>
                  {inCart > 0 && (
                    <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-primary text-primary-foreground text-[9px] font-extrabold flex items-center justify-center">{inCart}</span>
                  )}
                  <div className="w-10 h-10 rounded-xl bg-primary/10 border border-border/40 flex items-center justify-center">
                    <Package size={18} className="text-primary/70" />
                  </div>
                  <div className="min-w-0 w-full">
                    <p className="text-xs font-bold text-foreground line-clamp-2 leading-tight">{p.name}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">{p.sku}</p>
                  </div>
                  <div className="flex items-end justify-between w-full mt-auto">
                    <p className="text-sm font-extrabold text-primary">{formatNPR(p.sellingPrice)}</p>
                    <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded", avail <= p.minStockLevel ? "bg-amber-100 dark:bg-amber-950/30 text-amber-600" : "bg-emerald-100 dark:bg-emerald-950/30 text-emerald-600")}>
                      {avail} left
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* RIGHT: Cart & Checkout */}
        <div className="lg:col-span-5 sticky top-6 space-y-3">
          <div className="bg-card border border-border/80 rounded-2xl shadow-sm overflow-hidden">
            {/* Cart Header */}
            <div className="p-4 border-b border-border/60 flex items-center justify-between">
              <h2 className="font-bold flex items-center gap-2 text-sm"><ShoppingCart size={15} className="text-primary" />Cart ({cart.reduce((a, c) => a + c.quantity, 0)} items)</h2>
              {cart.length > 0 && <button onClick={() => setCart([])} className="text-[10px] text-red-500 font-semibold hover:underline cursor-pointer">Clear All</button>}
            </div>

            {/* Cart Items */}
            <div className="divide-y divide-border/30 max-h-64 overflow-y-auto">
              {cart.length === 0 ? (
                <div className="flex flex-col items-center py-10 text-center text-muted-foreground gap-2">
                  <ShoppingCart size={28} className="opacity-30" />
                  <p className="text-xs font-semibold">Cart is empty</p>
                  <p className="text-[10px]">Click products on the left to add them.</p>
                </div>
              ) : (
                cart.map(item => (
                  <div key={item.productId} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate">{item.name}</p>
                      <p className="text-[10px] text-muted-foreground">{formatNPR(item.unitPrice)} ea.</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button onClick={() => updateQty(item.productId, -1)} className="w-6 h-6 rounded-lg bg-muted flex items-center justify-center hover:bg-muted/70 cursor-pointer"><Minus size={10} /></button>
                      <span className="w-6 text-center text-xs font-bold">{item.quantity}</span>
                      <button onClick={() => updateQty(item.productId, 1)} className="w-6 h-6 rounded-lg bg-muted flex items-center justify-center hover:bg-muted/70 cursor-pointer"><Plus size={10} /></button>
                    </div>
                    <span className="text-xs font-bold w-16 text-right">{formatNPR(item.unitPrice * item.quantity)}</span>
                    <button onClick={() => removeFromCart(item.productId)} className="w-5 h-5 rounded flex items-center justify-center text-muted-foreground hover:text-red-500 cursor-pointer"><X size={12} /></button>
                  </div>
                ))
              )}
            </div>

            {/* Customer + Billing */}
            <div className="p-4 border-t border-border/60 space-y-2.5">
              <div className="grid grid-cols-1 gap-2.5">
                {[
                  { label: "Customer Name", icon: User, key: "name", placeholder: "e.g. Kshitiz Adhikari" },
                  { label: "Phone", icon: Phone, key: "phone", placeholder: "+977 9841..." },
                  { label: "Address", icon: MapPin, key: "address", placeholder: "Delivery address" },
                ].map(field => (
                  <div key={field.key} className="relative">
                    <field.icon size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input value={(customer as any)[field.key]} onChange={e => setCustomer(c => ({ ...c, [field.key]: e.target.value }))} placeholder={field.placeholder} className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20" />
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="relative">
                  <Percent size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input type="number" min={0} max={100} value={discount} onChange={e => setDiscount(Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)))} placeholder="Discount %" className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20" />
                </div>
                <div className="relative">
                  <Truck size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input type="number" min={0} step="0.01" value={deliveryAmount} onChange={e => setDeliveryAmount(Math.max(0, parseFloat(e.target.value) || 0))} placeholder="Delivery Amt" className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20" />
                </div>
                <div className="relative">
                  <Receipt size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={codAmount}
                    onChange={e => { setCodTouched(true); setCodAmount(e.target.value); }}
                    placeholder="COD Amount"
                    title="Cash the customer pays on delivery — defaults to total + delivery, but can be overridden"
                    className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>

              {/* Payment Method */}
              <div className="flex items-center gap-2">
                <button onClick={() => setPaymentMethod("COD")} className={cn("flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border transition-all cursor-pointer", paymentMethod === "COD" ? "bg-primary/10 border-primary/30 text-primary" : "bg-muted border-border text-muted-foreground")}>
                  <Truck size={12} /> Cash on Delivery
                </button>
                <button onClick={() => setPaymentMethod("QR")} className={cn("flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border transition-all cursor-pointer", paymentMethod === "QR" ? "bg-primary/10 border-primary/30 text-primary" : "bg-muted border-border text-muted-foreground")}>
                  <QrCode size={12} /> QR Payment
                </button>
              </div>

              {/* Billing Summary */}
              <div className="bg-muted/30 rounded-xl p-3 space-y-1.5 text-xs">
                <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span>{formatNPR(subtotal)}</span></div>
                {discount > 0 && <div className="flex justify-between text-emerald-600"><span>Discount ({discount}%)</span><span>−{formatNPR(discountAmount)}</span></div>}
                {deliveryAmount > 0 && <div className="flex justify-between text-muted-foreground"><span>Delivery</span><span>{formatNPR(deliveryAmount)}</span></div>}
                <div className="flex justify-between font-extrabold text-base text-foreground pt-1 border-t border-border/60"><span>Total</span><span>{formatNPR(total)}</span></div>
                <div className="flex justify-between font-bold text-primary"><span>COD to Collect</span><span>{formatNPR(parseFloat(codAmount) || 0)}</span></div>
              </div>

              <button onClick={handleCheckout} disabled={cart.length === 0} className="w-full py-3 bg-primary text-primary-foreground text-sm font-bold rounded-xl shadow-md shadow-primary/20 hover:bg-primary/90 hover:scale-[1.01] transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2">
                <Receipt size={15} />
                Complete Sale & Generate Invoice
              </button>
            </div>
          </div>

          {/* Recent Sales Mini-Feed */}
          <div className="bg-card border border-border/80 rounded-2xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-border/60">
              <h3 className="font-bold text-sm">Recent Transactions</h3>
            </div>
            <div className="divide-y divide-border/30 max-h-56 overflow-y-auto">
              {loading && Array.from({ length: 3 }).map((_, i) => <Pulse key={i} className="h-12 w-full" />)}
              {!loading && sales.slice(0, 8).map(s => (
                <div key={s.id} className="flex items-center justify-between px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-foreground">{s.invoiceNumber}</p>
                    <p className="text-[10px] text-muted-foreground">{s.customerName ?? "Walk-in"} · {new Date(s.createdAt).toLocaleDateString()}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-extrabold">{formatNPR(s.totalAmount)}</p>
                    <span className="text-[9px] bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 font-bold px-1.5 py-0.5 rounded">{s.paymentStatus}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Receipt Modal */}
      {showReceipt && lastSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-zinc-900 border border-border rounded-2xl shadow-2xl w-full max-w-sm max-h-[90vh] overflow-y-auto">
            <div className="p-6 space-y-3">
              <div className="text-center space-y-1">
                <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-950/30 flex items-center justify-center mx-auto mb-2">
                  <CheckCircle size={24} className="text-emerald-500" />
                </div>
                <h2 className="text-lg font-extrabold">Sale Completed!</h2>
                <p className="text-xs text-muted-foreground font-mono">{lastSale.invoiceNumber}</p>
              </div>

              <div className="border-t border-dashed border-border/60 pt-4 space-y-2 text-sm">
                <div className="flex justify-between text-xs"><span className="text-muted-foreground">Customer</span><span className="font-semibold">{lastSale.customerName ?? "Walk-in Customer"}</span></div>
                <div className="flex justify-between text-xs"><span className="text-muted-foreground">Date</span><span className="font-semibold">{new Date(lastSale.createdAt).toLocaleString()}</span></div>
                <div className="flex justify-between text-xs"><span className="text-muted-foreground">Payment</span><span className="font-semibold">{lastSale.paymentMethod === "QR" ? "QR Payment" : "Cash on Delivery"}</span></div>
              </div>

              <div className="border-t border-dashed border-border/60 pt-4 space-y-1.5">
                {lastSale.items.map((item: any, i: number) => (
                  <div key={i} className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{item.product?.name ?? "—"} × {item.quantity}</span>
                    <span className="font-semibold">{formatNPR(item.unitPrice * item.quantity)}</span>
                  </div>
                ))}
              </div>

              <div className="border-t border-dashed border-border/60 pt-4 space-y-1.5 text-xs">
                {lastSale.discount > 0 && <div className="flex justify-between text-emerald-600"><span>Discount</span><span>−{formatNPR(lastSale.discount)}</span></div>}
                <div className="flex justify-between font-extrabold text-base text-foreground pt-1 border-t border-border/60"><span>TOTAL</span><span>{formatNPR(lastSale.totalAmount)}</span></div>
              </div>

              <div className="text-center text-[9px] text-muted-foreground mt-2">
                Thank you for shopping at Karmify!
              </div>

              <button onClick={() => setShowReceipt(false)} className="w-full py-2.5 bg-primary text-primary-foreground text-sm font-bold rounded-xl hover:bg-primary/90 transition-all cursor-pointer">
                Done
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </Skeleton>
  );
}

