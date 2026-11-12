"use client";

import { useEffect, useEffectEvent, useState } from "react";

/** How long a closing overlay stays mounted so its exit animation can play. */
export const OVERLAY_EXIT_MS = 150;

/** Keeps `open` content mounted briefly after it closes. */
export function usePresence(open: boolean) {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (open || !mounted) return;
    const timer = setTimeout(() => setMounted(false), OVERLAY_EXIT_MS);
    return () => clearTimeout(timer);
  }, [open, mounted]);

  return { mounted: mounted || open, state: open ? ("open" as const) : ("closed" as const) };
}

type Layer = { onEscape: () => void };

const layers: Layer[] = [];

function handleKeyDown(e: KeyboardEvent) {
  if (e.key !== "Escape" || layers.length === 0) return;
  e.preventDefault();
  layers[layers.length - 1].onEscape();
}

/**
 * Registers an open overlay so Escape closes only the top-most one, e.g. a
 * dropdown inside a modal closes the dropdown and leaves the modal open.
 */
export function useEscapeLayer(active: boolean, onEscape: () => void) {
  const fire = useEffectEvent(onEscape);

  useEffect(() => {
    if (!active) return;
    const layer: Layer = { onEscape: () => fire() };
    if (layers.length === 0) document.addEventListener("keydown", handleKeyDown);
    layers.push(layer);
    return () => {
      layers.splice(layers.indexOf(layer), 1);
      if (layers.length === 0) document.removeEventListener("keydown", handleKeyDown);
    };
  }, [active]);
}
