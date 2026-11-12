"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  Search, Package, Receipt, Truck, LayoutDashboard, ArrowLeftRight,
  ShoppingCart, TrendingUp, Settings, Users, User, CornerDownLeft, X, type LucideIcon,
} from "lucide-react";
import { cn, formatNPR } from "@/lib/utils";
import { Popover } from "@/components/shared/Popover";
import { customerKey, groupSalesByCustomer } from "@/lib/orders";
import { parseCustomerCode } from "@/lib/customerIdentity";
import { resources } from "@/lib/resources";
import { readResource } from "@/lib/useResources";
import type { Product, PurchaseOrder, Sale } from "@/lib/types";

interface SearchResult {
  id: string;
  type: string;
  label: string;
  sub: string;
  href: string;
  icon: LucideIcon;
}

interface SearchIndex {
  products: Product[];
  sales: Sale[];
  orders: PurchaseOrder[];
}

const PAGES: SearchResult[] = [
  { id: "p-dashboard", type: "Page", label: "Dashboard", sub: "Overview & stats", href: "/dashboard", icon: LayoutDashboard },
  { id: "p-products", type: "Page", label: "Products", sub: "Catalog management", href: "/products", icon: Package },
  { id: "p-inventory", type: "Page", label: "Inventory", sub: "Stock & movements", href: "/inventory", icon: ArrowLeftRight },
  { id: "p-sales", type: "Page", label: "POS & Sales", sub: "Checkout terminal", href: "/sales", icon: ShoppingCart },
  { id: "p-purchases", type: "Page", label: "Purchases", sub: "Purchase orders", href: "/purchases", icon: TrendingUp },
  { id: "p-customers", type: "Page", label: "Customers", sub: "Customers & orders", href: "/customers", icon: Users },
  { id: "p-settings", type: "Page", label: "Settings", sub: "Store & suppliers", href: "/settings", icon: Settings },
];

const EMPTY_INDEX: SearchIndex = { products: [], sales: [], orders: [] };
const GROUP_ORDER = ["Customer", "Product", "Invoice", "Purchase Order", "Page"];

// A barcode scanner types far faster than a person, then presses Enter.
const SCANNER_MAX_KEY_GAP_MS = 60;

