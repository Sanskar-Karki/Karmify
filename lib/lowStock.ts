// Low stock, counted per size and colour. A product with sizes/colours is low
// wherever one of its variants is below the product's minimum, not when the
// total is. A product without variants is judged on its total.
//
// "Ignore" stores the quantity at the time (lowStockIgnoredQty). The alert stays
// hidden while stock is at or below that number, and comes back by itself once
// the item has been restocked above it and later runs low again.

type VariantLike = { id: string; size: string; color: string; quantity: number; lowStockIgnoredQty?: number | null };
type ProductLike = {
  id: string;
  name: string;
  sku: string;
  status: string;
  minStockLevel: number;
  lowStockIgnoredQty?: number | null;
  variants?: VariantLike[];
};

export type LowStockLine = {
  /** Unique per line: the variant id, or the product id when it has no variants. */
  key: string;
  productId: string;
  variantId: string | null;
  name: string;
  sku: string;
  /** "M · Navy", "M" or "Navy"; "" for a product without variants. */
  variant: string;
  quantity: number;
  min: number;
  ignored: boolean;
};

export const isIgnored = (quantity: number, ignoredQty: number | null | undefined) =>
  ignoredQty !== null && ignoredQty !== undefined && quantity <= ignoredQty;

const label = (v: { size: string; color: string }) => [v.size, v.color].filter(Boolean).join(" · ");

/** Every low line for active products (ignored ones included, flagged), lowest first. */
export function lowStockLines(products: ProductLike[], totalByProduct: Map<string, number>): LowStockLine[] {
  const lines: LowStockLine[] = [];
  for (const p of products) {
    if (p.status !== "active") continue;
    const variants = p.variants ?? [];
    if (variants.length > 0) {
      for (const v of variants) {
        if (v.quantity >= p.minStockLevel) continue;
        lines.push({
          key: v.id, productId: p.id, variantId: v.id, name: p.name, sku: p.sku, variant: label(v),
          quantity: v.quantity, min: p.minStockLevel, ignored: isIgnored(v.quantity, v.lowStockIgnoredQty),
        });
      }
    } else {
      const quantity = totalByProduct.get(p.id) ?? 0;
      if (quantity >= p.minStockLevel) continue;
      lines.push({
        key: p.id, productId: p.id, variantId: null, name: p.name, sku: p.sku, variant: "",
        quantity, min: p.minStockLevel, ignored: isIgnored(quantity, p.lowStockIgnoredQty),
      });
    }
  }
  return lines.sort((a, b) => a.quantity - b.quantity || a.name.localeCompare(b.name));
}

/** "Jacket (M · Navy)" or "Jacket". */
export const lowStockName = (line: Pick<LowStockLine, "name" | "variant">) =>
  line.variant ? `${line.name} (${line.variant})` : line.name;
