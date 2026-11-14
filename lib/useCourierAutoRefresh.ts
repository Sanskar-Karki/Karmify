"use client";

import { useEffect, useRef } from "react";
import { refreshCourierShipments } from "@/app/actions";

// Shared across pages, so moving between Orders and a customer's page doesn't
// ask Upaya again straight away.
let lastRun = 0;
const MIN_GAP_MS = 60 * 1000;
const INTERVAL_MS = 3 * 60 * 1000;

/**
 * Keeps Upaya statuses on screen current without opening each order's
 * tracking popup. While the page is open and visible and there are shipments
 * Upaya can still update, it asks Upaya for changes when the page opens, when
 * the tab comes back into view and every few minutes. When anything changed
 * it calls `onUpdated` (a quiet refetch). The webhook does the same instantly
 * once it's registered; this covers the time until then and any webhook Upaya
 * misses.
 */
export function useCourierAutoRefresh(active: boolean, onUpdated: () => void) {
  const onUpdatedRef = useRef(onUpdated);
  useEffect(() => {
    onUpdatedRef.current = onUpdated;
  }, [onUpdated]);

  useEffect(() => {
    if (!active) return;
    let stopped = false;

    async function run() {
      if (document.visibilityState !== "visible" || Date.now() - lastRun < MIN_GAP_MS) return;
      lastRun = Date.now();
      const result = await refreshCourierShipments().catch(() => null);
      if (!stopped && result?.ok && result.data.updated > 0) onUpdatedRef.current();
    }

    void run();
    const timer = setInterval(run, INTERVAL_MS);
    document.addEventListener("visibilitychange", run);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", run);
    };
  }, [active]);
}
