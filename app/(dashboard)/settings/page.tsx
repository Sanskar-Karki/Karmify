"use client";

import React, { useState } from "react";
import { useUser } from "@clerk/nextjs";
import {
  Settings, Store, Users, Plus, ShieldCheck, Shield, Save, MapPin, Phone, Mail, Globe,
  Truck, Edit2, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { deleteSupplier, saveSupplier } from "@/app/actions";
import { cn } from "@/lib/utils";
import { SupplierRowPlaceholder } from "@/components/skeletons/placeholders";
import { Modal } from "@/components/shared/Modal";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
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

      <div role="tablist" className="flex flex-wrap gap-1.5 bg-muted/40 border border-border/60 p-1 rounded-2xl w-fit max-w-full">
        {TABS.map(tab => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn("flex items-center gap-2 px-4 py-2.5 sm:py-2 rounded-xl text-xs font-semibold transition-all", activeTab === tab.key ? "bg-card text-foreground shadow-sm border border-border/60" : "text-muted-foreground hover:text-foreground")}
          >
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "store" && <StoreTab />}
      {activeTab === "suppliers" && <SuppliersTab />}
      {activeTab === "team" && <TeamTab />}
      </div>
</>
  );
}
