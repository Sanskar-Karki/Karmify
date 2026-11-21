"use client";

import React, { useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";
import {
  Settings, Store, Users, Plus, ShieldCheck, Shield, Save, MapPin, Phone, Mail, Globe,
  Truck, Edit2, Trash2, Sheet, CheckCircle2, XCircle, CloudUpload, Clock,
} from "lucide-react";
import { toast } from "sonner";
import { backupToSheetsNow, deleteSupplier, getBackupStatus, saveSupplier } from "@/app/actions";
import { cn } from "@/lib/utils";
import { SupplierRowPlaceholder } from "@/components/skeletons/placeholders";
import { Modal } from "@/components/shared/Modal";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { OwnerLockCard } from "@/components/shared/OwnerLockCard";
import { PhoneNotificationsCard } from "@/components/shared/PhoneNotificationsCard";
import { Button } from "@/components/shared/Button";
import { EmptyState } from "@/components/shared/EmptyState";
import { mutate } from "@/lib/mutate";
import { resources } from "@/lib/resources";
import { useResources } from "@/lib/useResources";
import { saveStoreProfile, useStoreProfile, type StoreProfile } from "@/lib/storeProfile";
import type { Supplier } from "@/lib/types";

const TABS = [
  { key: "store", label: "Store Identity", icon: Store },
  { key: "suppliers", label: "Suppliers", icon: Truck },
  { key: "team", label: "Team", icon: Users },
  { key: "backup", label: "Backup", icon: Sheet },
];

const STORE_FIELDS = [
  { label: "Store Name", icon: Store, key: "name" },
  { label: "Tagline", icon: Settings, key: "tagline" },
  { label: "Address", icon: MapPin, key: "address" },
  { label: "Phone", icon: Phone, key: "phone" },
  { label: "Email", icon: Mail, key: "email" },
  { label: "Website", icon: Globe, key: "website" },
  { label: "Currency", icon: Settings, key: "currency" },
  { label: "Tax / VAT ID", icon: Shield, key: "taxId" },
] as const;

const SUPPLIER_FIELDS = [
  { label: "Company name", key: "companyName", required: true, type: "text" },
  { label: "Contact person", key: "contactPerson", required: false, type: "text" },
  { label: "Phone", key: "phone", required: false, type: "tel" },
  { label: "Email", key: "email", required: false, type: "email" },
  { label: "Address", key: "address", required: false, type: "text" },
] as const;

const BLANK_SUPPLIER = { companyName: "", contactPerson: "", phone: "", email: "", address: "", notes: "" };

const fieldClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20";

function StoreTab() {
  const saved = useStoreProfile();
  const [edits, setEdits] = useState<Partial<StoreProfile>>({});
  const form = { ...saved, ...edits };
  const hasChanges = Object.entries(edits).some(([key, value]) => saved[key as keyof StoreProfile] !== value);

  function handleSave() {
    if (!form.name.trim()) {
      toast.error("Store name is required.");
      return;
    }
    if (saveStoreProfile(form)) {
      setEdits({});
      toast.success("Store details saved on this device.");
    } else {
      toast.error("This browser blocked saving. Check that private browsing is off.");
    }
  }

  return (
    <div className="bg-card border border-border/80 rounded-2xl shadow-sm overflow-hidden">
      <div className="p-5 sm:p-6 border-b border-border/60">
        <h2 className="font-bold text-base">Store Identity</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Printed on receipts from this device</p>
      </div>
      <div className="p-5 sm:p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        {STORE_FIELDS.map(field => (
          <div key={field.key} className="space-y-1.5">
            <label htmlFor={`store-${field.key}`} className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
              <field.icon size={12} />{field.label}
            </label>
            <input
              id={`store-${field.key}`}
              value={form[field.key]}
              onChange={e => setEdits(current => ({ ...current, [field.key]: e.target.value }))}
              className={fieldClass}
            />
          </div>
        ))}
      </div>
      <div className="px-5 sm:px-6 pb-6">
        <Button onClick={handleSave} disabled={!hasChanges}>
          <Save size={16} /> Save Changes
        </Button>
      </div>
    </div>
  );
}

