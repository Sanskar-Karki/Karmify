"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Local state seeded from a URL parameter that follows later URL changes, so
 * picking a search result while already on the destination page still applies.
 * Requires a Suspense boundary above the caller (provided by the dashboard layout).
 */
export function useUrlState(param: string, fallback = "") {
  const fromUrl = useSearchParams().get(param) ?? fallback;
  const [value, setValue] = useState(fromUrl);
  const [lastUrlValue, setLastUrlValue] = useState(fromUrl);

  if (fromUrl !== lastUrlValue) {
    setLastUrlValue(fromUrl);
    setValue(fromUrl);
  }

  return [value, setValue] as const;
}
