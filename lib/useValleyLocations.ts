"use client";

import { useEffect, useState } from "react";
import { listValleyLocations } from "@/app/actions";

// Upaya's current valley locations, loaded once per page load. Until they
// arrive, or if Upaya can't be reached, the saved list in lib/courier.ts is used.
let loaded: Promise<ReadonlySet<number> | null> | null = null;

function load() {
  loaded ??= listValleyLocations()
    .then(result => (result.ok ? new Set(result.data) : null))
    .catch(() => null);
  return loaded;
}

export function useValleyLocations(): ReadonlySet<number> | null {
  const [live, setLive] = useState<ReadonlySet<number> | null>(null);
  useEffect(() => {
    let current = true;
    void load().then(set => { if (current && set) setLive(set); });
    return () => { current = false; };
  }, []);
  return live;
}