function SuppliersTab() {
  const { suppliers, loading, refetch } = useResources({ suppliers: resources.suppliers });
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK_SUPPLIER);
  const [initial, setInitial] = useState(BLANK_SUPPLIER);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  function openForm(supplier?: Supplier) {
    const next = supplier
      ? { companyName: supplier.companyName, contactPerson: supplier.contactPerson, phone: supplier.phone, email: supplier.email, address: supplier.address, notes: supplier.notes ?? "" }
      : BLANK_SUPPLIER;
    setEditingId(supplier?.id ?? null);
    setForm(next);
    setInitial(next);
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.companyName.trim()) {
      toast.error("Company name is required.");
      return;
    }
    setSaving(true);
    const result = await mutate(() => saveSupplier(form, editingId), {
      success: editingId ? "Supplier updated." : "Supplier added.",
    });
    if (result.ok) {
      setShowForm(false);
      await refetch();
    }
    setSaving(false);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const result = await mutate(() => deleteSupplier(deleteTarget.id), { success: "Supplier deleted." });
    setDeleteOpen(false);
    if (result.ok) await refetch();
  }

  return (
    <div className="bg-card border border-border/80 rounded-2xl shadow-sm overflow-hidden">
      <div className="p-5 sm:p-6 border-b border-border/60 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-base">Suppliers</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Used on products and purchase orders</p>
        </div>
        <Button onClick={() => openForm()} className="px-3 py-2 text-xs shrink-0">
          <Plus size={13} /> Add Supplier
        </Button>
      </div>

      {loading ? (
        <div className="divide-y divide-border/40">{Array.from({ length: 3 }).map((_, i) => <SupplierRowPlaceholder key={i} />)}</div>
      ) : suppliers.length === 0 ? (
        <EmptyState icon={Truck} title="No suppliers yet" description="Add a supplier to start creating purchase orders." />
      ) : (
        <div className="divide-y divide-border/40">
          {suppliers.map(supplier => (
            <div key={supplier.id} className="flex items-center gap-4 px-5 sm:px-6 py-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold truncate">{supplier.companyName}</p>
                <p className="text-xs text-muted-foreground truncate">{[supplier.contactPerson, supplier.phone, supplier.email].filter(v => v && v !== "N/A").join(" · ") || "No contact details"}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button type="button" onClick={() => openForm(supplier)} aria-label={`Edit ${supplier.companyName}`} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground">
                  <Edit2 size={13} />
                </button>
                <button type="button" onClick={() => { setDeleteTarget(supplier); setDeleteOpen(true); }} aria-label={`Delete ${supplier.companyName}`} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 text-muted-foreground hover:text-red-500">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editingId ? "Edit supplier" : "Add supplier"}
        busy={saving}
        dirty={JSON.stringify(form) !== JSON.stringify(initial)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)} disabled={saving} className="flex-1">Cancel</Button>
            <Button onClick={handleSave} loading={saving} className="flex-1">{saving ? "Saving…" : "Save Supplier"}</Button>
          </>
        }
      >
        <div className="p-5 sm:p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {SUPPLIER_FIELDS.map((field, i) => (
            <div key={field.key} className={cn("space-y-1.5", (i === 0 || field.key === "address") && "sm:col-span-2")}>
              <label htmlFor={`supplier-${field.key}`} className="text-xs font-semibold text-muted-foreground">
                {field.label} {field.required && <span className="text-primary">*</span>}
              </label>
              <input
                id={`supplier-${field.key}`}
                type={field.type}
                data-autofocus={i === 0 ? true : undefined}
                value={form[field.key]}
                onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))}
                className={fieldClass}
              />
            </div>
          ))}
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={confirmDelete}
        title={`Delete ${deleteTarget?.companyName ?? "supplier"}?`}
        description="This can't be undone. Suppliers linked to products or orders can't be deleted."
        confirmLabel="Delete"
      />
    </div>
  );
}

