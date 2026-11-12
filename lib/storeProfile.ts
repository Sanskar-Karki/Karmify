"use client";

import { useMemo, useSyncExternalStore } from "react";

export const DEFAULT_STORE_PROFILE = {
  name: "Karmalu Originals",
  tagline: "",
  address: "",
  phone: "",
  email: "",
  website: "",
  currency: "NPR",
  taxId: "",
};

export type StoreProfile = typeof DEFAULT_STORE_PROFILE;

// The database has no columns for these yet, so the profile is kept in this
// browser. It's what prints on receipts from this device.
const STORAGE_KEY = "karmify_store_profile";
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readRaw() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function useStoreProfile(): StoreProfile {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  return useMemo(() => {
    if (!raw) return DEFAULT_STORE_PROFILE;
    try {
      const saved = { ...DEFAULT_STORE_PROFILE, ...JSON.parse(raw) } as StoreProfile;
      // Labels and receipts carry the shop's name, not the app's: an old saved "Karmify"
      // (or a blank name) falls back to the default.
      if (!saved.name?.trim() || saved.name.trim().toLowerCase() === "karmify") saved.name = DEFAULT_STORE_PROFILE.name;
      return saved;
    } catch {
      return DEFAULT_STORE_PROFILE;
    }
  }, [raw]);
}

/** Returns false when the browser refuses storage, e.g. in private browsing. */
export function saveStoreProfile(profile: StoreProfile) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    listeners.forEach(listener => listener());
    return true;
  } catch {
    return false;
  }
}
