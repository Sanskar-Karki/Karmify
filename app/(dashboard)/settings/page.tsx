"use client";

import { Skeleton } from "boneyard-js/react";
import { SettingsFixture } from "@/components/skeletons/fixtures";
import React, { useState, useEffect } from "react";
import {
  Settings, Store, Users, Warehouse, Plus, Edit2, X,
  ShieldCheck, Shield, User, Save, Check, Trash2, MapPin, Phone, Mail, Globe
} from "lucide-react";
import {
  getWarehouses, saveWarehouse, deleteWarehouse,
} from "@/app/actions";
import { cn } from "@/lib/utils";

const MOCK_TEAM = [
  { id: "u-1", name: "Sanskar Karki", email: "sanskar@karmify.com", role: "ADMIN", avatar: "S", active: true },
  { id: "u-2", name: "Priya Sharma", email: "priya@karmify.com", role: "MANAGER", avatar: "P", active: true },
  { id: "u-3", name: "Raju Tamang", email: "raju@karmify.com", role: "STAFF", avatar: "R", active: true },
];

const TABS = [
  { key: "store", label: "Store Identity", icon: Store },
  { key: "team", label: "Team Members", icon: Users },
  { key: "warehouses", label: "Warehouses", icon: Warehouse },
];

export default function SettingsPage() {
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState("store");
  const [saved, setSaved] = useState(false);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [showWhModal, setShowWhModal] = useState(false);
  const [editWhId, setEditWhId] = useState<string | null>(null);
  const [whForm, setWhForm] = useState({ name: "", location: "", description: "" });

  const [storeForm, setStoreForm] = useState({
    name: "Karmify ERP Systems",
    tagline: "Smart Inventory & ERP for Nepalese Businesses",
    address: "Koteshwor, Kathmandu, Nepal",
    phone: "+977 9851012345",
    email: "admin@karmify.com",
    website: "https://karmify.com",
    currency: "USD",
    taxId: "601-234-5678",
  });

  useEffect(() => {
    getWarehouses().then(whs => { setWarehouses(whs); setMounted(true); });
  }, []);

  function handleSaveStore() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
  }

  function openAddWh() {
    setEditWhId(null);
    setWhForm({ name: "", location: "", description: "" });
    setShowWhModal(true);
  }

  function openEditWh(wh: any) {
    setEditWhId(wh.id);
    setWhForm({ name: wh.name, location: wh.location, description: wh.description ?? "" });
    setShowWhModal(true);
  }

  async function handleSaveWh() {
    if (!whForm.name || !whForm.location) return;
    await saveWarehouse(whForm, editWhId);
    setWarehouses(await getWarehouses());
    setShowWhModal(false);
  }

  async function handleDeleteWh(id: string) {
    await deleteWarehouse(id);
    setWarehouses(await getWarehouses());
  }

  if (!mounted) return (
    <Skeleton name="settings" loading={true} fixture={<SettingsFixture />}>
      <SettingsFixture />
    </Skeleton>
  );

  return (
    <Skeleton name="settings" loading={false} fixture={<SettingsFixture />}>
      <div className="space-y-6 animate-fade-in max-w-5xl">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Settings</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Manage your store profile, team and warehouse configuration</p>
      </div>

      <div className="flex gap-1.5 bg-muted/40 border border-border/60 p-1 rounded-2xl w-fit">
        {TABS.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={cn("flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer", activeTab === tab.key ? "bg-card text-foreground shadow-sm border border-border/60" : "text-muted-foreground hover:text-foreground")}>
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Store Identity Tab */}
      {activeTab === "store" && (
        <div className="bg-card border border-border/80 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-6 border-b border-border/60">
            <h2 className="font-bold text-base">Store Identity</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Core information about your business entity</p>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-5">
            {[
              { label: "Store Name", icon: Store, key: "name" },
              { label: "Tagline", icon: Settings, key: "tagline" },
              { label: "Address", icon: MapPin, key: "address" },
              { label: "Phone", icon: Phone, key: "phone" },
              { label: "Email", icon: Mail, key: "email" },
              { label: "Website", icon: Globe, key: "website" },
              { label: "Currency", icon: Settings, key: "currency" },
              { label: "Tax / VAT ID", icon: Shield, key: "taxId" },
            ].map(field => (
              <div key={field.key} className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                  <field.icon size={12} />{field.label}
                </label>
                <input
                  value={(storeForm as any)[field.key]}
                  onChange={e => setStoreForm(f => ({ ...f, [field.key]: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                />
              </div>
            ))}
          </div>
          <div className="px-6 pb-6">
            <button onClick={handleSaveStore} className={cn("flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-xl transition-all cursor-pointer", saved ? "bg-emerald-500 text-white" : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-md shadow-primary/10")}>
              {saved ? <Check size={16} /> : <Save size={16} />}
              {saved ? "Saved Successfully!" : "Save Changes"}
            </button>
          </div>
        </div>
      )}

      {/* Team Members Tab */}
      {activeTab === "team" && (
        <div className="space-y-4">
          <div className="bg-card border border-border/80 rounded-2xl shadow-sm overflow-hidden">
            <div className="p-6 border-b border-border/60 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-base">Team Members</h2>
                <p className="text-xs text-muted-foreground mt-0.5">View user roster and manage role assignments (Backend auth will activate these)</p>
              </div>
              <button className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-primary/10 text-primary border border-primary/20 rounded-xl hover:bg-primary/20 transition-colors cursor-pointer">
                <Plus size={13} />
                Invite Member
              </button>
            </div>
            <div className="divide-y divide-border/40">
              {MOCK_TEAM.map(member => (
                <div key={member.id} className="flex items-center gap-4 p-5 group hover:bg-muted/10 transition-colors">
                  <div className={cn("w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0", member.role === "ADMIN" ? "bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300" : member.role === "MANAGER" ? "bg-indigo-100 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300" : "bg-muted text-muted-foreground")}>
                    {member.avatar}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-foreground">{member.name}</p>
                      {member.role === "ADMIN" && <ShieldCheck size={14} className="text-blue-600 dark:text-blue-400 shrink-0" />}
                    </div>
                    <p className="text-xs text-muted-foreground">{member.email}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={cn("text-[10px] font-bold uppercase px-2.5 py-1 rounded-full", member.role === "ADMIN" ? "bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400" : member.role === "MANAGER" ? "bg-indigo-100 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-400" : "bg-muted text-muted-foreground")}>
                      {member.role}
                    </span>
                    <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 px-2 py-0.5 rounded-full">Active</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="p-5 bg-amber-50/50 dark:bg-amber-950/10 border border-amber-200/40 dark:border-amber-900/30 rounded-2xl text-xs text-amber-700 dark:text-amber-400 flex gap-2">
            <Settings size={14} className="shrink-0 mt-0.5" />
            <span>Team authentication, role enforcement and invitations require the backend Clerk integration to be enabled. This view is for UI planning purposes only.</span>
          </div>
        </div>
      )}

      {/* Warehouses Tab */}
      {activeTab === "warehouses" && (
        <div className="bg-card border border-border/80 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-6 border-b border-border/60 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-base">Warehouse Configuration</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{warehouses.length} active nodes in your network</p>
            </div>
            <button onClick={openAddWh} className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 shadow-md shadow-primary/10 cursor-pointer">
              <Plus size={13} />
              Add Warehouse
            </button>
          </div>

          <div className="divide-y divide-border/40">
            {warehouses.map(wh => (
              <div key={wh.id} className="flex items-center gap-4 p-5 group hover:bg-muted/10 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-950/30 border border-border/40 flex items-center justify-center shrink-0">
                  <Warehouse size={18} className="text-indigo-600 dark:text-indigo-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-foreground">{wh.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1"><MapPin size={10} />{wh.location}</p>
                  {wh.description && <p className="text-[10px] text-muted-foreground/70 mt-0.5">{wh.description}</p>}
                </div>
                <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => openEditWh(wh)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"><Edit2 size={13} /></button>
                  <button onClick={() => handleDeleteWh(wh.id)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 text-muted-foreground hover:text-red-500 cursor-pointer"><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Warehouse Add/Edit Modal */}
      {showWhModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-border">
              <h2 className="font-bold text-lg">{editWhId ? "Edit Warehouse" : "Add New Warehouse"}</h2>
              <button onClick={() => setShowWhModal(false)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-muted cursor-pointer"><X size={16} /></button>
            </div>
            <div className="p-6 space-y-4">
              {[
                { label: "Warehouse Name", key: "name", placeholder: "e.g. Lalitpur Storage Hub" },
                { label: "Location", key: "location", placeholder: "e.g. Patan, Lalitpur" },
                { label: "Description", key: "description", placeholder: "Short description..." },
              ].map(f => (
                <div key={f.key} className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">{f.label}</label>
                  <input value={(whForm as any)[f.key]} onChange={e => setWhForm(wf => ({ ...wf, [f.key]: e.target.value }))} placeholder={f.placeholder} className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
                </div>
              ))}
            </div>
            <div className="flex gap-3 p-6 border-t border-border">
              <button onClick={() => setShowWhModal(false)} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-semibold hover:bg-muted cursor-pointer">Cancel</button>
              <button onClick={handleSaveWh} className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 cursor-pointer shadow-md shadow-primary/10">{editWhId ? "Save Changes" : "Add Warehouse"}</button>
            </div>
          </div>
        </div>
      )}
      </div>
    </Skeleton>
  );
}
