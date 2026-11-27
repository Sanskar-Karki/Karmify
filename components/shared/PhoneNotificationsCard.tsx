"use client";

import React, { useEffect, useState } from "react";
import { BellRing, BellOff, Send } from "lucide-react";
import { toast } from "sonner";
import { getPushDevice, removePushDevice, savePushDevice, setPushEverything, testPushDevice } from "@/app/actions";
import { Button } from "@/components/shared/Button";
import { Switch } from "@/components/shared/OwnerLockCard";
import { mutate } from "@/lib/mutate";
import { isIOS, isStandalone } from "@/lib/pwa";
import { cn } from "@/lib/utils";

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

/**
 * What this device can do:
 * - `ios-browser`: an iPhone in Safari; Apple allows notifications only in the Home Screen app.
 * - `unsupported`: an old browser, or a local test copy (no service worker outside production).
 * - `blocked`: notifications were refused for Karmify in the phone's settings.
 */
type Support = "checking" | "ready" | "ios-browser" | "unsupported" | "blocked";

function detectSupport(): Support {
  if (isIOS() && !isStandalone()) return "ios-browser";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (process.env.NODE_ENV !== "production") return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  return "ready";
}

/** The service worker, or null if it isn't running (it should be within a few seconds of opening Karmify). */
async function workerRegistration(): Promise<ServiceWorkerRegistration | null> {
  const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), 8000));
  return Promise.race([navigator.serviceWorker.ready, timeout]);
}

function keyBytes(base64url: string) {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function readDeviceState() {
  const support = detectSupport();
  let endpoint: string | null = null;
  if (support === "ready" || support === "blocked") {
    const registration = await workerRegistration();
    const subscription = await registration?.pushManager.getSubscription().catch(() => null);
    endpoint = subscription?.endpoint ?? null;
  }
  const result = await getPushDevice(endpoint).catch(() => null);
  return { support, endpoint, server: result?.ok ? result.data : null };
}

/**
 * Settings → Phone notifications: lock-screen alerts for new website orders on
 * this phone or computer, even when Karmify is closed. Per device, like the
 * Dashboard lock: each phone that should ring switches it on once.
 */
export function PhoneNotificationsCard() {
  const [support, setSupport] = useState<Support>("checking");
  const [configured, setConfigured] = useState(true);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [on, setOn] = useState(false);
  const [everything, setEverything] = useState(false);
  const [busy, setBusy] = useState(false);

  // Where this device stands: what it supports, and whether the server has it signed up.
  useEffect(() => {
    let alive = true;
    readDeviceState().then(state => {
      if (!alive) return;
      setSupport(state.support);
      setEndpoint(state.endpoint);
      if (!state.server) return;
      setConfigured(state.server.configured && Boolean(PUBLIC_KEY));
      setOn(state.server.registered && typeof Notification !== "undefined" && Notification.permission === "granted");
      setEverything(state.server.everything);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function switchOn() {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setSupport(permission === "denied" ? "blocked" : "ready");
        toast.error("Notifications weren't allowed, so this phone won't get alerts.");
        return;
      }
      const registration = await workerRegistration();
      if (!registration) {
        toast.error("Karmify's app setup is still loading. Wait a moment and try again.");
        return;
      }
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(PUBLIC_KEY) }));
      const result = await mutate(() => savePushDevice(subscription.toJSON(), everything, navigator.userAgent));
      if (!result.ok) return;
      setEndpoint(subscription.endpoint);
      setOn(true);
      toast.success(result.data.tested ? "Phone notifications are on. A test one is on its way." : "Phone notifications are on.");
    } catch (err) {
      console.error("Push sign-up failed", err);
      toast.error("This phone couldn't be signed up for notifications. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function switchOff() {
    setBusy(true);
    try {
      const registration = await workerRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      const address = subscription?.endpoint ?? endpoint;
      await subscription?.unsubscribe().catch(() => false);
      if (address) {
        const result = await mutate(() => removePushDevice(address), { success: "Phone notifications are off on this device." });
        if (!result.ok) return;
      }
      setOn(false);
      setEndpoint(null);
    } finally {
      setBusy(false);
    }
  }

  async function changeEverything(next: boolean) {
    setEverything(next);
    if (!on || !endpoint) return;
    const result = await mutate(() => setPushEverything(endpoint, next), {
      success: next ? "This device also gets low stock and other alerts." : "This device gets new website orders only.",
    });
    if (!result.ok) setEverything(!next);
  }

  async function sendTest() {
    if (!endpoint) return;
    setBusy(true);
    await mutate(() => testPushDevice(endpoint), { success: "Test sent. It should show up in a few seconds." });
    setBusy(false);
  }

  const canSwitch = support === "ready" && configured;

  return (
    <section aria-labelledby="phone-notifications-title" className="bg-card border border-border/80 rounded-2xl shadow-sm p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <div
          aria-hidden
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            on ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" : "bg-primary/10 text-primary dark:text-red-400"
          )}
        >
          {on ? <BellRing size={18} /> : <BellOff size={18} />}
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="phone-notifications-title" className="font-bold text-base">Phone notifications</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {on
              ? <>On for this device. New website orders show on the lock screen, even when Karmify is closed.</>
              : <>Get an alert on this phone the moment a website order comes in, even when Karmify is closed.</>}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Per device: switch it on once on each phone that should ring. Tapping an alert opens the order.
          </p>

          {support === "ios-browser" && (
            <Note>
              On iPhone, notifications work only in the Karmify app: add Karmify to your Home Screen (Share → Add to Home Screen), open it from there, then come back here.
            </Note>
          )}
          {support === "blocked" && (
            <Note>
              Notifications are blocked for Karmify on this device. Allow them in the phone&apos;s settings (Settings → Notifications, or the site settings in your browser), then come back here.
            </Note>
          )}
          {support === "unsupported" && (
            <Note>This browser can&apos;t show Karmify notifications. Use the installed Karmify app, or Chrome, Edge or Safari.</Note>
          )}
          {support === "ready" && !configured && (
            <Note>Phone notifications aren&apos;t set up on the server yet (the VAPID keys), so nothing can be switched on.</Note>
          )}

          {on && (
            <div className="mt-4 space-y-3 border-t border-border/60 pt-4">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Also other alerts</p>
                  <p className="text-[11px] text-muted-foreground">Low stock, stock received, and website items that need fixing.</p>
                </div>
                <Switch checked={everything} onChange={on => void changeEverything(on)} label="Also send low stock and other alerts to this device" />
              </div>
              <Button variant="secondary" onClick={sendTest} loading={busy} className="w-full sm:w-auto">
                {!busy && <Send size={14} />} Send a test
              </Button>
            </div>
          )}
        </div>
        <Switch
          checked={on}
          busy={busy || support === "checking"}
          disabled={!on && !canSwitch}
          label="Phone notifications on this device"
          onChange={next => void (next ? switchOn() : switchOff())}
        />
      </div>
    </section>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
      {children}
    </p>
  );
}
