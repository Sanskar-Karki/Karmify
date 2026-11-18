"use client";

import { useState, useSyncExternalStore } from "react";
import { Download, Share, SquarePlus, X } from "lucide-react";
import { toast } from "sonner";
import { promptInstall, useInstallState } from "@/lib/pwa";

const DISMISS_KEY = "karmify_install_dismissed";

const subscribeNothing = () => () => {};
function readDismissed() {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}
// Phones and tablets only: on a computer the browser's own install button is enough.
const isTouch = () => window.matchMedia("(pointer: coarse)").matches;

/**
 * "Install Karmify" on phones: one tap on Android (the browser's install
 * dialog), or the two Share-menu steps on iPhone. Hidden inside the installed
 * app, and for good once dismissed.
 */
export function InstallAppCard() {
  const state = useInstallState();
  const storedDismissed = useSyncExternalStore(subscribeNothing, readDismissed, () => true);
  const touch = useSyncExternalStore(subscribeNothing, isTouch, () => false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || storedDismissed || !touch || (state !== "prompt" && state !== "ios")) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Storage blocked: hidden until the page is reloaded.
    }
  };

  async function install() {
    const accepted = await promptInstall();
    if (accepted) toast.success("Karmify is on your home screen.");
  }

  return (
    <section
      aria-label="Install Karmify"
      className="relative flex items-start gap-3 rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/10 via-card to-card p-4 shadow-sm animate-fade-in"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/icon-192.png" alt="" width={44} height={44} className="h-11 w-11 shrink-0 rounded-xl shadow-md shadow-primary/20" />
      <div className="min-w-0 flex-1 pr-6">
        <h2 className="text-sm font-bold text-foreground">Install Karmify on this phone</h2>
        {state === "prompt" ? (
          <>
            <p className="mt-0.5 text-xs text-muted-foreground">Opens full-screen from your home screen, like an app.</p>
            <button
              type="button"
              onClick={install}
              className="mt-2.5 inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-xs font-semibold text-primary-foreground shadow-sm shadow-primary/25 active:scale-[0.98]"
            >
              <Download size={14} /> Install app
            </button>
          </>
        ) : (
          <ol className="mt-1.5 space-y-1 text-xs text-muted-foreground">
            <li className="flex items-center gap-1.5">
              <span className="font-bold text-foreground">1.</span> Tap <Share size={13} className="text-foreground" aria-label="Share" /> Share in Safari&apos;s bar
            </li>
            <li className="flex items-center gap-1.5">
              <span className="font-bold text-foreground">2.</span> Choose <SquarePlus size={13} className="text-foreground" aria-hidden /> <span className="font-semibold text-foreground">Add to Home Screen</span>
            </li>
          </ol>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Don't show again"
        title="Don't show again"
        className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X size={15} />
      </button>
    </section>
  );
}
