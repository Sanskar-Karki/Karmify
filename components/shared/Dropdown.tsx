"use client";

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Check, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover } from "@/components/shared/Popover";

export interface DropdownOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface DropdownProps {
  value: string;
  onChange: (value: string) => void;
  options: DropdownOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Applied to the trigger button — use to match the sizing of surrounding form controls. */
  triggerClassName?: string;
  "aria-label"?: string;
}

// Long lists get a filter box; short ones stay a plain menu.
const SEARCH_THRESHOLD = 8;

// Styled replacement for a native <select>, built on the shared Popover so it
// positions and dismisses like the rest of the app's floating UI. Supports
// arrow keys, Enter, Escape and type-to-jump.
export function Dropdown({ value, onChange, options, placeholder = "Select...", disabled, className, triggerClassName, "aria-label": ariaLabel }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selected = options.find(o => o.value === value);
  const searchable = options.length >= SEARCH_THRESHOLD;

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? options.filter(o => o.label.toLowerCase().includes(q)) : options;
  }, [options, filter]);

  function openMenu() {
    setFilter("");
    setActiveIdx(Math.max(0, options.findIndex(o => o.value === value)));
    setOpen(true);
  }

  function closeMenu() {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }

  function choose(option: DropdownOption) {
    if (option.disabled) return;
    onChange(option.value);
    closeMenu();
  }

  useEffect(() => {
    if (open && searchable) searchRef.current?.focus({ preventScroll: true });
  }, [open, searchable]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`[data-index="${activeIdx}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIdx]);

  function move(delta: number) {
    if (visible.length === 0) return;
    let next = activeIdx;
    for (let i = 0; i < visible.length; i++) {
      next = (next + delta + visible.length) % visible.length;
      if (!visible[next].disabled) break;
    }
    setActiveIdx(next);
  }

  // React bubbles this through the portal, so one handler covers the trigger
  // and the filter box inside the menu.
  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        openMenu();
      }
      return;
    }

    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (visible[activeIdx]) choose(visible[activeIdx]);
    } else if (e.key === "Tab") {
      // The menu lives in a portal, so tabbing out of it would drop focus.
      e.preventDefault();
      closeMenu();
    } else if (!searchable && e.key.length === 1) {
      const idx = visible.findIndex(o => !o.disabled && o.label.toLowerCase().startsWith(e.key.toLowerCase()));
      if (idx >= 0) setActiveIdx(idx);
    }
  }

  return (
    <div className={cn("relative", className)} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        className={cn(
          "w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border border-border bg-background text-sm text-left transition-all hover:border-foreground/25 focus:outline-none focus:ring-2 focus:ring-primary/20",
          open && "border-primary/40 ring-2 ring-primary/20",
          disabled && "opacity-50 cursor-not-allowed hover:border-border",
          triggerClassName
        )}
      >
        <span className={cn("truncate", !selected && "text-muted-foreground")}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown size={14} className={cn("shrink-0 text-muted-foreground transition-transform duration-150", open && "rotate-180")} />
      </button>

      <Popover
        open={open}
        onClose={closeMenu}
        anchorRef={triggerRef}
        matchAnchorWidth
        className="min-w-44 rounded-xl border border-border bg-popover text-popover-foreground shadow-xl"
      >
        {searchable && (
          <div className="sticky top-0 z-10 bg-popover p-1.5 border-b border-border/60">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={searchRef}
                value={filter}
                onChange={e => { setFilter(e.target.value); setActiveIdx(0); }}
                placeholder="Search..."
                aria-label="Filter options"
                className="w-full pl-8 pr-2 py-1.5 text-xs rounded-lg bg-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>
        )}
        <div ref={listRef} id={listId} role="listbox" className="py-1.5 max-h-60 overflow-y-auto overscroll-contain">
          {visible.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {options.length === 0 ? "No options available." : "No matches."}
            </p>
          )}
          {visible.map((opt, idx) => (
            <button
              key={opt.value}
              type="button"
              role="option"
              tabIndex={-1}
              data-index={idx}
              aria-selected={opt.value === value}
              disabled={opt.disabled}
              onClick={() => choose(opt)}
              onMouseMove={() => { if (idx !== activeIdx) setActiveIdx(idx); }}
              className={cn(
                "w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left",
                idx === activeIdx && !opt.disabled && "bg-muted",
                opt.disabled && "opacity-50 cursor-not-allowed",
                opt.value === value && "font-semibold text-primary"
              )}
            >
              <span className="truncate">{opt.label}</span>
              {opt.value === value && <Check size={13} className="shrink-0" />}
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );
}
