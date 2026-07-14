"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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

/**
 * Floats its children above the entire page via a portal to document.body,
 * positioned with `fixed` coordinates measured from the anchor element.
 *
 * Popovers built with `absolute` inside a normal-flow ancestor get clipped by
 * any ancestor's `overflow: hidden/auto` (our scrollable <main>, card
 * containers, etc.) and are layered by z-index against sibling stacking
 * contexts rather than the page as a whole. Portaling to body and computing
 * fixed coordinates sidesteps both problems — the popover always renders on
 * top of everything and is never clipped by a parent's scroll box.
 */
export function Popover({ open, onClose, anchorRef, align = "start", matchAnchorWidth = false, className, children }: PopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number; width?: number } | null>(null);

  const reposition = () => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setCoords({
      top: rect.bottom + 8,
      left: align === "end" ? rect.right : rect.left,
      width: matchAnchorWidth ? rect.width : undefined,
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose]);

  if (!open || typeof document === "undefined" || !coords) return null;

  const style: React.CSSProperties = {
    position: "fixed",
    top: coords.top,
    ...(align === "end" ? { right: window.innerWidth - coords.left } : { left: coords.left }),
    ...(coords.width !== undefined ? { width: coords.width } : {}),
  };

  return createPortal(
    <div ref={popoverRef} style={style} className={className}>
      {children}
    </div>,
    document.body
  );
}
