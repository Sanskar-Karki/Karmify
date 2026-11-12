"use client";

import React, { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useEscapeLayer, usePresence } from "@/lib/useOverlay";

const SIZES = { sm: "sm:max-w-sm", md: "sm:max-w-lg", lg: "sm:max-w-2xl" } as const;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** A short shake. Done outside CSS so it can't restart the entrance animation. */
function nudge(panel: HTMLElement | null) {
  if (!panel || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  panel.animate(
    [{ translate: "0" }, { translate: "-6px" }, { translate: "6px" }, { translate: "0" }],
    { duration: 220, easing: "ease-in-out" }
  );
}

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: LucideIcon;
  size?: keyof typeof SIZES;
  footer?: React.ReactNode;
  /** Blocks every way of closing while a save is running. */
  busy?: boolean;
  /** Unsaved input: Escape and backdrop clicks warn instead of discarding it. */
  dirty?: boolean;
  hideHeader?: boolean;
  className?: string;
  children: React.ReactNode;
}

/**
 * The app's one dialog: a bottom sheet on phones and a centred panel elsewhere.
 * Rendered in a portal so page transforms and scroll containers can't affect
 * it. Handles focus, Escape, backdrop clicks and enter/exit animation.
 */
export function Modal({ open, onClose, title, description, icon: Icon, size = "md", footer, busy, dirty, hideHeader, className, children }: ModalProps) {
  const { mounted, state } = usePresence(open);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  function requestDismiss() {
    if (busy) return;
    if (dirty) {
      nudge(panelRef.current);
      toast.info("You have unsaved changes. Use Cancel to discard them.", { id: "modal-unsaved" });
      return;
    }
    onClose();
  }

  useEscapeLayer(open, requestDismiss);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const target = panel?.querySelector<HTMLElement>("[data-autofocus]") ?? panel;
    target?.focus({ preventScroll: true });
    return () => previous?.focus?.({ preventScroll: true });
  }, [open]);

  function trapTab(e: React.KeyboardEvent) {
    if (e.key !== "Tab" || !panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panelRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-end sm:items-center justify-center sm:p-4">
      <div
        data-state={state}
        onClick={requestDismiss}
        aria-hidden="true"
        className="overlay-backdrop no-print absolute inset-0 bg-black/50 backdrop-blur-[2px]"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-state={state}
        onKeyDown={trapTab}
        className={cn(
          "overlay-panel relative flex w-full flex-col bg-card text-card-foreground border border-border shadow-2xl outline-none",
          "max-h-[92dvh] rounded-t-2xl sm:rounded-2xl",
          SIZES[size],
          className
        )}
      >
        {hideHeader ? (
          <h2 id={titleId} className="sr-only">{title}</h2>
        ) : (
          <div className="flex items-start justify-between gap-3 px-5 sm:px-6 py-4 border-b border-border shrink-0">
            <div className="min-w-0">
              <h2 id={titleId} className="text-base sm:text-lg font-bold text-foreground flex items-center gap-2">
                {Icon && <Icon size={18} className="text-primary shrink-0" />}
                {title}
              </h2>
              {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
            </div>
            <button
              type="button"
              onClick={() => { if (!busy) onClose(); }}
              disabled={busy}
              aria-label="Close"
              className="w-9 h-9 -mr-1.5 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 shrink-0"
            >
              <X size={18} />
            </button>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">{children}</div>

        {footer && (
          <div
            className="flex gap-3 px-5 sm:px-6 pt-4 border-t border-border shrink-0 no-print"
            style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
