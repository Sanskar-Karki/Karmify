"use client";

import { Skeleton } from "boneyard-js/react";
import { CustomersFixture } from "@/components/skeletons/fixtures";
import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  Search, Users, ChevronRight, MapPin, Phone,
} from "lucide-react";
import { getCustomers } from "@/app/actions";
import { cn } from "@/lib/utils";

export default function CustomersPage() {
  const [mounted, setMounted] = useState(false);
  const [customers, setCustomers] = useState<any[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    refresh().then(() => setMounted(true));
  }, []);

  async function refresh() {
    setCustomers(await getCustomers());
  }

  const filtered = customers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.phone ?? "").toLowerCase().includes(search.toLowerCase()) ||
    (c.address ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const totalRevenue = customers.reduce((s, c) => s + c.totalSpent, 0);
  const totalOrders = customers.reduce((s, c) => s + c.orderCount, 0);

  if (!mounted) return (
    <Skeleton name="customers" loading={true} fixture={<CustomersFixture />}>
      <CustomersFixture />
    </Skeleton>
  );

  return (
    <Skeleton name="customers" loading={false} fixture={<CustomersFixture />}>
      <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Customers</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Customer list & purchase history derived from sales records</p>
        </div>
        <div className="relative w-full md:w-72">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, phone or address..."
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: "Total Customers", val: customers.length, color: "blue" },
          { label: "Total Orders", val: totalOrders, color: "amber" },
          { label: "Total Revenue", val: `$${totalRevenue.toFixed(2)}`, color: "emerald" },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border/80 p-5 rounded-2xl shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground">{s.label}</p>
              <p className="text-3xl font-black mt-1">{s.val}</p>
            </div>
            <Users size={32} className={cn("opacity-10", s.color === "amber" ? "text-amber-500" : s.color === "emerald" ? "text-emerald-500" : "text-blue-500")} />
          </div>
        ))}
      </div>

      {/* Customer List */}
      <div className="space-y-3">
        {filtered.map(customer => (
          <Link
            key={customer.key}
            href={`/customers/${encodeURIComponent(customer.key)}`}
            className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-5 bg-card border border-border/80 rounded-2xl shadow-sm hover:border-primary/40 hover:shadow-md hover:shadow-primary/5 transition-all cursor-pointer"
          >
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-primary/10 border border-border/40 flex items-center justify-center shrink-0 font-bold text-sm text-primary/80">
                {customer.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="font-bold text-sm">{customer.name}</p>
                <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground">
                  {customer.phone && <span className="flex items-center gap-1"><Phone size={10} />{customer.phone}</span>}
                  {customer.address && <span className="flex items-center gap-1 truncate max-w-[220px]"><MapPin size={10} />{customer.address}</span>}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4 md:gap-6 shrink-0">
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground font-semibold">Orders</p>
                <p className="text-sm font-bold">{customer.orderCount}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground font-semibold">Total Spent</p>
                <p className="text-lg font-extrabold">${customer.totalSpent.toFixed(2)}</p>
              </div>
              <div className="text-right hidden md:block">
                <p className="text-[10px] text-muted-foreground font-semibold">Last Order</p>
                <p className="text-xs font-medium">{new Date(customer.lastOrderAt).toLocaleDateString()}</p>
              </div>
              <ChevronRight size={16} className="text-muted-foreground" />
            </div>
          </Link>
        ))}

        {filtered.length === 0 && (
          <div className="flex flex-col items-center py-16 text-center text-muted-foreground gap-2 bg-card border border-border/80 rounded-2xl">
            <Users size={36} className="opacity-30" />
            <p className="font-semibold text-sm">No customers found</p>
            <p className="text-xs">Customers appear here automatically once a sale records their name, phone or address.</p>
          </div>
        )}
      </div>
      </div>
    </Skeleton>
  );
}
