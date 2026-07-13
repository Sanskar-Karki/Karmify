// karmify/app/page.tsx
"use client";

import React from "react";
import Link from "next/link";
import { SignInButton, SignUpButton, Show } from "@clerk/nextjs";
import {
  ArrowRight,
  ShieldCheck,
  Package,
  ShoppingCart,
  TrendingUp,
  ArrowLeftRight,
  Database,
  Zap,
} from "lucide-react";

const features = [
  {
    icon: Package,
    title: "Multi-Warehouse Inventory",
    desc: "Track stock splits across depots in real time.",
  },
  {
    icon: ShoppingCart,
    title: "Express POS Billing",
    desc: "Fast checkout with printable VAT tax invoices.",
  },
  {
    icon: TrendingUp,
    title: "Supplier Purchase Orders",
    desc: "Auto-restock upon completing purchase orders.",
  },
  {
    icon: ArrowLeftRight,
    title: "Real-time Stock Audits",
    desc: "Track logs, damages, adjustments & transfers.",
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-background flex flex-col font-sans text-foreground selection:bg-primary selection:text-primary-foreground">
      {/* Navbar */}
      <header className="sticky top-0 z-50 bg-card/80 backdrop-blur-md border-b border-border">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-black text-sm">
              K
            </div>
            <span className="font-bold text-base tracking-tight text-foreground">
              Karmify
            </span>
          </div>

          <Show when="signed-out">
            <SignInButton mode="modal">
              <button className="text-xs font-semibold text-muted-foreground hover:text-primary transition-colors cursor-pointer">
                Sign in
              </button>
            </SignInButton>
          </Show>

          <Show when="signed-in">
            <Link
              href="/dashboard"
              className="text-xs font-semibold text-primary hover:underline"
            >
              Dashboard →
            </Link>
          </Show>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-6 py-16 lg:py-24 grid lg:grid-cols-12 gap-12 items-center">
          {/* Left content */}
          <div className="lg:col-span-7 flex flex-col gap-7">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-semibold w-fit">
              <Zap size={12} />
              Built for Nepalese Businesses & Warehouses
            </div>

            <div className="space-y-3">
              <h1 className="text-4xl md:text-[56px] font-black tracking-tight leading-[1.08] text-foreground">
                Smart ERP &
                <br />
                <span className="text-primary">
                  Inventory Intelligence
                </span>
              </h1>
              <p className="text-base text-muted-foreground max-w-lg leading-relaxed">
                Real-time analytics, multi-warehouse tracking, dynamic supplier
                restocking, and an intuitive POS terminal built for Kathmandu
                hubs and branch showrooms.
              </p>
            </div>

            {/* Features grid */}
            <div className="grid sm:grid-cols-2 gap-3 mt-2">
              {features.map((f) => (
                <div
                  key={f.title}
                  className="flex gap-3 items-start p-3.5 bg-card rounded-xl border border-border group hover:border-primary/30 transition-colors"
                >
                  <div className="p-2 rounded-lg bg-muted text-primary shrink-0 group-hover:bg-primary/10 transition-colors">
                    <f.icon size={16} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm text-foreground">
                      {f.title}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      {f.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Login card */}
          <div className="lg:col-span-5 w-full flex justify-center">
            <div className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-xl shadow-black/5 overflow-hidden">
              {/* Top accent */}
              <div className="h-1 bg-primary" />

              <div className="p-7 flex flex-col gap-6">
                <div>
                  <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-primary-foreground font-black text-lg mb-4">
                    K
                  </div>
                  <h2 className="text-xl font-bold text-foreground">
                    Welcome back
                  </h2>
                  <p className="text-xs text-muted-foreground mt-1">
                    Sign in to access your business dashboard.
                  </p>
                </div>

                <div className="space-y-3">
                  <Show when="signed-out">
                    <SignInButton mode="modal">
                      <button className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm">
                        Sign in to Karmify
                        <ArrowRight size={15} />
                      </button>
                    </SignInButton>

                    <p className="text-center text-xs text-muted-foreground">
                      No account?{" "}
                      <SignUpButton mode="modal">
                        <button className="text-primary font-semibold hover:underline cursor-pointer">
                          Sign up free
                        </button>
                      </SignUpButton>
                    </p>
                  </Show>

                  <Show when="signed-in">
                    <Link
                      href="/dashboard"
                      className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer"
                    >
                      Go to Dashboard
                      <ArrowRight size={15} />
                    </Link>
                  </Show>
                </div>

                {/* Security badges */}
                <div className="flex items-center justify-between pt-1 border-t border-border">
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
                    <ShieldCheck size={11} />
                    <span>Secured by Clerk</span>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
                    <Database size={11} />
                    <span>Live Database</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-6 px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between text-[11px] text-muted-foreground/70">
          <span>&copy; {new Date().getFullYear()} Karmify ERP Systems</span>
          <span>Built for Kathmandu, designed for scale.</span>
        </div>
      </footer>
    </div>
  );
}
