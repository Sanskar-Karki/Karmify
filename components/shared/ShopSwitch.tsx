"use client";

import { cn } from "@/lib/utils";
import { Dropdown } from "@/components/shared/Dropdown";
import { SHOP_LABELS, setShop, useShop, type Shop } from "@/lib/shop";

const SHOPS: Shop[] = ["all", "originals", "decor"];

/** Switches every page between Karmalu Originals, Living & Decor and both. */
export function ShopSwitch() {
  const shop = useShop();
  return (
    <>
      <div className="hidden md:flex items-center gap-0.5 p-0.5 rounded-xl bg-muted border border-border shrink-0" role="radiogroup" aria-label="Shop">
        {SHOPS.map(s => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={shop === s}
            onClick={() => setShop(s)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer",
              shop === s ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {SHOP_LABELS[s]}
          </button>
        ))}
      </div>
      <Dropdown
        aria-label="Shop"
        value={shop}
        onChange={v => setShop(v as Shop)}
        options={SHOPS.map(s => ({ value: s, label: SHOP_LABELS[s] }))}
        className="md:hidden w-32 shrink-0"
        triggerClassName="py-1.5 text-xs"
      />
    </>
  );
}
