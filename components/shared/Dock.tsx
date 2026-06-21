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
    <nav className="fixed bottom-5 left-1/2 -translate-x-1/2 z-30 pt-16">
      <div
        onMouseLeave={() => setHovered(null)}
        className="relative flex items-center gap-3 px-5 py-3.5 rounded-full bg-black/10 backdrop-blur-xs border border-black "
      >
        {/* Glass sheen */}
        <div className="absolute inset-0 rounded-full bg-gradient-to-b from-white/20 via-white/0 to-black/20 pointer-events-none" />
        <div className="absolute inset-x-4 top-0.5 h-px bg-gradient-to-r from-transparent via-white/60 to-transparent pointer-events-none" />

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
              onMouseEnter={() => setHovered(i)}
              className="group relative flex flex-col items-center justify-center"
              style={{
                transform: `translateY(${-lift}px) scale(${scale})`,
                transition: "transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
              }}
            >
              {/* Tooltip */}
              <span className="absolute -top-12 px-3 py-2 rounded-lg bg-white/95 backdrop-blur-sm text-zinc-900 text-xs font-semibold opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100 transition-all duration-200 whitespace-nowrap pointer-events-none shadow-lg z-50">
                {item.name}
              </span>

              {/* Icon chip */}
              <div
                className={cn(
                  "relative flex items-center justify-center w-10 h-10 rounded-xl border transition-all duration-300 cursor-pointer",
                  isActive
                    ? "bg-white border border-red-800/20! text-black shadow-lg shadow-red-700/20"
                    : "bg-white/15 border-white/20 text-black/50 hover:bg-white/25 hover:border-white/30"
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
