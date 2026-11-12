import "server-only";

import type { Prisma } from "@prisma/client";

// Stock per size and colour (ProductVariant). A product with variants keeps its
// Stock row equal to the sum of its variants, so everything that reads product
// stock (POS limits, low-stock alerts, dashboard) stays right.

type Tx = Prisma.TransactionClient;

/** How sizes and colours are compared: trimmed, case-insensitive. */
export const variantPart = (value: string | null | undefined) => (value ?? "").trim();
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export type VariantRow = { size: string; color: string; quantity: number };

/** The variant for a size/colour, ignoring case. Missing parts match "" (a product with only sizes, say). */
export async function findVariant(tx: Tx, productId: string, size?: string | null, color?: string | null) {
  const variants = await tx.productVariant.findMany({ where: { productId }, select: { id: true, size: true, color: true, quantity: true } });
  return variants.find(v => same(v.size, variantPart(size)) && same(v.color, variantPart(color))) ?? null;
}

/** Creates any missing size × colour combinations at 0. Existing ones (and their stock) are left alone. */
export async function ensureVariants(tx: Tx, storeId: string, productId: string, sizes: string[], colors: string[]) {
  const s = [...new Set(sizes.map(variantPart).filter(Boolean))];
  const c = [...new Set(colors.map(variantPart).filter(Boolean))];
  if (s.length === 0 && c.length === 0) return;
  const combos = (s.length ? s : [""]).flatMap(size => (c.length ? c : [""]).map(color => ({ size, color })));
  const existing = await tx.productVariant.findMany({ where: { productId }, select: { size: true, color: true } });
  const missing = combos.filter(x => !existing.some(e => same(e.size, x.size) && same(e.color, x.color)));
  if (missing.length) {
    await tx.productVariant.createMany({
      data: missing.map(x => ({ storeId, productId, size: x.size, color: x.color, quantity: 0 })),
      skipDuplicates: true,
    });
  }
}

/** Sets the product's stock total to the sum of its variants (only when it has variants). Returns the total. */
export async function syncStockTotal(tx: Tx, storeId: string, productId: string, warehouseId: string) {
  const agg = await tx.productVariant.aggregate({ where: { productId }, _sum: { quantity: true }, _count: true });
  if (agg._count === 0) return null;
  const total = agg._sum.quantity ?? 0;
  await tx.stock.upsert({
    where: { productId_warehouseId: { productId, warehouseId } },
    update: { quantity: total },
    create: { storeId, productId, warehouseId, quantity: total },
  });
  return total;
}

/** "M · Navy" / "M" / "Navy". */
export function variantLabel(v: { size: string; color: string }) {
  return [v.size, v.color].filter(Boolean).join(" · ");
}

/**
 * Makes a product's size/colour rows exactly `rows`: updates matching ones (ignoring case),
 * adds new ones, removes the rest. Blank rows and duplicates are dropped.
 */
export async function replaceVariants(tx: Tx, storeId: string, productId: string, rows: VariantRow[]) {
  const clean: VariantRow[] = [];
  for (const row of rows) {
    const size = variantPart(row.size).slice(0, 40);
    const color = variantPart(row.color).slice(0, 40);
    if (!size && !color) continue;
    if (clean.some(c => same(c.size, size) && same(c.color, color))) continue;
    clean.push({ size, color, quantity: Math.max(0, Math.floor(Number(row.quantity) || 0)) });
  }

  const existing = await tx.productVariant.findMany({ where: { productId }, select: { id: true, size: true, color: true } });
  const gone = existing.filter(e => !clean.some(c => same(c.size, e.size) && same(c.color, e.color)));
  if (gone.length) await tx.productVariant.deleteMany({ where: { id: { in: gone.map(g => g.id) } } });

  for (const row of clean) {
    const match = existing.find(e => same(e.size, row.size) && same(e.color, row.color));
    if (match) {
      await tx.productVariant.update({ where: { id: match.id }, data: { size: row.size, color: row.color, quantity: row.quantity } });
    } else {
      await tx.productVariant.create({ data: { storeId, productId, size: row.size, color: row.color, quantity: row.quantity } });
    }
  }
  return clean;
}