function TeamTab() {
  const { user } = useUser();
  const name = user?.fullName || user?.primaryEmailAddress?.emailAddress || "You";

  return (
    <div className="space-y-3">
      <div className="bg-card border border-border/80 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-5 sm:p-6 border-b border-border/60">
          <h2 className="font-bold text-base">Team Members</h2>
          <p className="text-xs text-muted-foreground mt-0.5">People with access to this store</p>
        </div>
        <div className="flex flex-wrap items-center gap-4 p-5">
          <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0 bg-primary/10 text-primary">
            {name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-[160px]">
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold text-foreground">{name}</p>
              <ShieldCheck size={14} className="text-primary shrink-0" />
            </div>
            <p className="text-xs text-muted-foreground truncate">{user?.primaryEmailAddress?.emailAddress}</p>
          </div>
          <span className="text-[11px] font-bold uppercase px-2.5 py-1 rounded-full bg-primary/10 text-primary">Owner</span>
        </div>
      </div>

      <div className="p-5 bg-amber-50/50 dark:bg-amber-950/10 border border-amber-200/40 dark:border-amber-900/30 rounded-2xl text-xs text-amber-700 dark:text-amber-400 flex gap-2">
        <Settings size={14} className="shrink-0 mt-0.5" />
        <span>Inviting staff and assigning roles isn&apos;t available yet. Each account currently has its own store.</span>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState("store");

  return (
<>
      <div className="space-y-5 animate-fade-in max-w-5xl">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Settings</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Manage your store profile, suppliers and team</p>
      </div>

      <OwnerLockCard />
      <PhoneNotificationsCard />

      <div role="tablist" className="grid grid-cols-2 gap-1.5 bg-muted/40 border border-border/60 p-1 rounded-2xl sm:flex sm:flex-wrap sm:w-fit max-w-full">
        {TABS.map(tab => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn("flex items-center justify-center gap-2 px-4 py-2.5 sm:justify-start sm:py-2 rounded-xl text-xs font-semibold transition-all", activeTab === tab.key ? "bg-card text-foreground shadow-sm border border-border/60" : "text-muted-foreground hover:text-foreground")}
          >
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "store" && <StoreTab />}
      {activeTab === "suppliers" && <SuppliersTab />}
      {activeTab === "team" && <TeamTab />}
      {activeTab === "backup" && <BackupTab />}
      </div>
</>
  );
}

type BackupStatus = { configured: boolean; daily: boolean; last: { ok: boolean; details: string; at: string } | null };

/** Google Sheets backup: how the last one went, and buttons to send one now. */
function BackupTab() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [running, setRunning] = useState<"today" | "yesterday" | null>(null);

  async function load() {
    const result = await getBackupStatus().catch(() => null);
    setStatus(result?.ok ? result.data : null);
    setLoaded(true);
  }

  useEffect(() => {
    let alive = true;
    getBackupStatus()
      .catch(() => null)
      .then(result => {
        if (!alive) return;
        setStatus(result?.ok ? result.data : null);
        setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function run(day: "today" | "yesterday") {
    setRunning(day);
    const result = await mutate(() => backupToSheetsNow(day), {
      loading: `Backing up ${day} to Google Sheets…`,
      success: data => `Backed up ${data.date}: ${data.orders} order${data.orders === 1 ? "" : "s"} and ${data.customers} customers.`,
    });
    setRunning(null);
    if (result.ok || status) await load();
  }

  return (
    <div className="bg-card border border-border/80 rounded-2xl shadow-sm overflow-hidden">
      <div className="p-5 sm:p-6 border-b border-border/60">
        <h2 className="font-bold text-base">Google Sheets backup</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Every night at 00:15 Nepal time, the day&apos;s orders are added to the Sheet&apos;s Orders tab and the Customers tab is refreshed.
        </p>
      </div>

      <div className="p-5 sm:p-6 space-y-5">
        {!loaded ? (
          <div className="space-y-2"><div className="skeleton-shimmer h-4 w-48 rounded" /><div className="skeleton-shimmer h-3 w-72 rounded" /></div>
        ) : !status?.configured ? (
          <div className="rounded-xl border border-amber-300/60 bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            <p className="font-semibold">Not set up yet</p>
            <p className="mt-1 text-xs">
              Create the Sheet and its script, then add SHEETS_BACKUP_URL, SHEETS_BACKUP_SECRET, SHEETS_BACKUP_STORE_ID and CRON_SECRET to
              the server&apos;s environment. The steps are in <span className="font-mono">docs/google-sheets-backup.md</span>.
            </p>
          </div>
        ) : (
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border/60 p-4">
              <dt className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><Clock size={12} /> Daily backup</dt>
              <dd className={cn("mt-1 text-sm font-bold", status.daily ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
                {status.daily ? "On, every night at 00:15" : "Off for this store"}
              </dd>
              {!status.daily && <dd className="mt-0.5 text-[11px] text-muted-foreground">Set SHEETS_BACKUP_STORE_ID to this store and add CRON_SECRET.</dd>}
            </div>
            <div className="rounded-xl border border-border/60 p-4">
              <dt className="text-xs font-semibold text-muted-foreground">Last backup</dt>
              {status.last ? (
                <>
                  <dd className={cn("mt-1 flex items-center gap-1.5 text-sm font-bold", status.last.ok ? "text-foreground" : "text-red-600 dark:text-red-400")}>
                    {status.last.ok ? <CheckCircle2 size={14} className="text-emerald-500" /> : <XCircle size={14} />}
                    {new Date(status.last.at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                  </dd>
                  <dd className="mt-0.5 text-[11px] text-muted-foreground break-words">{status.last.details}</dd>
                </>
              ) : (
                <dd className="mt-1 text-sm text-muted-foreground">None yet</dd>
              )}
            </div>
          </dl>
        )}

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => run("today")} loading={running === "today"} disabled={running !== null || !status?.configured}>
            {running !== "today" && <CloudUpload size={15} />} Back up today
          </Button>
          <Button variant="secondary" onClick={() => run("yesterday")} loading={running === "yesterday"} disabled={running !== null || !status?.configured}>
            Back up yesterday
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Sending a day again replaces that day&apos;s rows in the Sheet, so nothing is duplicated. &quot;Today&quot; includes orders so far.
        </p>
      </div>
    </div>
  );
}
