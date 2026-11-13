"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { Check, MapPin, Search, Truck, X } from "lucide-react";
import { searchCourierAreas, suggestCourierAreas } from "@/app/actions";
import { cn } from "@/lib/utils";
import type { CourierArea } from "@/lib/courier";

/**
 * Picks the Upaya hub location for a delivery: type an area and choose from the
 * dropdown (keyboard: ↑ ↓ Enter, Esc). Before anything is typed it suggests
 * locations named in the delivery address.
 */
export function UpayaHubPicker({
  value,
  onChange,
  address,
  invalid = false,
}: {
  value: CourierArea | null;
  onChange: (area: CourierArea | null) => void;
  /** The delivery address, used for suggestions. */
  address: string;
  invalid?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<CourierArea[]>([]);
  const [suggestions, setSuggestions] = useState<CourierArea[]>([]);
  const [searching, setSearching] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const latestSearch = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const typing = query.trim().length >= 2;
  const options = typing ? results : suggestions;

  // Search Upaya's hub locations as the area is typed.
  useEffect(() => {
    const id = ++latestSearch.current;
    if (query.trim().length < 2) return;
    const timer = setTimeout(async () => {
      setSearching(true);
      const result = await searchCourierAreas(query).catch(() => null);
      if (id !== latestSearch.current) return;
      setSearching(false);
      setActive(0);
      if (result?.ok) {
        setResults(result.data);
        setProblem(null);
      } else {
        setResults([]);
        setProblem(result?.message ?? "Could not reach Upaya. Check your connection.");
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  // Close the list when clicking elsewhere.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function openList() {
    setOpen(true);
    if (address.trim().length < 4) return;
    const result = await suggestCourierAreas(address).catch(() => null);
    if (result?.ok) setSuggestions(result.data);
  }

  function choose(area: CourierArea) {
    onChange(area);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && options.length) {
      e.preventDefault();
      setOpen(true);
      setActive(i => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp" && options.length) {
      e.preventDefault();
      setActive(i => Math.max(0, i - 1));
    } else if (e.key === "Enter" && open && options[active]) {
      e.preventDefault();
      choose(options[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2">
        <span className="flex items-center gap-2 min-w-0 text-xs">
          <Check size={13} className="text-primary shrink-0" />
          <span className="min-w-0">
            <span className="block font-semibold truncate">{value.title}</span>
            {value.hub && <span className="block text-[11px] text-muted-foreground truncate">Hub: {value.hub}</span>}
          </span>
        </span>
        <button
          type="button"
          onClick={() => { onChange(null); requestAnimationFrame(() => input.current?.focus()); }}
          aria-label="Change Upaya hub location"
          className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted shrink-0"
        >
          <X size={13} />
        </button>
      </div>
    );
  }

  return (
    <div ref={box} className="relative">
      <Truck size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={input}
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={openList}
        onKeyDown={onKeyDown}
        placeholder="Upaya hub location * (type the area)"
        aria-label="Upaya hub location"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        role="combobox"
        className={cn(
          "w-full pl-8 pr-8 py-2 text-xs rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20",
          invalid && "border-red-400 focus:ring-red-200"
        )}
      />
      <Search size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />

      {open && (typing || suggestions.length > 0) && (
        <div id={listId} role="listbox" className="absolute left-0 right-0 top-full mt-1 z-30 rounded-xl border border-border bg-card shadow-lg max-h-56 overflow-y-auto">
          {!typing && <p className="px-3 pt-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Suggested from address</p>}
          {options.map((option, i) => (
            <button
              key={option.areaId}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(option)}
              className={cn("w-full text-left px-3 py-2 text-xs flex items-center gap-2", i === active ? "bg-muted" : "hover:bg-muted")}
            >
              <MapPin size={12} className="text-muted-foreground shrink-0" />
              <span className="min-w-0 truncate font-medium">{option.title}</span>
              {option.hub && <span className="ml-auto pl-2 text-[11px] text-muted-foreground whitespace-nowrap max-w-[40%] truncate">{option.hub}</span>}
            </button>
          ))}
          {typing && searching && options.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">Searching Upaya…</p>}
          {typing && !searching && options.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">{problem ?? "No matching hub location. Try a shorter area name."}</p>
          )}
        </div>
      )}
    </div>
  );
}
