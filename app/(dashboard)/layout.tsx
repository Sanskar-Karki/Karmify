"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Dock } from "@/components/shared/Dock";
import { GlobalSearch } from "@/components/shared/GlobalSearch";
import { Moon, Sun, Settings } from "lucide-react";
import { UserButton } from "@clerk/nextjs";
import { Toaster } from "sonner";
import { prefetchAllRoutesOnce } from "@/lib/prefetch";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);

  // Warm every dockable route's data in the background shortly after the
  // shell mounts, so clicking a nav item usually finds a resolved cache
  // entry instead of triggering a fresh fetch.
  useEffect(() => {
    prefetchAllRoutesOnce();
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
          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors border border-border"
            aria-label="Toggle theme"
          >
            {theme === "light" ? <Moon size={15} /> : <Sun size={15} />}
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
      <main className="flex-1 overflow-y-auto px-3 md:px-4 pt-3 md:pt-4 pb-22">
        <div className="w-full animate-fade-in">
          {children}
        </div>
      </main>

      <Dock />
      <Toaster position="top-center" richColors theme={theme} />
    </div>
  );
}
