"use client";

import React, { useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { prefetchRoute } from "@/lib/prefetch";
import { useOwnerUnlocked } from "@/lib/ownerLock";
import { isOwnerPath } from "@/lib/ownerPaths";
import {
  LayoutDashboard,
  ChartColumn,
  Package,
  ArrowLeftRight,
  ShoppingCart,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";

interface DockItem {
  name: string;
  /** The name under the icon in the phone tab bar, where there's room for one short word. */
  short: string;
  href: string;
  icon: LucideIcon;
}

const dockItems: DockItem[] = [
  { name: "Dashboard", short: "Home", href: "/dashboard", icon: LayoutDashboard },
  { name: "Analytics", short: "Analytics", href: "/analytics", icon: ChartColumn },
  // Upaya follow-up: only the orders booked with Upaya, by where they are.
  { name: "Upaya", short: "Upaya", href: "/upaya", icon: Truck },
  { name: "Products", short: "Products", href: "/products", icon: Package },
  { name: "Inventory", short: "Stock", href: "/inventory", icon: ArrowLeftRight },
  { name: "Customers", short: "Orders", href: "/customers", icon: Users },
  // Purchases is hidden for now (the page still exists at /purchases).
  { name: "POS & Sales", short: "POS", href: "/sales", icon: ShoppingCart },
  // Notes is a side tool, so it's in the top bar (NotesButton), not here.
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
 * The bottom navigation. On computers and tablets it's a floating dock whose
 * icons magnify around the pointer; on phones it's a full-width tab bar with
 * a name under each icon. Either way the highlight slides to the tapped item
 * straight away (before the page has loaded), and each press gives a small
 * squeeze so taps feel answered.
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

  // Dashboard and Analytics only show once the owner has unlocked them on this device.
  const unlocked = useOwnerUnlocked();
  const items = unlocked ? dockItems : dockItems.filter(item => !isOwnerPath(item.href));

  const routeIndex = items.findIndex(item => isActiveFor(pathname, item.href));
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
      className="dock fixed inset-x-0 bottom-0 z-30 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:bottom-[max(0.5rem,env(safe-area-inset-bottom))] sm:max-w-[calc(100vw-1rem)]"
    >
      <div
        onMouseLeave={() => setHovered(null)}
        className="dock-bar relative flex items-start justify-around px-1 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] sm:items-center sm:justify-start sm:gap-3 sm:px-5 sm:py-3.5 rounded-none sm:rounded-full"
      >
        {/* Glass sheen (the floating dock) */}
        <div className="absolute inset-0 rounded-full bg-gradient-to-b from-white/10 via-transparent to-black/5 pointer-events-none hidden sm:block" />
        <div className="absolute inset-x-4 top-0.5 h-px bg-gradient-to-r from-transparent via-foreground/20 to-transparent pointer-events-none hidden sm:block" />

        {items.map((item, i) => {
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
              className="dock-item group relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 py-0.5 sm:flex-none sm:gap-0 sm:py-0"
              style={{
                transform: `translateY(${-liftFor(distance)}px) scale(${scaleFor(distance)})`,
                transition: `transform 0.35s ${SPRING}`,
              }}
            >
              {/* Tooltip (pointer devices only — hover never fires on touch) */}
              <span className="absolute -top-12 px-3 py-2 rounded-lg bg-popover border border-border backdrop-blur-sm text-popover-foreground text-xs font-semibold opacity-0 scale-75 translate-y-1 group-hover:opacity-100 group-hover:scale-100 group-hover:translate-y-0 group-focus-visible:opacity-100 group-focus-visible:scale-100 group-focus-visible:translate-y-0 transition-all duration-200 whitespace-nowrap pointer-events-none shadow-lg z-50 hidden sm:block">
                {item.name}
              </span>

              {/* Icon chip: a wide pill over the name on phones (the whole column is the
                  touch target), a glass tile in the floating dock */}
              <div
                ref={el => { chipRefs.current[i] = el; }}
                className={cn(
                  "dock-chip relative flex items-center justify-center w-14 h-8 rounded-full sm:w-10 sm:h-10 sm:rounded-xl border cursor-pointer",
                  isActive
                    ? "border-primary/30 text-primary-foreground"
                    : "border-transparent text-muted-foreground sm:bg-white/35 sm:dark:bg-white/5 sm:border-white/50 sm:dark:border-white/10 sm:hover:bg-white/60 sm:dark:hover:bg-white/10 sm:hover:text-foreground"
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

              {/* Name under the icon (phones, where there are no tooltips) */}
              <span
                aria-hidden
                className={cn(
                  "max-w-full truncate px-0.5 text-[11px] leading-tight transition-colors sm:hidden",
                  isActive ? "font-bold text-primary" : "font-medium text-muted-foreground"
                )}
              >
                {item.short}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
