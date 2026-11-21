"use client";

import { useSyncExternalStore } from "react";

// Installing Karmify as an app. Android and desktop Chrome/Edge offer an
// install prompt (the "beforeinstallprompt" event, which fires once, early, on
// whichever page loads first, so it's caught here at startup). iPhone Safari
// has no prompt: people add it from the Share menu instead.

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

export type InstallState = "installed" | "prompt" | "ios" | "unavailable";

let deferred: InstallPromptEvent | null = null;
let installedNow = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(l => l());
let listening = false;

/** Starts listening for the install prompt; call once when the app loads. */
export function listenForInstallPrompt() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  // Caught by the script in app/layout.tsx if it fired before the app loaded.
  const early = (window as Window & { __karmifyInstallPrompt?: InstallPromptEvent }).__karmifyInstallPrompt;
  if (early) {
    deferred = early;
    notify();
  }
  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault(); // Shown from our own button instead of the browser's mini-bar.
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installedNow = true;
    notify();
  });
}

/** True when Karmify is running as the installed app (not in a browser tab). */
export function isStandalone() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function snapshot(): InstallState {
  if (installedNow || isStandalone()) return "installed";
  if (deferred) return "prompt";
  // Only Safari can add to the home screen on iPhone (other iOS browsers can too on iOS 16.4+, via Share).
  if (isIOS()) return "ios";
  return "unavailable";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const display = window.matchMedia("(display-mode: standalone)");
  display.addEventListener("change", listener);
  return () => {
    listeners.delete(listener);
    display.removeEventListener("change", listener);
  };
}

export function useInstallState(): InstallState {
  return useSyncExternalStore(subscribe, snapshot, () => "unavailable");
}

/** Shows the browser's install dialog. Resolves true if Karmify was installed. */
export async function promptInstall() {
  const event = deferred;
  if (!event) return false;
  deferred = null; // A prompt can only be shown once.
  notify();
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome === "accepted";
}
