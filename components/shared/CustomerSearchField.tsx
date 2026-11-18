"use client";

import React, { useId, useMemo, useState } from "react";
import { Search, User, X } from "lucide-react";
import { useResources } from "@/lib/useResources";
import { resources } from "@/lib/resources";
import { normalizePhone, parseCustomerCode } from "@/lib/customerIdentity";
import { cn } from "@/lib/utils";

/** A customer picked from the list, or just a typed name (code and phone null). */
export type PickedCustomer = { key: string | null; name: string; code: string | null; phone: string | null };

/** How a picked or typed customer is written into a note: "Asha Rai (CUS-000042)". */
export const customerNote = (c: PickedCustomer | null) =>
  c && c.name.trim() ? `${c.name.trim()}${c.code ? ` (${c.code})` : ""}` : "";

/**
 * Customers whose name has every typed word, or whose phone has the typed
 * digits (+977 or not), or whose customer ID is the one typed. At most `limit`.
 */
export function matchCustomers<C extends { name: string; code: string | null; phone: string | null }>(customers: C[], query: string, limit = 6): C[] {
  const text = query.trim().toLowerCase();
  if (!text) return [];
  const code = parseCustomerCode(query)?.toLowerCase();
  // Only digits typed: a phone (its +977 dropped, as saved phones are) or the number in a customer ID.
  const digits = /^[\d\s+()-]+$/.test(text) ? text.replace(/^(\+|00)977/, "").replace(/\D/g, "") : "";
  const words = text.split(/\s+/);
  return customers
    .filter(c => {
      if (code) return c.code?.toLowerCase() === code;
      if (digits.length >= 4) {
        const phone = normalizePhone(c.phone) ?? (c.phone ?? "").replace(/\D/g, "");
        return phone.includes(digits) || Boolean(c.code?.includes(digits));
      }
      const name = c.name.toLowerCase();
      return words.every(w => name.includes(w));
    })
    .slice(0, limit);
}

const field = "w-full rounded-lg border border-border/60 bg-background py-2 pl-8 pr-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40";

/**
 * Optional customer: type a name, phone or customer ID and pick from the
 * customers in Karmify. A name that matches no one is kept as typed.
 */
export function CustomerSearchField({ label, value, onChange }: {
  label: string;
  value: PickedCustomer | null;
  onChange: (customer: PickedCustomer | null) => void;
}) {
  const { customers, loading } = useResources({ customers: resources.customers });
  const id = useId();
  const listId = `${id}-list`;
  // The text in the box; a picked customer shows as a chip instead.
  const [query, setQuery] = useState(value && !value.key ? value.name : "");
  const [active, setActive] = useState(0);
  const picked = value?.key ? value : null;

  const matches = useMemo(() => matchCustomers(customers, query), [customers, query]);

  // Picking swaps the box for a chip and clearing swaps it back: keep the keyboard where it was.
  const [focusNext, setFocusNext] = useState<"chip" | "box" | null>(null);
  const focusOnMount = (target: "chip" | "box") => (el: HTMLElement | null) => {
    if (el && focusNext === target) {
      el.focus();
      setFocusNext(null);
    }
  };

  function type(text: string) {
    setQuery(text);
    setActive(0);
    onChange(text.trim() ? { key: null, name: text, code: null, phone: null } : null);
  }

  function pick(index: number) {
    const c = matches[index];
    if (!c) return;
    setQuery("");
    setFocusNext("chip");
    onChange({ key: c.key, name: c.name, code: c.code, phone: c.phone });
  }

  function clear() {
    setFocusNext("box");
    onChange(null);
  }

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-semibold text-muted-foreground">{label}</label>
      {picked ? (
        <div className="flex items-center gap-2.5 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2">
          <User size={14} className="shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-foreground">{picked.name}</span>
            <span className="block text-[11px] text-muted-foreground">{[picked.code, picked.phone].filter(Boolean).join(" · ") || "Customer"}</span>
          </span>
          <button
            id={id}
            ref={focusOnMount("chip")}
            type="button"
            onClick={clear}
            aria-label={`Remove ${picked.name}`}
            title="Choose someone else"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              id={id}
              ref={focusOnMount("box")}
              value={query}
              onChange={e => type(e.target.value)}
              onKeyDown={e => {
                if (matches.length === 0) return;
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive(i => (i + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  pick(active);
                }
              }}
              placeholder={loading ? "Loading customers…" : "Search name, phone or customer ID"}
              autoComplete="off"
              role="combobox"
              aria-expanded={matches.length > 0}
              aria-controls={listId}
              aria-activedescendant={matches.length > 0 ? `${listId}-${active}` : undefined}
              className={field}
            />
          </div>
          {query.trim() && !loading && (
            <ul id={listId} role="listbox" aria-label="Matching customers" className="overflow-hidden rounded-lg border border-border bg-card">
              {matches.length === 0 && (
                <li className="px-3 py-2 text-[12px] text-muted-foreground">No customer found. It&apos;s saved as typed.</li>
              )}
              {matches.map((c, i) => (
                <li
                  key={c.key}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  // Mouse down, not click: the pick happens before the box loses focus.
                  onMouseDown={e => { e.preventDefault(); pick(i); }}
                  onMouseEnter={() => setActive(i)}
                  className={cn("flex cursor-pointer items-center gap-2.5 px-3 py-2", i === active && "bg-primary/5")}
                >
                  <User size={13} className="shrink-0 text-primary/70" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{c.name}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{[c.code, c.phone].filter(Boolean).join(" · ")}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
