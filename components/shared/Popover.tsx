"use client";

import React, { useEffect, useEffectEvent, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useEscapeLayer, usePresence } from "@/lib/useOverlay";

interface PopoverProps {
  open: boolean;
  onClose: () => void;
  /** The trigger element the popover is anchored to. */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** "start" aligns the popover's left edge to the anchor's left edge, "end" to the right edge. */
  align?: "start" | "end";
  /** When true, the popover's width is pinned to the anchor's measured width (e.g. a search dropdown matching its input). */
  matchAnchorWidth?: boolean;
  className?: string;
  children: React.ReactNode;
}

const GAP = 8;
const VIEWPORT_MARGIN = 8;

/**
 * Floats its children above the entire page, including modals, via a portal to
 * document.body. Placement is written straight to the element's style, so
 * following the anchor during a scroll doesn't re-render React. It opens
 * towards whichever side has room and never leaves the viewport.
 */
export function Popover({ open, onClose, anchorRef, align = "start", matchAnchorWidth = false, className, children }: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { mounted, state } = usePresence(open);

  useEscapeLayer(open, onClose);

  const closeFromScroll = useEffectEvent(onClose);

  useLayoutEffect(() => {
    if (!mounted) return;
    const panel = panelRef.current;
    if (!panel) return;

    function place() {
      const anchor = anchorRef.current;
      if (!anchor || !panel) return;
      const rect = anchor.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight;

      // Anchor scrolled out of view: a popover pointing at nothing is confusing.
      if (rect.bottom < 0 || rect.top > viewportHeight) {
        closeFromScroll();
        return;
      }

      if (matchAnchorWidth) panel.style.width = `${rect.width}px`;
      panel.style.maxHeight = "";
      const contentHeight = panel.offsetHeight;
      const width = panel.offsetWidth;

      const below = viewportHeight - rect.bottom - GAP - VIEWPORT_MARGIN;
      const above = rect.top - GAP - VIEWPORT_MARGIN;
      const openUp = contentHeight > below && above > below;
      const available = Math.max(openUp ? above : below, 120);
      const height = Math.min(contentHeight, available);

      const preferredLeft = align === "end" ? rect.right - width : rect.left;
      const left = Math.min(Math.max(preferredLeft, VIEWPORT_MARGIN), viewportWidth - width - VIEWPORT_MARGIN);

      panel.style.maxHeight = `${available}px`;
      panel.style.top = `${openUp ? rect.top - GAP - height : rect.bottom + GAP}px`;
      panel.style.left = `${Math.max(left, VIEWPORT_MARGIN)}px`;
      panel.style.transformOrigin = `${align === "end" ? "right" : "left"} ${openUp ? "bottom" : "top"}`;
    }

    place();

    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    function onScroll(e: Event) {
      if (e.target instanceof Node && panel?.contains(e.target)) return;
      schedule();
    }

    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", onScroll, true);
    const observer = new ResizeObserver(schedule);
    observer.observe(panel);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", onScroll, true);
      observer.disconnect();
    };
  }, [mounted, align, matchAnchorWidth, anchorRef]);

  const dismiss = useEffectEvent((target: Node) => {
    if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
    onClose();
  });

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      dismiss(e.target as Node);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={panelRef}
      data-state={state}
      style={{ position: "fixed", top: 0, left: 0, zIndex: 1100, overflowY: "auto" }}
      className={cn("popover-panel", state === "closed" && "pointer-events-none", className)}
    >
      {children}
    </div>,
    document.body
  );
}
