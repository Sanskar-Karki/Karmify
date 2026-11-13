"use client";

import { Edit2 } from "lucide-react";
import { cn } from "@/lib/utils";

// A product's stock per size and colour, shown as a size × colour table
// (colours down the side, sizes across the top) instead of a long list.

/** One size/colour row of a product's stock. */
export type VariantStockRow = { id: string; size: string; color: string; quantity: number };

/** At or below this (below 5) a size/colour counts as low; the website shows "Almost sold out · only N left" from here. */
export const LOW_VARIANT_STOCK = 4;

const LETTER_SIZES = ["xxxs", "xxs", "xs", "s", "m", "l", "xl", "xxl", "2xl", "xxxl", "3xl", "4xl", "5xl", "6xl"];

const keyOf = (value: string) => value.trim().toLowerCase();
const compact = (value: string) => keyOf(value).replace(/[\s-]+/g, "");

/** Letter sizes in capitals ("l" → "L"); anything else as typed. */
function sizeLabel(size: string) {
  const k = compact(size);
  return LETTER_SIZES.includes(k) ? k.toUpperCase() : size.trim();
}

/** "off white" → "Off White". */
function colourLabel(colour: string) {
  return colour.trim().replace(/(^|\s)\S/g, ch => ch.toUpperCase());
}

/** No size first, then XS, S, M, L, XL…, then numbers (28, 30…), then anything else A–Z. */
function sizeRank(size: string): [number, number, string] {
  const k = compact(size);
  if (!k) return [0, 0, ""];
  const letter = LETTER_SIZES.indexOf(k);
  if (letter >= 0) return [1, letter, ""];
  const n = Number.parseFloat(k);
  if (Number.isFinite(n)) return [2, n, k];
  return [3, 0, k];
}

function compareSizes(a: string, b: string) {
  const [ga, na, ta] = sizeRank(a);
  const [gb, nb, tb] = sizeRank(b);
  return ga - gb || na - nb || ta.localeCompare(tb);
}

/** Rows in shop order: sizes XS → XXL (then numbers), colours A–Z within a size. */
export function sortVariants<T extends { size: string; color: string }>(variants: T[]): T[] {
  return [...variants].sort((a, b) => compareSizes(a.size, b.size) || keyOf(a.color).localeCompare(keyOf(b.color)));
}

type Axis = { key: string; label: string }[];
type Grid = { sizes: Axis; colours: Axis; cells: Map<string, number> };

const cellKey = (colour: string, size: string) => `${colour}\n${size}`;

/** Groups the rows by size and colour, ignoring capitals ("m" and "M" are one size). */
function buildGrid(variants: VariantStockRow[]): Grid {
  const sizes = new Map<string, string>();
  const colours = new Map<string, string>();
  const cells = new Map<string, number>();
  for (const v of variants) {
    const s = compact(v.size);
    const c = keyOf(v.color);
    if (!sizes.has(s)) sizes.set(s, v.size);
    if (!colours.has(c)) colours.set(c, v.color);
    const key = cellKey(c, s);
    cells.set(key, (cells.get(key) ?? 0) + v.quantity);
  }
  return {
    sizes: [...sizes]
      .sort((a, b) => compareSizes(a[1], b[1]))
      .map(([key, raw]) => ({ key, label: sizeLabel(raw) })),
    colours: [...colours]
      // Named colours A–Z, "no colour" last.
      .sort((a, b) => Number(!a[0]) - Number(!b[0]) || a[0].localeCompare(b[0]))
      .map(([key, raw]) => ({ key, label: colourLabel(raw) })),
    cells,
  };
}

const optionName = (size: { key: string; label: string }, colour: { key: string; label: string }) =>
  [size.key && size.label, colour.key && colour.label].filter(Boolean).join(" · ");

export type VariantSummary = {
  sizes: number;
  colours: number;
  /** Size/colour combinations with a stock row. */
  options: number;
  soldOut: string[];
  low: string[];
};

