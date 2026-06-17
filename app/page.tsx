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
    <div className="min-h-screen bg-[#EEEEEE] dark:bg-[#0f0f0f] flex flex-col font-sans text-[#0a0a0a] dark:text-[#EEEEEE] selection:bg-[#CB2957] selection:text-white">
      {/* Navbar */}
      <header className="sticky top-0 z-50 bg-white/80 dark:bg-[#0a0a0a]/80 backdrop-blur-md border-b border-[#DDDDDD] dark:border-[#222]">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#CB2957] flex items-center justify-center text-white font-black text-sm">
              K
            </div>
            <span className="font-bold text-base tracking-tight text-[#0a0a0a] dark:text-white">
              Karmify
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-medium text-[#0a0a0a]/50 dark:text-white/40">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Kathmandu Central
            </span>
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-6 py-16 lg:py-24 grid lg:grid-cols-12 gap-12 items-center">
          {/* Left content */}
          <div className="lg:col-span-7 flex flex-col gap-7">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#CB2957]/10 border border-[#CB2957]/20 text-[#CB2957] text-xs font-semibold w-fit">
              <Zap size={12} />
              Built for Nepalese Businesses & Warehouses
            </div>

            <div className="space-y-3">
              <h1 className="text-4xl md:text-[56px] font-black tracking-tight leading-[1.08] text-[#0a0a0a] dark:text-white">
                Smart ERP &
                <br />
                <span className="text-[#CB2957]">
                  Inventory Intelligence
                </span>
              </h1>
              <p className="text-base text-[#0a0a0a]/55 dark:text-white/50 max-w-lg leading-relaxed">
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
                  className="flex gap-3 items-start p-3.5 bg-white dark:bg-[#141414] rounded-xl border border-[#DDDDDD] dark:border-[#222] group hover:border-[#CB2957]/30 transition-colors"
                >
                  <div className="p-2 rounded-lg bg-[#EEEEEE] dark:bg-[#1a1a1a] text-[#CB2957] shrink-0 group-hover:bg-[#CB2957]/10 transition-colors">
                    <f.icon size={16} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm text-[#0a0a0a] dark:text-white">
                      {f.title}
                    </h3>
                    <p className="text-xs text-[#0a0a0a]/50 dark:text-white/40 mt-0.5 leading-relaxed">
                      {f.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Login card */}
          <div className="lg:col-span-5 w-full flex justify-center">
            <div className="w-full max-w-sm bg-white dark:bg-[#111] border border-[#DDDDDD] dark:border-[#222] rounded-2xl shadow-xl shadow-black/5 overflow-hidden">
              {/* Top accent */}
              <div className="h-1 bg-[#CB2957]" />

              <div className="p-7 flex flex-col gap-6">
                <div>
                  <div className="w-10 h-10 rounded-xl bg-[#CB2957] flex items-center justify-center text-white font-black text-lg mb-4">
                    K
                  </div>
                  <h2 className="text-xl font-bold text-[#0a0a0a] dark:text-white">
                    Welcome back
                  </h2>
                  <p className="text-xs text-[#0a0a0a]/45 dark:text-white/40 mt-1">
                    Sign in to access your business dashboard.
                  </p>
                </div>

                <div className="space-y-3">
                  <Show when="signed-out">
                    <SignInButton mode="modal">
                      <button className="w-full h-11 bg-[#CB2957] hover:bg-[#b02249] text-white text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm">
                        Sign in to Karmify
                        <ArrowRight size={15} />
                      </button>
                    </SignInButton>

                    <p className="text-center text-xs text-[#0a0a0a]/40 dark:text-white/30">
                      No account?{" "}
                      <SignUpButton mode="modal">
                        <button className="text-[#CB2957] font-semibold hover:underline cursor-pointer">
                          Sign up free
                        </button>
                      </SignUpButton>
                    </p>
                  </Show>

                  <Show when="signed-in">
                    <Link
                      href="/dashboard"
                      className="w-full h-11 bg-[#CB2957] hover:bg-[#b02249] text-white text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer"
                    >
                      Go to Dashboard
                      <ArrowRight size={15} />
                    </Link>
                  </Show>
                </div>

                {/* Security badges */}
                <div className="flex items-center justify-between pt-1 border-t border-[#DDDDDD] dark:border-[#222]">
                  <div className="flex items-center gap-1 text-[10px] text-[#0a0a0a]/35 dark:text-white/25">
                    <ShieldCheck size={11} />
                    <span>Secured by Clerk</span>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-[#0a0a0a]/35 dark:text-white/25">
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
      <footer className="border-t border-[#DDDDDD] dark:border-[#1a1a1a] py-6 px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between text-[11px] text-[#0a0a0a]/35 dark:text-white/25">
          <span>&copy; {new Date().getFullYear()} Karmify ERP Systems</span>
          <span>Built for Kathmandu, designed for scale.</span>
        </div>
      </footer>
    </div>
  );
}
