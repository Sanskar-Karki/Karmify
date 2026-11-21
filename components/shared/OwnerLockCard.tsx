"use client";

import React, { useEffect, useState } from "react";
import { Eye, EyeOff, KeyRound, LockKeyhole, LockKeyholeOpen } from "lucide-react";
import { toast } from "sonner";
import { getOwnerAccess, lockOwnerPages, unlockOwnerPages } from "@/app/actions";
import { Button } from "@/components/shared/Button";
import { Modal } from "@/components/shared/Modal";
import { mutate } from "@/lib/mutate";
import { ownerLockChanged, readOwnerUntil, useOwnerUnlocked } from "@/lib/ownerLock";
import { cn } from "@/lib/utils";

const formatUntil = (until: number) =>
  new Date(until).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

/**
 * Settings → Dashboard & Analytics: a switch that shows them on this device
 * once the owner password is given, and hides them again. Everyone signs in
 * with the same account, so the lock belongs to the device, not the login.
 */
export function OwnerLockCard() {
  const unlocked = useOwnerUnlocked();
  const [configured, setConfigured] = useState(true);
  const [asking, setAsking] = useState(false);
  const [locking, setLocking] = useState(false);

  // Bring this device's hint in line with the server's signed cookie (it may be
  // stale after the owner password changed), and learn whether a password is set up.
  useEffect(() => {
    let alive = true;
    getOwnerAccess()
      .then(result => {
        if (!alive || !result.ok) return;
        setConfigured(result.data.configured);
        ownerLockChanged();
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  async function lock() {
    setLocking(true);
    const result = await mutate(() => lockOwnerPages(), { success: "Dashboard and Analytics are locked on this device." });
    setLocking(false);
    if (result.ok) ownerLockChanged();
  }

  const until = unlocked ? readOwnerUntil() : null;

  return (
    <section aria-labelledby="owner-lock-title" className="bg-card border border-border/80 rounded-2xl shadow-sm p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <div
          aria-hidden
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            unlocked ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" : "bg-primary/10 text-primary dark:text-pink-300"
          )}
        >
          {unlocked ? <LockKeyholeOpen size={18} /> : <LockKeyhole size={18} />}
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="owner-lock-title" className="font-bold text-base">Dashboard &amp; Analytics</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {unlocked
              ? <>Showing on this device{until ? <> until {formatUntil(until)}</> : null}. Switch off before handing this phone or computer to someone else.</>
              : <>Hidden on this device. Switch on with the owner password to see the sales figures and charts here.</>}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            The lock is per device: unlocking here doesn&apos;t unlock anyone else&apos;s phone. Orders, POS, Products and Stock work either way.
          </p>
          {!configured && !unlocked && (
            <p className="mt-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              The owner password isn&apos;t set up on the server yet (OWNER_UNLOCK_PASSWORD), so nothing can be unlocked.
            </p>
          )}
        </div>
        <Switch
          checked={unlocked}
          busy={locking}
          disabled={!unlocked && !configured}
          label="Show Dashboard and Analytics on this device"
          onChange={on => (on ? setAsking(true) : void lock())}
        />
      </div>

      {asking && <UnlockDialog onClose={() => setAsking(false)} />}
    </section>
  );
}

export function Switch({ checked, onChange, label, busy, disabled }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      onClick={() => onChange(!checked)}
      // A finger-sized target around the track.
      className="-m-2 flex shrink-0 items-center rounded-full p-2 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        className={cn(
          "relative inline-flex h-7 w-12 items-center rounded-full border transition-colors",
          checked ? "border-emerald-600 bg-emerald-600" : "border-border bg-muted"
        )}
      >
        <span
          className={cn(
            "inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
            checked ? "translate-x-6" : "translate-x-1"
          )}
        />
      </span>
    </button>
  );
}

function UnlockDialog({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unlock() {
    if (!password.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await unlockOwnerPages(password);
      if (!result.ok) {
        setError(result.message);
        setPassword("");
        return;
      }
      ownerLockChanged();
      toast.success("Dashboard and Analytics are unlocked on this device.");
      onClose();
    } catch {
      setError(navigator.onLine ? "Something went wrong. Please try again." : "You're offline. Reconnect and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Unlock Dashboard & Analytics"
      description="On this device only"
      icon={KeyRound}
      size="sm"
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy} className="flex-1">Cancel</Button>
          <Button onClick={unlock} loading={busy} disabled={!password.trim()} className="flex-1">{busy ? "Checking…" : "Unlock"}</Button>
        </>
      }
    >
      <div className="space-y-2 p-5 sm:p-6">
        <label htmlFor="owner-password" className="text-xs font-semibold text-muted-foreground">Owner password</label>
        {/* Not a form, and marked for password managers to skip, so a shared phone isn't offered to save it. */}
        <div className="relative">
          <input
            id="owner-password"
            type={shown ? "text" : "password"}
            value={password}
            onChange={e => {
              setPassword(e.target.value);
              setError(null);
            }}
            onKeyDown={e => {
              if (e.key === "Enter") {
                e.preventDefault();
                void unlock();
              }
            }}
            autoFocus
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            data-form-type="other"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "owner-password-error" : undefined}
            className={cn(
              "w-full rounded-xl border bg-background py-2.5 pl-3 pr-11 text-base focus:outline-none focus:ring-2 sm:text-sm",
              error ? "border-red-400 focus:ring-red-200" : "border-border focus:ring-primary/20"
            )}
          />
          <button
            type="button"
            onClick={() => setShown(s => !s)}
            aria-label={shown ? "Hide the password" : "Show the password"}
            className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {shown ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {error && <p id="owner-password-error" role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p>}
        <p className="text-[11px] text-muted-foreground">Wrong attempts are written in the activity log on the Dashboard.</p>
      </div>
    </Modal>
  );
}
