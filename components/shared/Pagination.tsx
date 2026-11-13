"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Dropdown } from "@/components/shared/Dropdown";
import { cn } from "@/lib/utils";

export const PAGE_SIZES = [10, 20, 50, 100];
const DEFAULT_SIZE = 20;

// The chosen page size is remembered per table in this browser (localStorage).
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}
function readSize(key: string) {
  try {
    const n = Number(localStorage.getItem(`karmify_page_size_${key}`));
    return PAGE_SIZES.includes(n) ? n : DEFAULT_SIZE;
  } catch {
    return DEFAULT_SIZE;
  }
}
function writeSize(key: string, size: number) {
  try {
    localStorage.setItem(`karmify_page_size_${key}`, String(size));
  } catch {
    // Storage blocked: the size still applies until the page is left.
  }
  listeners.forEach(listener => listener());
}

/**
 * Splits a list into pages. Going back to page 1 happens on its own whenever
 * the list changes (a new search or filter), so a filter never lands on an
 * empty page.
 */
export function usePagination<T>(items: T[], storageKey: string) {
  const storedSize = useSyncExternalStore(subscribe, () => readSize(storageKey), () => DEFAULT_SIZE);
  const [sizeOverride, setSizeOverride] = useState<number | null>(null);
  const pageSize = sizeOverride ?? storedSize;
  const [page, setPage] = useState(1);
  const [lastItems, setLastItems] = useState(items);
  if (items !== lastItems) {
    setLastItems(items);
    setPage(1);
  }

  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pageCount);
  const offset = (current - 1) * pageSize;
  const visible = useMemo(() => items.slice(offset, offset + pageSize), [items, offset, pageSize]);

  return {
    visible,
    offset,
    page: current,
    pageCount,
    pageSize,
    total: items.length,
    setPage: (p: number) => setPage(Math.min(Math.max(1, p), pageCount)),
    setPageSize: (size: number) => {
      setSizeOverride(size);
      writeSize(storageKey, size);
      setPage(1);
    },
  };
}

/** Page numbers to show: always the first and last, the current one and its neighbours. */
function pageList(page: number, count: number): (number | "gap")[] {
  const wanted = new Set([1, count, page - 1, page, page + 1].filter(p => p >= 1 && p <= count));
  if (page <= 3) [2, 3, 4].forEach(p => p <= count && wanted.add(p));
  if (page >= count - 2) [count - 1, count - 2, count - 3].forEach(p => p >= 1 && wanted.add(p));
  const sorted = [...wanted].sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push("gap");
    out.push(p);
  });
  return out;
}

export function Pagination({
  page,
  pageCount,
  pageSize,
  total,
  offset,
  onPage,
  onPageSize,
  noun = "orders",
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  offset: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  noun?: string;
}) {
  if (total === 0) return null;
  const nav = "flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-xs font-semibold transition-colors";
  return (
    <div className="flex flex-col gap-2 border-t border-border/60 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="tabular-nums">
          <span className="font-semibold text-foreground">{offset + 1}–{Math.min(offset + pageSize, total)}</span> of{" "}
          <span className="font-semibold text-foreground">{total.toLocaleString()}</span> {noun}
        </span>
        <span className="hidden h-4 w-px bg-border sm:block" />
        <div className="flex items-center gap-1.5">
          <span className="whitespace-nowrap">Per page</span>
          <Dropdown
            aria-label={`${noun[0].toUpperCase()}${noun.slice(1)} per page`}
            value={String(pageSize)}
            onChange={v => onPageSize(Number(v))}
            options={PAGE_SIZES.map(n => ({ value: String(n), label: String(n) }))}
            className="w-20"
            triggerClassName="py-1 text-xs"
          />
        </div>
      </div>

      {pageCount > 1 && (
        <nav aria-label="Pages" className="flex items-center gap-1">
          <button type="button" onClick={() => onPage(page - 1)} disabled={page === 1} aria-label="Previous page" className={cn(nav, "border border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent")}>
            <ChevronLeft size={14} />
          </button>
          {pageList(page, pageCount).map((p, i) =>
            p === "gap" ? (
              <span key={`gap-${i}`} className="px-1 text-xs text-muted-foreground">…</span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => onPage(p)}
                aria-current={p === page ? "page" : undefined}
                className={cn(nav, "tabular-nums", p === page ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
              >
                {p}
              </button>
            )
          )}
          <button type="button" onClick={() => onPage(page + 1)} disabled={page === pageCount} aria-label="Next page" className={cn(nav, "border border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent")}>
            <ChevronRight size={14} />
          </button>
        </nav>
      )}
    </div>
  );
}
