"use client";

import { useEffect } from "react";
import { listenForInstallPrompt } from "@/lib/pwa";

/**
 * Makes Karmify installable and quick to reopen: registers the service worker
 * (public/sw.js) and catches the install prompt. Production only: in
 * development a worker would keep serving old copies of files being edited,
 * so any left over from a production build is removed instead.
 */
export function PwaSetup() {
  useEffect(() => {
    listenForInstallPrompt();
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister())).catch(() => {});
      return;
    }
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(err => console.error("Service worker registration failed", err));
  }, []);
  return null;
}
