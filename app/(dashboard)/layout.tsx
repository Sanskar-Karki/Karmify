"use client";

import React, { useState } from "react";
import { Sidebar } from "@/components/shared/Sidebar";
import { Bell, Search, Moon, Sun } from "lucide-react";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  const toggleTheme = () => {
    const newTheme = theme === "light" ? "dark" : "light";
    setTheme(newTheme);
    if (newTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <Sidebar />

      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Topbar */}
        <header className="flex items-center justify-between h-14 px-5 bg-card border-b border-border shrink-0">
          {/* Search */}
          <div className="relative w-64 hidden md:block">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              size={14}
            />
            <input
              type="text"
              placeholder="Search SKUs, invoices, actions…"
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-border bg-background focus:bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 text-xs text-foreground placeholder:text-muted-foreground/50 transition-all"
            />
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-2 ml-auto">
            {/* System status */}
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted border border-border text-[10px] font-medium text-muted-foreground">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Kathmandu Central
            </div>

            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors border border-border"
              aria-label="Toggle theme"
            >
              {theme === "light" ? <Moon size={15} /> : <Sun size={15} />}
            </button>

            {/* Notifications */}
            <button
              className="relative flex items-center justify-center w-8 h-8 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors border border-border"
              aria-label="Notifications"
            >
              <Bell size={15} />
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-primary" />
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-5 md:p-7">
          <div className="max-w-7xl mx-auto animate-fade-in">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
