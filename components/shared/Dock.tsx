"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { prefetchRoute } from "@/lib/prefetch";
import {
  LayoutDashboard,
  ChartColumn,
  Package,
  ArrowLeftRight,
  ShoppingCart,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";

interface DockItem {
  name: string;
  href: string;
  icon: LucideIcon;
}

const dockItems: DockItem[] = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Analytics", href: "/analytics", icon: ChartColumn },
  { name: "Customers", href: "/customers", icon: Users },
  { name: "Products", href: "/products", icon: Package },
  { name: "Inventory", href: "/inventory", icon: ArrowLeftRight },
  { name: "Purchases", href: "/purchases", icon: TrendingUp },
  { name: "POS & Sales", href: "/sales", icon: ShoppingCart },
];

// Magnification falls off smoothly with distance from the hovered icon,
// mimicking the springy macOS dock feel.
function scaleFor(distance: number) {
  if (distance === 0) return 1.25;
  if (distance === 1) return 1.12;
  if (distance === 2) return 1.04;
  return 1;
}

function liftFor(distance: number) {
  if (distance === 0) return 3;
  if (distance === 1) return 1;
  return 0;
}

export function Dock() {
  const pathname = usePathname();
  const [hovered, setHovered] = useState<number | null>(null);

  return (
    <nav
      aria-label="Main navigation"
      className="dock fixed left-1/2 -translate-x-1/2 z-30 max-w-[calc(100vw-1rem)]"
      style={{ bottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
    >
      <div
        onMouseLeave={() => setHovered(null)}
        className="dock-bar relative flex items-center gap-1.5 sm:gap-3 px-2.5 sm:px-5 py-2.5 sm:py-3.5 rounded-full"
      >
        {/* Glass sheen */}
        <div className="absolute inset-0 rounded-full bg-gradient-to-b from-white/10 via-transparent to-black/5 pointer-events-none" />
        <div className="absolute inset-x-4 top-0.5 h-px bg-gradient-to-r from-transparent via-foreground/20 to-transparent pointer-events-none" />

        {dockItems.map((item, i) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          const distance = hovered === null ? Infinity : Math.abs(hovered - i);
          const scale = scaleFor(distance);
          const lift = liftFor(distance);

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.name}
              aria-current={isActive ? "page" : undefined}
              onMouseEnter={() => { setHovered(i); prefetchRoute(item.href); }}
              onTouchStart={() => prefetchRoute(item.href)}
              className="group relative flex flex-col items-center justify-center"
              style={{
                transform: `translateY(${-lift}px) scale(${scale})`,
                transition: "transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
              }}
            >
              {/* Tooltip (pointer devices only — hover never fires on touch) */}
              <span className="absolute -top-12 px-3 py-2 rounded-lg bg-popover border border-border backdrop-blur-sm text-popover-foreground text-xs font-semibold opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100 group-focus-visible:opacity-100 group-focus-visible:scale-100 transition-all duration-200 whitespace-nowrap pointer-events-none shadow-lg z-50 hidden sm:block">
                {item.name}
              </span>

              {/* Icon chip — 44px min touch target on mobile */}
              <div
                className={cn(
                  "dock-chip relative flex items-center justify-center w-11 h-11 sm:w-10 sm:h-10 rounded-xl border cursor-pointer",
                  isActive
                    ? "bg-primary border-primary/30 text-primary-foreground shadow-lg shadow-primary/30"
                    : "bg-white/35 dark:bg-white/5 border-white/50 dark:border-white/10 text-muted-foreground hover:bg-white/60 dark:hover:bg-white/10 hover:text-foreground"
                )}
              >
                <Icon size={18} strokeWidth={2} />
              </div>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
