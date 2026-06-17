"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Package,
  ArrowLeftRight,
  ShoppingCart,
  TrendingUp,
  Settings,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Users,
} from "lucide-react";

interface SidebarItem {
  name: string;
  href: string;
  icon: React.ComponentType<any>;
}

const sidebarItems: SidebarItem[] = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Products", href: "/products", icon: Package },
  { name: "Inventory", href: "/inventory", icon: ArrowLeftRight },
  { name: "POS & Sales", href: "/sales", icon: ShoppingCart },
  { name: "Purchases", href: "/purchases", icon: TrendingUp },
  { name: "Customers", href: "/customers", icon: Users },
];

export function Sidebar() {
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(false);

  const user = {
    name: "Sanskar Karki",
    email: "sanskar@karmify.com",
    role: "ADMIN",
  };

  return (
    <aside
      className={cn(
        "relative flex flex-col h-screen bg-sidebar-background border-r border-sidebar-border transition-all duration-300 z-20",
        isCollapsed ? "w-[68px]" : "w-60"
      )}
    >
      {/* Brand Header */}
      <div className={cn(
        "flex items-center h-16 border-b border-sidebar-border shrink-0",
        isCollapsed ? "justify-center px-4" : "justify-between px-4"
      )}>
        <Link href="/dashboard" className="flex items-center gap-2.5 min-w-0">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-primary-foreground font-black text-sm shrink-0">
            K
          </div>
          {!isCollapsed && (
            <span className="text-sm font-bold tracking-tight text-sidebar-foreground truncate">
              Karmify
            </span>
          )}
        </Link>
        {!isCollapsed && (
          <button
            onClick={() => setIsCollapsed(true)}
            className="flex items-center justify-center w-6 h-6 rounded-md hover:bg-sidebar-accent text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors shrink-0"
          >
            <ChevronLeft size={14} />
          </button>
        )}
        {isCollapsed && (
          <button
            onClick={() => setIsCollapsed(false)}
            className="absolute -right-3 top-[26px] flex items-center justify-center w-6 h-6 rounded-full bg-sidebar-background border border-sidebar-border text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors z-10"
          >
            <ChevronRight size={12} />
          </button>
        )}
      </div>

      {/* Nav Label */}
      {!isCollapsed && (
        <div className="px-4 pt-4 pb-1">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/30">
            Navigation
          </span>
        </div>
      )}

      {/* Navigation Items */}
      <nav className="flex-1 px-2.5 py-2 space-y-0.5 overflow-y-auto">
        {sidebarItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg text-sm font-medium transition-all group relative",
                isCollapsed ? "justify-center w-10 h-10 mx-auto" : "px-3 py-2.5",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              )}
            >
              <Icon
                size={17}
                className={cn("shrink-0", isActive ? "text-current" : "")}
              />
              {!isCollapsed && <span className="truncate">{item.name}</span>}

              {/* Active indicator bar */}
              {isActive && !isCollapsed && (
                <span className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-l-full bg-primary-foreground/40" />
              )}

              {/* Collapsed tooltip */}
              {isCollapsed && (
                <div className="absolute left-full ml-3 px-2.5 py-1.5 rounded-lg bg-foreground text-background text-xs font-semibold opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 shadow-lg">
                  {item.name}
                </div>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className={cn(
        "border-t border-sidebar-border",
        isCollapsed ? "p-2" : "p-3 space-y-1"
      )}>
        {!isCollapsed && (
          <Link
            href="/settings"
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
              pathname === "/settings"
                ? "bg-sidebar-accent text-sidebar-foreground"
                : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            )}
          >
            <Settings size={17} className="shrink-0" />
            <span>Settings</span>
          </Link>
        )}

        {/* User Card */}
        <div className={cn(
          "flex items-center gap-2.5 rounded-lg bg-sidebar-accent/60 border border-sidebar-border/50",
          isCollapsed ? "justify-center p-2" : "px-3 py-2.5"
        )}>
          <div className="flex items-center justify-center w-7 h-7 rounded-full bg-primary/20 text-primary font-bold text-xs shrink-0">
            {user.name.charAt(0)}
          </div>
          {!isCollapsed && (
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1">
                <p className="text-xs font-semibold text-sidebar-foreground truncate">
                  {user.name}
                </p>
                {user.role === "ADMIN" && (
                  <ShieldCheck size={11} className="text-primary shrink-0" />
                )}
              </div>
              <p className="text-[10px] text-sidebar-foreground/40 truncate">
                {user.email}
              </p>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
