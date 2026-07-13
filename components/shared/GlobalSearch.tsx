"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Search, Package, Receipt, Truck, LayoutDashboard, ArrowLeftRight,
  ShoppingCart, TrendingUp, Settings, Users, CornerDownLeft, X,
} from "lucide-react";
import { getProducts, getSales, getPurchaseOrders } from "@/app/actions";
import { formatNPR } from "@/lib/utils";

interface SearchResult {
  id: string;
  type: string;
  label: string;
  sub: string;
  href: string;
  icon: React.ComponentType<any>;
}

const PAGES: SearchResult[] = [
  { id: "p-dashboard", type: "Page", label: "Dashboard", sub: "Overview & stats", href: "/dashboard", icon: LayoutDashboard },
  { id: "p-products", type: "Page", label: "Products", sub: "Catalog management", href: "/products", icon: Package },
  { id: "p-inventory", type: "Page", label: "Inventory", sub: "Stock & movements", href: "/inventory", icon: ArrowLeftRight },
  { id: "p-sales", type: "Page", label: "POS & Sales", sub: "Checkout terminal", href: "/sales", icon: ShoppingCart },
  { id: "p-purchases", type: "Page", label: "Purchases", sub: "Purchase orders", href: "/purchases", icon: TrendingUp },
  { id: "p-customers", type: "Page", label: "Customers", sub: "Customers & orders", href: "/customers", icon: Users },
  { id: "p-settings", type: "Page", label: "Settings", sub: "Suppliers & warehouses", href: "/settings", icon: Settings },
];

function customerKey(sale: any) {
  return (sale.customerEmail || sale.customerPhone || sale.customerName || "unknown").toLowerCase();
}

// Shared search index + results logic, used by both the desktop inline bar
// and the mobile full-screen overlay so they never drift out of sync.
function useSearchIndex() {
  const [products, setProducts] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);

  async function loadIndex() {
    if (loaded) return;
    setLoaded(true);
    const [p, s, po] = await Promise.all([getProducts(), getSales(), getPurchaseOrders()]);
    setProducts(p);
    setSales(s);
    setPurchaseOrders(po);
  }

  function useResults(query: string) {
    return useMemo<SearchResult[]>(() => {
      const q = query.trim().toLowerCase();
      if (!q) return PAGES.slice(0, 6);

      const productResults: SearchResult[] = products
        .filter(p => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.barcode?.toLowerCase().includes(q))
        .slice(0, 5)
        .map(p => ({ id: `prod-${p.id}`, type: "Product", label: p.name, sub: p.sku, href: `/products?q=${encodeURIComponent(p.sku)}`, icon: Package }));

      const saleResults: SearchResult[] = sales
        .filter(s => s.invoiceNumber.toLowerCase().includes(q) || (s.customerName ?? "").toLowerCase().includes(q) || (s.customerPhone ?? "").toLowerCase().includes(q))
        .slice(0, 5)
        .map(s => ({ id: `sale-${s.id}`, type: "Invoice", label: s.invoiceNumber, sub: `${s.customerName ?? "Walk-in Customer"} · ${formatNPR(s.totalAmount)}`, href: `/customers/${encodeURIComponent(customerKey(s))}`, icon: Receipt }));

      const poResults: SearchResult[] = purchaseOrders
        .filter(po => po.orderNumber.toLowerCase().includes(q) || po.supplier?.companyName?.toLowerCase().includes(q))
        .slice(0, 5)
        .map(po => ({ id: `po-${po.id}`, type: "Purchase Order", label: po.orderNumber, sub: po.supplier?.companyName ?? "—", href: `/purchases?q=${encodeURIComponent(po.orderNumber)}`, icon: Truck }));

      const pageResults: SearchResult[] = PAGES.filter(p => p.label.toLowerCase().includes(q));

      return [...productResults, ...saleResults, ...poResults, ...pageResults].slice(0, 12);
    }, [query, products, sales, purchaseOrders]);
  }

  return { loadIndex, useResults };
}

function groupResults(results: SearchResult[]) {
  const order = ["Product", "Invoice", "Purchase Order", "Page"];
  return order
    .map(type => ({ type, items: results.filter(r => r.type === type) }))
    .filter(g => g.items.length > 0);
}

