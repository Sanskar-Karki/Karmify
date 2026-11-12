"use client";

import { useMemo, useState } from "react";

/** Renders long lists in steps, so a busy store's table stays quick to scroll and filter. */
export function useShowMore<T>(items: T[], step = 50) {
  const [limit, setLimit] = useState(step);
  const visible = useMemo(() => items.slice(0, limit), [items, limit]);
  return {
    visible,
    remaining: Math.max(0, items.length - limit),
    step,
    showMore: () => setLimit(current => current + step),
  };
}

export function ShowMoreButton({ remaining, step, onClick }: { remaining: number; step: number; onClick: () => void }) {
  if (remaining <= 0) return null;
  return (
    <div className="flex justify-center p-3 border-t border-border/40">
      <button
        type="button"
        onClick={onClick}
        className="px-4 py-2 rounded-xl text-xs font-semibold text-muted-foreground border border-border hover:bg-muted hover:text-foreground transition-colors"
      >
        Show {Math.min(step, remaining)} more ({remaining} remaining)
      </button>
    </div>
  );
}
