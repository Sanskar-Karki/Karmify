"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { prefetchRoute } from "@/lib/prefetch";
import {
  LayoutDashboard,
  Package,
  ArrowLeftRight,
  ShoppingCart,
  TrendingUp,
  Users,
} from "lucide-react";

interface DockItem {
  name: string;
  href: string;
  icon: React.ComponentType<any>;
}

const dockItems: DockItem[] = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
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
    <nav className="fixed bottom-2 left-1/2 -translate-x-1/2 z-30 pt-16">
      <div
        onMouseLeave={() => setHovered(null)}
        className="relative flex items-center gap-3 px-5 py-3.5 rounded-full bg-card/70 backdrop-blur-md border border-border/60 shadow-lg shadow-black/10"
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
              onMouseEnter={() => { setHovered(i); prefetchRoute(item.href); }}
              onTouchStart={() => prefetchRoute(item.href)}
              className="group relative flex flex-col items-center justify-center"
              style={{
                transform: `translateY(${-lift}px) scale(${scale})`,
                transition: "transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
              }}
            >
              {/* Tooltip */}
              <span className="absolute -top-12 px-3 py-2 rounded-lg bg-popover border border-border backdrop-blur-sm text-popover-foreground text-xs font-semibold opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100 transition-all duration-200 whitespace-nowrap pointer-events-none shadow-lg z-50">
                {item.name}
              </span>

              {/* Icon chip */}
              <div
                className={cn(
                  "relative flex items-center justify-center w-10 h-10 rounded-xl border transition-all duration-300 cursor-pointer",
                  isActive
                    ? "bg-primary border-primary/30 text-primary-foreground shadow-lg shadow-primary/30"
                    : "bg-foreground/5 border-foreground/10 text-muted-foreground hover:bg-foreground/10 hover:border-foreground/20 hover:text-foreground"
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