function ResultsList({
  results,
  activeIdx,
  setActiveIdx,
  onSelect,
  emptyQuery,
}: {
  results: SearchResult[];
  activeIdx: number;
  setActiveIdx: (i: number) => void;
  onSelect: (r: SearchResult) => void;
  emptyQuery: string;
}) {
  const groups = groupResults(results);

  if (results.length === 0) {
    return (
      <div className="px-6 py-12 text-center">
        <div className="w-12 h-12 rounded-full bg-muted/30 mx-auto mb-3 flex items-center justify-center">
          <Search className="text-muted-foreground/40" size={24} />
        </div>
        <p className="text-sm text-muted-foreground">No results for <span className="font-semibold text-foreground">"{emptyQuery}"</span></p>
        <p className="text-xs text-muted-foreground/60 mt-1">Try searching for products, orders, or pages</p>
      </div>
    );
  }

  return (
    <>
      {groups.map(group => (
        <div key={group.type} className="py-2">
          <p className="px-6 pt-3 pb-2 text-xs font-bold uppercase tracking-widest text-primary/60">{group.type}</p>
          {group.items.map(item => {
            const idx = results.indexOf(item);
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onMouseDown={() => onSelect(item)}
                onMouseEnter={() => setActiveIdx(idx)}
                className={`w-full flex items-center gap-3 px-5 py-3.5 mx-2 rounded-xl text-left transition-all cursor-pointer ${idx === activeIdx ? "bg-gradient-to-r from-primary/20 to-primary/10 border border-primary/30 shadow-md" : "hover:bg-muted/50"}`}
              >
                <div className={`p-2 rounded-lg shrink-0 ${idx === activeIdx ? "bg-primary/20" : "bg-muted/30"}`}>
                  <Icon size={16} className={`${idx === activeIdx ? "text-primary" : "text-muted-foreground/60"}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate text-foreground">{item.label}</p>
                  <p className="text-xs text-muted-foreground/70 truncate">{item.sub}</p>
                </div>
                {idx === activeIdx && <CornerDownLeft size={16} className="text-primary shrink-0" />}
              </button>
            );
          })}
        </div>
      ))}
    </>
  );
}

export function GlobalSearch() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);
  const { loadIndex, useResults } = useSearchIndex();

  // Desktop inline bar state
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const results = useResults(query);

  // Mobile full-screen overlay state
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileQuery, setMobileQuery] = useState("");
  const [mobileActiveIdx, setMobileActiveIdx] = useState(0);
  const mobileResults = useResults(mobileQuery);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => { setActiveIdx(0); }, [results]);
  useEffect(() => { setMobileActiveIdx(0); }, [mobileResults]);

  useEffect(() => {
    if (mobileOpen) {
      loadIndex();
      mobileInputRef.current?.focus();
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobileOpen]);

  function select(result: SearchResult) {
    router.push(result.href);
    setOpen(false);
    setQuery("");
    setMobileOpen(false);
    setMobileQuery("");
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[activeIdx]) select(results[activeIdx]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  function onMobileKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setMobileActiveIdx(i => Math.min(i + 1, mobileResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setMobileActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (mobileResults[mobileActiveIdx]) select(mobileResults[mobileActiveIdx]);
    } else if (e.key === "Escape") {
      setMobileOpen(false);
    }
  }

  return (
    <>
      {/* Mobile: icon-only trigger that opens a full-screen search overlay */}
      <button
        onClick={() => setMobileOpen(true)}
        aria-label="Search"
        className="md:hidden flex items-center justify-center w-10 h-10 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors border border-border shrink-0"
      >
        <Search size={17} strokeWidth={2.25} />
      </button>

      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-[60] bg-background flex flex-col">
          <div className="flex items-center gap-2 p-3 border-b border-border shrink-0">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-primary/70" size={18} strokeWidth={2.5} />
              <input
                ref={mobileInputRef}
                type="text"
                inputMode="search"
                value={mobileQuery}
                onChange={e => setMobileQuery(e.target.value)}
                onKeyDown={onMobileKeyDown}
                placeholder="Search products, invoices, orders…"
                className="w-full pl-10 pr-3 py-3 rounded-2xl border-2 border-primary/20 bg-muted/20 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 text-base font-medium text-foreground placeholder:text-muted-foreground/50"
              />
            </div>
            <button
              onClick={() => setMobileOpen(false)}
              aria-label="Close search"
              className="flex items-center justify-center w-11 h-11 rounded-xl hover:bg-muted text-muted-foreground shrink-0"
            >
              <X size={20} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain">
            <ResultsList
              results={mobileResults}
              activeIdx={mobileActiveIdx}
              setActiveIdx={setMobileActiveIdx}
              onSelect={select}
              emptyQuery={mobileQuery}
            />
          </div>
        </div>
      )}

      {/* Desktop: inline search bar with dropdown results */}
      <div ref={containerRef} className="relative w-146 hidden md:block">
        <Search className="absolute left-8 top-1/2 -translate-y-1/2 text-primary/70 z-10" size={18} strokeWidth={2.5} />
        <input
          type="text"
          value={query}
          onFocus={() => { setOpen(true); loadIndex(); }}
          onChange={e => { setQuery(e.target.value); setOpen(true); loadIndex(); }}
          onKeyDown={onKeyDown}
          placeholder="Search products, invoices, orders…"
          className="relative pl-10 w-full ml-4 py-2.5 rounded-2xl border-2 border-primary/20 bg-gradient-to-br from-white via-white/95 to-white/90 dark:from-black/40 dark:via-black/30 dark:to-black/20 focus:bg-white dark:focus:bg-black/50 focus:outline-none focus:ring- focus:ring-primary/60 focus:border-primary/50 text-sm font-medium text-foreground placeholder:text-muted-foreground/50 transition-all duration-200 shadow-lg hover:shadow-xl hover:border-primary/30 focus:shadow-2xl"
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-muted-foreground/60 bg-muted/40 px-2 py-1 rounded-md pointer-events-none hidden sm:block">
          ⌘K
        </div>

        {open && (
          <div className="absolute top-full left-0 mt-3 w-full max-h-96 overflow-y-auto bg-gradient-to-b from-white to-white/95 dark:from-black/50 dark:to-black/30 border border-primary/20 rounded-2xl shadow-2xl z-50 backdrop-blur-lg">
            <ResultsList
              results={results}
              activeIdx={activeIdx}
              setActiveIdx={setActiveIdx}
              onSelect={select}
              emptyQuery={query}
            />
          </div>
        )}
      </div>
    </>
  );
}
