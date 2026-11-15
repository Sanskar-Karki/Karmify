"use client";

import React, { useLayoutEffect, useRef, useState } from "react";
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
  { name: "Inventory", href: "/inventory", icon: ArrowLeftRight },
  { name: "Products", href: "/products", icon: Package },
  { name: "Customers", href: "/customers", icon: Users },
  // Purchases is hidden for now (the page still exists at /purchases).
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

const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";

const isActiveFor = (pathname: string, href: string) => pathname === href || pathname.startsWith(href + "/");

/**
 * The bottom navigation. The highlight slides to the tapped item straight
 * away (before the page has loaded), the icons magnify around the pointer on
 * computers, and each press gives a small squeeze so taps feel answered.
 */
export function Dock() {
  const pathname = usePathname();
  const [hovered, setHovered] = useState<number | null>(null);
  // The item just tapped, shown as active until the route catches up.
  const [pending, setPending] = useState<number | null>(null);
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setPending(null);
  }

  const routeIndex = dockItems.findIndex(item => isActiveFor(pathname, item.href));
  const activeIndex = pending ?? routeIndex;

  const chipRefs = useRef<(HTMLDivElement | null)[]>([]);
  const indicatorRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const lastRect = useRef<DOMRect | null>(null);

  // Slide the highlight from where it was to the new item (a FLIP animation:
  // the highlight lives in the active chip, so it also follows magnification
  // and the dock growing/shrinking, and starts drawn at the old spot).
  useLayoutEffect(() => {
    const chip = activeIndex >= 0 ? chipRefs.current[activeIndex] : null;
    const indicator = activeIndex >= 0 ? indicatorRefs.current[activeIndex] : null;
    if (!chip || !indicator) {
      lastRect.current = null;
      return;
    }
    const rect = chip.getBoundingClientRect();
    const from = lastRect.current;
    lastRect.current = rect;
    if (!from || from.left === rect.left || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    indicator.animate(
      [
        { transform: `translateX(${from.left - rect.left}px) scale(${from.width / rect.width}, ${from.height / rect.height})` },
        { transform: "none" },
      ],
      { duration: 460, easing: SPRING }
    );
  }, [activeIndex]);

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
          const isActive = i === activeIndex;
          const Icon = item.icon;
          const distance = hovered === null ? Infinity : Math.abs(hovered - i);

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.name}
              aria-current={i === routeIndex ? "page" : undefined}
              onMouseEnter={() => { setHovered(i); prefetchRoute(item.href); }}
              onTouchStart={() => prefetchRoute(item.href)}
              onClick={e => {
                // New tab/window clicks don't navigate here, so they don't move the highlight.
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                if (i !== routeIndex) setPending(i);
              }}
              className="dock-item group relative flex flex-col items-center justify-center"
              style={{
                transform: `translateY(${-liftFor(distance)}px) scale(${scaleFor(distance)})`,
                transition: `transform 0.35s ${SPRING}`,
              }}
            >
              {/* Tooltip (pointer devices only — hover never fires on touch) */}
              <span className="absolute -top-12 px-3 py-2 rounded-lg bg-popover border border-border backdrop-blur-sm text-popover-foreground text-xs font-semibold opacity-0 scale-75 translate-y-1 group-hover:opacity-100 group-hover:scale-100 group-hover:translate-y-0 group-focus-visible:opacity-100 group-focus-visible:scale-100 group-focus-visible:translate-y-0 transition-all duration-200 whitespace-nowrap pointer-events-none shadow-lg z-50 hidden sm:block">
                {item.name}
              </span>

              {/* Icon chip — 44px min touch target on mobile */}
              <div
                ref={el => { chipRefs.current[i] = el; }}
                className={cn(
                  "dock-chip relative flex items-center justify-center w-11 h-11 sm:w-10 sm:h-10 rounded-xl border cursor-pointer",
                  isActive
                    ? "border-primary/30 text-primary-foreground"
                    : "bg-white/35 dark:bg-white/5 border-white/50 dark:border-white/10 text-muted-foreground hover:bg-white/60 dark:hover:bg-white/10 hover:text-foreground"
                )}
              >
                {isActive && (
                  <span
                    ref={el => { indicatorRefs.current[i] = el; }}
                    aria-hidden
                    className="dock-indicator absolute -inset-px rounded-[inherit] bg-primary shadow-lg shadow-primary/30"
                  />
                )}
                {/* Re-keyed on activation so the icon gives a little hop. */}
                <span key={isActive ? "on" : "off"} className={cn("relative flex", isActive && "dock-pop")}>
                  <Icon size={18} strokeWidth={isActive ? 2.25 : 2} />
                </span>
              </div>

              {/* Active dot under the chip (phones, where there are no tooltips) */}
              <span
                aria-hidden
                className={cn(
                  "absolute -bottom-2 h-1 w-1 rounded-full bg-primary transition-all duration-300 sm:hidden",
                  isActive ? "opacity-100 scale-100" : "opacity-0 scale-0"
                )}
              />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
