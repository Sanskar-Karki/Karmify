"use client";

import React, { Suspense, useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { Dock } from "@/components/shared/Dock";
import { GlobalSearch } from "@/components/shared/GlobalSearch";
import { NotificationBell } from "@/components/shared/NotificationBell";
import { OfflineBanner } from "@/components/shared/OfflineBanner";
import { ShopSwitch } from "@/components/shared/ShopSwitch";
import { AlertTriangle, CheckCircle2, Info, Loader2, Moon, Sun, Settings, XCircle } from "lucide-react";
import { UserButton, useAuth } from "@clerk/nextjs";
import { Toaster } from "sonner";
import { prefetchAllRoutesOnce } from "@/lib/prefetch";
import { bindCacheToUser } from "@/lib/resourceCache";

type Theme = "light" | "dark";

const TOAST_ICONS = {
  success: <CheckCircle2 size={17} />,
  error: <XCircle size={17} />,
  warning: <AlertTriangle size={17} />,
  info: <Info size={17} />,
  loading: <Loader2 size={17} className="animate-spin" />,
};

// Clears the top bar, so a toast never covers search or notifications.
const TOAST_OFFSET = { top: "calc(env(safe-area-inset-top) + 5rem)", right: "1rem" };

function subscribeToTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

const readTheme = (): Theme => (document.documentElement.classList.contains("dark") ? "dark" : "light");
const serverTheme = (): Theme => "light";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const theme = useSyncExternalStore(subscribeToTheme, readTheme, serverTheme);
  const { userId } = useAuth();

  // Runs during render so it happens before any page under this layout reads
  // the cache. It's idempotent and doesn't notify subscribers.
  bindCacheToUser(userId);

  // Warm every dockable route's data in the background shortly after the
  // shell mounts, so clicking a nav item usually finds data already loaded.
  useEffect(() => {
    prefetchAllRoutesOnce();
  }, []);

  const toggleTheme = () => {
    // Read from the page, not from `theme`: the profile menu (Clerk) may hold on to an older copy of this function.
    const next = document.documentElement.classList.contains("dark") ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    // The phone's status bar follows (its meta tag is added by the script in app/layout.tsx).
    document.getElementById("app-theme-color")?.setAttribute("content", next === "dark" ? "#171717" : "#ffffff");
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Private browsing: the theme still applies for this visit.
    }
  };

  return (
    <div className="flex flex-col h-dvh w-full overflow-hidden bg-background text-foreground">
      {/* Topbar */}
      {/* Taller by the notch/status bar height when the installed app draws under it. */}
      <header
        className="relative z-30 flex items-center justify-between gap-2 h-[calc(4rem+env(safe-area-inset-top))] sm:h-[calc(4.5rem+env(safe-area-inset-top))] px-3 sm:px-5 bg-card/80 backdrop-blur-xl border-b border-border/70 shadow-[0_1px_0_rgba(0,0,0,0.02)] shrink-0"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        {/* Brand */}
        <Link href="/dashboard" className="flex items-center gap-2.5 min-w-0 shrink-0" aria-label="Karmify dashboard">
          <div aria-hidden className="flex items-center justify-center w-9 h-9 rounded-2xl bg-gradient-to-br from-primary to-primary/75 text-primary-foreground font-display font-extrabold text-base shrink-0 shadow-lg shadow-primary/25">
            K
          </div>
          <span className="hidden sm:inline font-display text-base font-extrabold tracking-tight text-foreground truncate">
            Karmify
          </span>
        </Link>

        {/* Which shop every page shows */}
        <ShopSwitch />

        {/* Search */}
        <GlobalSearch />

        {/* Right actions */}
        <div className="flex items-center gap-1.5 sm:gap-2 ml-auto shrink-0">
          <NotificationBell />

          {/* Theme toggle and Settings: in the bar from tablet size up; on phones,
              where the bar is full, they're in the profile menu instead (below). */}
          <button
            onClick={toggleTheme}
            className="hidden sm:flex items-center justify-center w-8 h-8 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors border border-border"
            aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
          >
            {theme === "light" ? <Moon size={15} /> : <Sun size={15} />}
          </button>

          <Link
            href="/settings"
            className="hidden sm:flex items-center justify-center w-8 h-8 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors border border-border"
            aria-label="Settings"
          >
            <Settings size={15} />
          </Link>

          {/* Profile, with Settings and the theme in its menu */}
          <span className="flex items-center justify-center w-10 h-10 sm:w-auto sm:h-auto">
            <UserButton afterSwitchSessionUrl="/dashboard" appearance={{ elements: { userButtonAvatarBox: "w-9 h-9 sm:w-7 sm:h-7" } }}>
              <UserButton.MenuItems>
                <UserButton.Link label="Settings" labelIcon={<Settings size={15} />} href="/settings" />
                <UserButton.Action
                  label={theme === "light" ? "Dark theme" : "Light theme"}
                  labelIcon={theme === "light" ? <Moon size={15} /> : <Sun size={15} />}
                  onClick={toggleTheme}
                />
              </UserButton.MenuItems>
            </UserButton>
          </span>
        </div>
      </header>

      <OfflineBanner />

      {/* Page content */}
      {/* Bottom padding keeps the last rows clear of the tab bar (phones) or dock. */}
      <main className="flex-1 overflow-y-auto overscroll-contain px-3 md:px-4 pt-3 md:pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-22">
        <Suspense>
          {children}
        </Suspense>
      </main>

      <Dock />
      <Toaster
        position="top-right"
        closeButton
        theme={theme}
        duration={4000}
        gap={10}
        visibleToasts={4}
        icons={TOAST_ICONS}
        offset={TOAST_OFFSET}
        mobileOffset={TOAST_OFFSET}
      />
    </div>
  );
}