/** Counts for a product's stock line: sizes, colours, and which options are sold out or low. */
export function summarizeVariants(variants: VariantStockRow[]): VariantSummary {
  const grid = buildGrid(variants);
  const soldOut: string[] = [];
  const low: string[] = [];
  for (const colour of grid.colours) {
    for (const size of grid.sizes) {
      const quantity = grid.cells.get(cellKey(colour.key, size.key));
      if (quantity === undefined) continue;
      if (quantity <= 0) soldOut.push(optionName(size, colour));
      else if (quantity <= LOW_VARIANT_STOCK) low.push(optionName(size, colour));
    }
  }
  return {
    sizes: grid.sizes.filter(s => s.key).length,
    colours: grid.colours.filter(c => c.key).length,
    options: grid.cells.size,
    soldOut,
    low,
  };
}

/** "4 sizes · 3 colours", "4 sizes" or "3 colours". */
export function variantCountLabel(summary: VariantSummary) {
  const parts: string[] = [];
  if (summary.sizes) parts.push(`${summary.sizes} size${summary.sizes === 1 ? "" : "s"}`);
  if (summary.colours) parts.push(`${summary.colours} colour${summary.colours === 1 ? "" : "s"}`);
  return parts.join(" · ") || `${summary.options} option${summary.options === 1 ? "" : "s"}`;
}

// Shop colour names that aren't CSS colour words, so they still get a dot.
const SHOP_COLOURS: Record<string, string> = {
  noir: "#141414", "jet black": "#0b0b0b", charcoal: "#36454f", stone: "#a8a29e",
  cherry: "#8e1b2c", wine: "#722f37", burgundy: "#800020", rust: "#b7410e", mustard: "#d4a017",
  cotton: "#f3efe6", cream: "#f1e6d0", "off white": "#f4f1ea", ecru: "#e7dcc6", sand: "#d8c4a3",
  nude: "#e3bc9a", camel: "#c19a6b", mocha: "#6f4e37", sage: "#9caf88", mint: "#9ad8c2",
  "army green": "#4b5320", "bottle green": "#006a4e", denim: "#3b5b92", lilac: "#c8a2c8",
  "dusty pink": "#d8a7b1", "baby pink": "#f4c2c2",
};
const NOT_COLOURS = new Set(["inherit", "initial", "unset", "revert", "currentcolor", "transparent"]);

/** A dot colour for a colour name, or null when the name isn't a known colour. */
function swatchFor(colour: string): string | null {
  const name = keyOf(colour).replace(/[\s-]+/g, " ");
  if (!name) return null;
  if (SHOP_COLOURS[name]) return SHOP_COLOURS[name];
  const word = name.replace(/ /g, "");
  if (!/^[a-z]+$/.test(word) || NOT_COLOURS.has(word)) return null;
  return typeof CSS !== "undefined" && CSS.supports("color", word) ? word : null;
}

function Swatch({ colour }: { colour: string }) {
  const fill = swatchFor(colour);
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block h-3 w-3 shrink-0 rounded-full",
        fill ? "ring-1 ring-black/15 dark:ring-white/25" : "border border-dashed border-muted-foreground/50"
      )}
      style={fill ? { backgroundColor: fill } : undefined}
    />
  );
}

function tone(quantity: number) {
  if (quantity <= 0) return "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400";
  if (quantity <= LOW_VARIANT_STOCK) return "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400";
  return "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400";
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={cn("h-2 w-2 rounded-full", className)} />
      {label}
    </span>
  );
}

