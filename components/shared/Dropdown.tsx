"use client";

import React, { useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";
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
}

// Styled drop-in replacement for a native <select>, built on the shared
// Popover primitive so it portals/positions/dismisses consistently with the
// rest of the app's floating UI instead of relying on native <select> chrome
// (which can't be restyled cross-browser).
export function Dropdown({ value, onChange, options, placeholder = "Select...", disabled, className, triggerClassName }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selected = options.find(o => o.value === value);

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className={cn(
          "w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border border-border bg-background text-sm text-left transition-all cursor-pointer hover:border-border/80 focus:outline-none focus:ring-2 focus:ring-primary/20",
          disabled && "opacity-50 cursor-not-allowed hover:border-border",
          triggerClassName
        )}
      >
        <span className={cn("truncate", !selected && "text-muted-foreground")}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown size={14} className={cn("shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      <Popover open={open} onClose={() => setOpen(false)} anchorRef={triggerRef} matchAnchorWidth>
        <div className="mt-1 py-1.5 rounded-xl border border-border bg-card shadow-lg max-h-64 overflow-y-auto">
          {options.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">No options available.</p>
          )}
          {options.map(opt => (
            <button
              key={opt.value}
              type="button"
              disabled={opt.disabled}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={cn(
                "w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left cursor-pointer hover:bg-muted transition-colors",
                opt.disabled && "opacity-50 cursor-not-allowed hover:bg-transparent",
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