function useSearchResults(query: string, index: SearchIndex) {
  const customers = useMemo(() => groupSalesByCustomer(index.sales), [index.sales]);

  return useMemo<SearchResult[]>(() => {
    const q = (parseCustomerCode(query) ?? query.trim()).toLowerCase();
    if (!q) return PAGES.slice(0, 6);

    const customerResults: SearchResult[] = customers
      .filter(c => c.code?.toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || c.phone?.toLowerCase().includes(q))
      .slice(0, 5)
      .map(c => ({ id: `cust-${c.key}`, type: "Customer", label: c.name, sub: [c.code, c.phone].filter(Boolean).join(" · "), href: `/customers/${encodeURIComponent(c.key)}`, icon: User }));

    const productResults: SearchResult[] = index.products
      .filter(p => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.barcode?.toLowerCase().includes(q))
      .slice(0, 5)
      .map(p => ({ id: `prod-${p.id}`, type: "Product", label: p.name, sub: p.sku, href: `/products?q=${encodeURIComponent(p.sku)}`, icon: Package }));

    const saleResults: SearchResult[] = index.sales
      .filter(s => s.invoiceNumber.toLowerCase().includes(q) || (s.customerName ?? "").toLowerCase().includes(q) || (s.customerPhone ?? "").toLowerCase().includes(q))
      .slice(0, 5)
      .map(s => ({ id: `sale-${s.id}`, type: "Invoice", label: s.invoiceNumber, sub: `${s.customerName ?? "Walk-in Customer"} · ${formatNPR(s.totalAmount)}`, href: `/customers/${encodeURIComponent(customerKey(s))}`, icon: Receipt }));

    const poResults: SearchResult[] = index.orders
      .filter(po => po.orderNumber.toLowerCase().includes(q) || po.supplier.companyName.toLowerCase().includes(q))
      .slice(0, 5)
      .map(po => ({ id: `po-${po.id}`, type: "Purchase Order", label: po.orderNumber, sub: po.supplier.companyName, href: `/purchases?q=${encodeURIComponent(po.orderNumber)}`, icon: Truck }));

    const pageResults = PAGES.filter(p => p.label.toLowerCase().includes(q));

    // Grouped order, so arrow keys walk the list in the order it's displayed.
    return [...customerResults, ...productResults, ...saleResults, ...poResults, ...pageResults].slice(0, 12);
  }, [query, index, customers]);
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
  if (results.length === 0) {
    return (
      <div className="px-6 py-10 text-center">
        <div className="w-11 h-11 rounded-full bg-muted mx-auto mb-3 flex items-center justify-center">
          <Search className="text-muted-foreground/50" size={20} />
        </div>
        <p className="text-sm text-muted-foreground">No results for <span className="font-semibold text-foreground">&ldquo;{emptyQuery}&rdquo;</span></p>
        <p className="text-xs text-muted-foreground mt-1">Try a customer ID, name, phone, product or invoice</p>
      </div>
    );
  }

  return (
    <div className="p-2">
      {GROUP_ORDER.map(type => {
        const items = results.filter(r => r.type === type);
        if (items.length === 0) return null;
        return (
          <div key={type} className="pb-1">
            <p className="px-3 pt-2 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{type}</p>
            {items.map(item => {
              const idx = results.indexOf(item);
              const Icon = item.icon;
              const active = idx === activeIdx;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item)}
                  onMouseMove={() => { if (!active) setActiveIdx(idx); }}
                  className={cn("w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left", active ? "bg-primary/10" : "hover:bg-muted/60")}
                >
                  <span className={cn("p-1.5 rounded-lg shrink-0", active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold truncate text-foreground">{item.label}</span>
                    <span className="block text-xs text-muted-foreground truncate">{item.sub}</span>
                  </span>
                  {active && <CornerDownLeft size={14} className="text-primary shrink-0" />}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

const subscribeNothing = () => () => {};
const isApplePlatform = () => /mac|iphone|ipad/i.test(navigator.platform);

export function GlobalSearch() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);
  const [index, setIndex] = useState<SearchIndex>(EMPTY_INDEX);
  const shortcutIsCmd = useSyncExternalStore(subscribeNothing, isApplePlatform, () => false);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const results = useSearchResults(query, index);

  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileQuery, setMobileQuery] = useState("");
  const [mobileActiveIdx, setMobileActiveIdx] = useState(0);
  const mobileResults = useSearchResults(mobileQuery, index);

  // Reads through the shared cache, so this is usually instant, and reloading
  // on each open means newly added records are searchable.
  const loadIndex = useCallback(() => {
    Promise.all([
      readResource(resources.products),
      readResource(resources.sales),
      readResource(resources.orders),
    ])
      .then(([products, sales, orders]) => setIndex({ products, sales, orders }))
      .catch(err => console.error("Failed to load search index", err));
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    loadIndex();
    mobileInputRef.current?.focus();
  }, [mobileOpen, loadIndex]);

  useEffect(() => {
    function onShortcut(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      if (window.matchMedia("(min-width: 768px)").matches) inputRef.current?.focus();
      else setMobileOpen(true);
    }
    document.addEventListener("keydown", onShortcut);
    return () => document.removeEventListener("keydown", onShortcut);
  }, []);

  // Scanning a customer's label works from anywhere, without clicking into search first.
  useEffect(() => {
    let buffer = "";
    let lastKeyAt = 0;

    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']") || document.querySelector("[aria-modal='true']")) return;

      if (e.key === "Enter") {
        const code = parseCustomerCode(buffer);
        buffer = "";
        if (code) {
          e.preventDefault();
          router.push(`/customers/${code}`);
        }
        return;
      }
      if (e.key.length !== 1) return;
      if (e.timeStamp - lastKeyAt > SCANNER_MAX_KEY_GAP_MS) buffer = "";
      buffer += e.key;
      lastKeyAt = e.timeStamp;
    }

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router]);

  function select(result: SearchResult) {
    router.push(result.href);
    setOpen(false);
    setQuery("");
    setMobileOpen(false);
    setMobileQuery("");
    inputRef.current?.blur();
  }

  function navigateList(
    e: React.KeyboardEvent,
    list: SearchResult[],
    active: number,
    setActive: React.Dispatch<React.SetStateAction<number>>,
  ) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(i => Math.min(i + 1, list.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      // A scanned ID opens directly, even if the search index is still loading.
      const code = parseCustomerCode((e.target as HTMLInputElement).value);
      if (code) select({ ...PAGES[0], href: `/customers/${code}` });
      else if (list[active]) select(list[active]);
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
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Search"
          className="md:hidden fixed inset-0 z-[900] bg-background flex flex-col animate-fade-in"
        >
          <div className="flex items-center gap-2 p-3 border-b border-border shrink-0" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-primary/70" size={18} strokeWidth={2.5} />
              <input
                ref={mobileInputRef}
                type="text"
                inputMode="search"
                value={mobileQuery}
                onChange={e => { setMobileQuery(e.target.value); setMobileActiveIdx(0); }}
                onKeyDown={e => {
                  if (e.key === "Escape") setMobileOpen(false);
                  else navigateList(e, mobileResults, mobileActiveIdx, setMobileActiveIdx);
                }}
                placeholder="Search customers, products, invoices…"
                aria-label="Search customers, products, invoices and orders"
                className="w-full pl-10 pr-3 py-3 rounded-2xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/30 text-base font-medium text-foreground placeholder:text-muted-foreground/60"
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
      <div ref={containerRef} className="relative hidden md:block flex-1 min-w-0 max-w-xl mx-4">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground z-10" size={16} strokeWidth={2.25} />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onFocus={() => { setOpen(true); loadIndex(); }}
          onClick={() => setOpen(true)}
          onChange={e => { setQuery(e.target.value); setActiveIdx(0); setOpen(true); }}
          onKeyDown={e => {
            if (e.key === "Tab") setOpen(false);
            navigateList(e, results, activeIdx, setActiveIdx);
          }}
          placeholder="Search customers, products, invoices…"
          aria-label="Search customers, products, invoices and orders"
          className="w-full pl-10 pr-16 py-2.5 rounded-xl border border-border bg-background focus:bg-card focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary/40 text-sm font-medium text-foreground placeholder:text-muted-foreground/60"
        />
        <kbd className="absolute right-3 top-1/2 -translate-y-1/2 font-sans text-[10px] font-semibold text-muted-foreground bg-muted px-1.5 py-0.5 rounded pointer-events-none">
          {shortcutIsCmd ? "⌘K" : "Ctrl K"}
        </kbd>

        <Popover
          open={open}
          onClose={() => setOpen(false)}
          anchorRef={containerRef}
          matchAnchorWidth
          className="max-h-96 bg-popover text-popover-foreground border border-border rounded-2xl shadow-xl"
        >
          <ResultsList
            results={results}
            activeIdx={activeIdx}
            setActiveIdx={setActiveIdx}
            onSelect={select}
            emptyQuery={query}
          />
        </Popover>
      </div>
    </>
  );
}
