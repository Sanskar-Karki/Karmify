"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Dock } from "@/components/shared/Dock";
import { GlobalSearch } from "@/components/shared/GlobalSearch";
import { Bell, Moon, Sun, Settings } from "lucide-react";
import { UserButton } from "@clerk/nextjs";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const savedTheme = localStorage.getItem("theme") as "light" | "dark" | null;
    const initialTheme = savedTheme || "light";
    setTheme(initialTheme);

    if (initialTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === "light" ? "dark" : "light";
    setTheme(newTheme);
    localStorage.setItem("theme", newTheme);

    if (newTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Topbar */}
      <header className="flex items-center justify-between h-18 px-5 bg-card border-b border-border shrink-0">
        {/* Brand */}
        <Link href="/dashboard" className="flex items-center gap-2.5 min-w-0 shrink-0">
          <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground font-black text-sm shrink-0 shadow-md shadow-primary/30">
            K
          </div>
          <span className="hidden sm:inline text-sm font-extrabold tracking-tight text-foreground truncate">
            Karmify
          </span>
        </Link>

        {/* Search */}
        <GlobalSearch />

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

          {/* Settings */}
          <Link
            href="/settings"
            className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors border border-border"
            aria-label="Settings"
          >
            <Settings size={15} />
          </Link>

          {/* Profile */}
          <UserButton afterSwitchSessionUrl="/dashboard" />
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 overflow-y-auto px-3 md:px-4 py-3 md:py-4 pb-28">
        <div className="w-full animate-fade-in">
          {children}
        </div>
      </main>

      <Dock />
    </div>
  );
}
