"use client";

import { useOwnerUnlocked } from "@/lib/ownerLock";
import { formatNPR } from "@/lib/utils";

/**
 * "cost Rs. 1,200 · 45% margin" for the owner (Dashboard unlocked on this
 * device); nothing for staff. A product saved without a cost price says so,
 * rather than showing a 100% margin.
 */
export function CostMargin({ cost, price, prefix = "", marginWord = true }: { cost: number; price: number; prefix?: string; marginWord?: boolean }) {
  const owner = useOwnerUnlocked();
  if (!owner) return null;
  if (!(cost > 0)) return <>{prefix}<span className="font-medium text-amber-700 dark:text-amber-400">no cost price yet</span></>;
  const margin = price > 0 ? Math.round(((price - cost) / price) * 100) : 0;
  return (
    <>
      {prefix}cost {formatNPR(cost)} · <span className="font-semibold text-emerald-700 dark:text-emerald-400">{margin}%{marginWord ? " margin" : ""}</span>
    </>
  );
}