/** The size × colour stock table, with totals and an Edit stock shortcut. */
export function VariantMatrix({
  variants,
  onEdit,
  className,
}: {
  variants: VariantStockRow[];
  onEdit?: () => void;
  className?: string;
}) {
  const grid = buildGrid(variants);
  const hasSizes = grid.sizes.some(s => s.key);
  const hasColours = grid.colours.some(c => c.key);
  const rowTotals = grid.sizes.length > 1;
  const columnTotals = grid.colours.length > 1;
  const at = (colour: string, size: string) => grid.cells.get(cellKey(colour, size));
  const rowSum = (colour: string) => grid.sizes.reduce((sum, s) => sum + (at(colour, s.key) ?? 0), 0);
  const columnSum = (size: string) => grid.colours.reduce((sum, c) => sum + (at(c.key, size) ?? 0), 0);
  const total = [...grid.cells.values()].reduce((sum, q) => sum + q, 0);
  const gaps = grid.cells.size < grid.sizes.length * grid.colours.length;

  const sizeHeading = (s: Axis[number]) => (s.key ? s.label : hasSizes ? "One size" : "Units");
  const colourHeading = (c: Axis[number]) => (c.key ? c.label : hasColours ? "No colour" : "Units");
  const quiet = "text-[11px] font-bold uppercase tracking-wider text-muted-foreground";

  return (
    <div className={cn("rounded-xl border border-border/60 bg-card p-3 sm:p-4 shadow-sm", className)}>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-1 text-xs">
          <thead>
            <tr>
              <th scope="col" className={cn("pr-4 pb-1 text-left", quiet)}>
                {hasColours ? "Colour" : <span className="sr-only">Stock</span>}
              </th>
              {grid.sizes.map(s => (
                <th key={s.key} scope="col" className="min-w-11 px-1 pb-1 text-center text-[12px] font-bold text-foreground">
                  {sizeHeading(s)}
                </th>
              ))}
              {rowTotals && (
                <th scope="col" className={cn("min-w-11 pl-2 pb-1 text-center", quiet)}>Total</th>
              )}
            </tr>
          </thead>
          <tbody>
            {grid.colours.map(c => (
              <tr key={c.key}>
                <th scope="row" className="pr-4 text-left font-semibold text-foreground whitespace-nowrap">
                  <span className="inline-flex items-center gap-2">
                    {c.key && <Swatch colour={c.label} />}
                    {colourHeading(c)}
                  </span>
                </th>
                {grid.sizes.map(s => {
                  const quantity = at(c.key, s.key);
                  const name = optionName(s, c);
                  return (
                    <td key={s.key} className="p-0 text-center">
                      {quantity === undefined ? (
                        <span title={`${name}: not stocked`} className="inline-flex h-7 min-w-11 items-center justify-center text-muted-foreground/40">
                          –
                        </span>
                      ) : (
                        <span
                          title={quantity <= 0 ? `${name}: sold out` : `${name}: ${quantity} left`}
                          className={cn("inline-flex h-7 min-w-11 items-center justify-center rounded-lg px-2 font-bold tabular-nums", tone(quantity))}
                        >
                          {quantity}
                        </span>
                      )}
                    </td>
                  );
                })}
                {rowTotals && <td className="pl-2 text-center font-bold tabular-nums text-foreground">{rowSum(c.key)}</td>}
              </tr>
            ))}
          </tbody>
          {columnTotals && (
            <tfoot>
              <tr>
                <th scope="row" className={cn("pr-4 pt-1 text-left", quiet)}>Total</th>
                {grid.sizes.map(s => (
                  <td key={s.key} className="pt-1 text-center font-bold tabular-nums text-foreground">{columnSum(s.key)}</td>
                ))}
                {rowTotals && <td className="pl-2 pt-1 text-center font-extrabold tabular-nums text-foreground">{total}</td>}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/50 pt-3 text-[12px] text-muted-foreground">
        <LegendDot className="bg-emerald-500" label="In stock" />
        <LegendDot className="bg-amber-500" label={`Below ${LOW_VARIANT_STOCK + 1}`} />
        <LegendDot className="bg-red-500" label="Sold out" />
        {gaps && <span><span className="font-bold">–</span> not stocked</span>}
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            <Edit2 size={12} /> Edit stock
          </button>
        )}
      </div>
    </div>
  );
}
