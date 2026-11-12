import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDefaultWarehouseIdFor, logActivity, notify } from "@/lib/actions/helpers";
import { ensureVariants, syncStockTotal } from "@/lib/variants";

const digest = (value: string) => createHash("sha256").update(value).digest();

function isAuthorized(request: Request) {
  const secret = process.env.WEBSITE_ORDERS_SECRET;
  const header = request.headers.get("authorization") ?? "";
  return Boolean(secret) && timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}

type WebsiteProduct = {
  karmify_product_id?: string | null;
  slug: string;
  name: string;
  price: number;
  image?: string | null;
  /** Which website shop the product is in. */
  shop?: "originals" | "decor";
  /** The website's sizes and colour names, to create matching stock rows. */
  sizes?: string[];
  colors?: string[];
};

const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0 && x.length <= 40).slice(0, 30) : []);

/** Adds the website's size/colour combinations as stock rows (at 0). Not for a product that
 * has stock but no sizes yet: that stock can't be split automatically, so staff are asked to. */
async function addVariants(storeId: string, productId: string, name: string, sizes: string[], colors: string[]) {
  if (sizes.length === 0 && colors.length === 0) return;
  const warehouseId = await getDefaultWarehouseIdFor(storeId);
  const [variantCount, stock] = await Promise.all([
    db.productVariant.count({ where: { productId } }),
    db.stock.findUnique({ where: { productId_warehouseId: { productId, warehouseId } }, select: { quantity: true } }),
  ]);
  if (variantCount === 0 && (stock?.quantity ?? 0) > 0) {
    await notify(storeId, "Set sizes for a product", `"${name}" has ${stock!.quantity} in stock but no sizes yet. Open it in Products and split the stock by size and colour.`, "warning");
    return;
  }
  await db.$transaction(async (tx) => {
    await ensureVariants(tx, storeId, productId, sizes, colors);
    await syncStockTotal(tx, storeId, productId, warehouseId);
  });
}

function isWebsiteProduct(value: unknown): value is WebsiteProduct {
  const p = value as Partial<WebsiteProduct> | null;
  return Boolean(
    p &&
      typeof p.slug === "string" && /^[a-z0-9-]{1,120}$/.test(p.slug) &&
      typeof p.name === "string" && p.name.trim().length > 0 && p.name.length <= 200 &&
      Number.isFinite(p.price) && p.price! >= 0
  );
}

/** Karmify's active products with their stock: the admin's suggestions and the website's live stock. */
export async function GET(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const storeId = process.env.WEBSITE_ORDERS_STORE_ID;
  if (!storeId) return NextResponse.json({ error: "No store is set up for website products." }, { status: 503 });

  const products = await db.product.findMany({
    where: { storeId, status: "active", NOT: { sku: { startsWith: "WEBSITE-UNMATCHED-" } } },
    select: {
      id: true, name: true, sku: true, sellingPrice: true, imageUrl: true, category: { select: { name: true } },
      stocks: { select: { quantity: true } },
      variants: { select: { size: true, color: true, quantity: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return NextResponse.json({
    products: products.map(p => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      price: p.sellingPrice,
      image: p.imageUrl,
      category: p.category.name,
      // What the website may sell: the total, and per size/colour for clothing.
      stock: p.stocks.reduce((sum, s) => sum + s.quantity, 0),
      variants: p.variants,
    })),
  });
}

/**
 * The Karmalu admin calls this when a product is saved, so Karmify's product
 * keeps the website's name and photo (its price stays Karmify's own). Found by the stored link, else by
 * SKU = the website URL name; created (stock 0, website price) if missing.
 * Stock, cost and selling price are Karmify's own and are never changed here.
 */
export async function POST(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const storeId = process.env.WEBSITE_ORDERS_STORE_ID;
  if (!storeId) return NextResponse.json({ error: "No store is set up for website products." }, { status: 503 });

  const body = await request.json().catch(() => null);
  if (!isWebsiteProduct(body)) return NextResponse.json({ error: "Invalid product." }, { status: 422 });
  const name = body.name.trim();

  try {
    const existing =
      (body.karmify_product_id
        ? await db.product.findFirst({ where: { id: body.karmify_product_id, storeId }, select: { id: true, sku: true } })
        : null) ?? (await db.product.findFirst({ where: { storeId, sku: body.slug }, select: { id: true, sku: true } }));

    if (existing) {
      // Follow a renamed URL name too, unless another product already has that SKU.
      const skuFree =
        existing.sku === body.slug || !(await db.product.findFirst({ where: { storeId, sku: body.slug }, select: { id: true } }));
      await db.product.update({
        where: { id: existing.id },
        // Prices are set separately in each app (the shop counter and the website can
        // differ), so an existing product keeps its Karmify price.
        data: {
          name,
          ...(body.image !== undefined && { imageUrl: body.image }),
          ...(skuFree && { sku: body.slug }),
        },
      });
      await addVariants(storeId, existing.id, name, list(body.sizes), list(body.colors));
      return NextResponse.json({ ok: true, id: existing.id });
    }

    const category =
      (await db.category.findFirst({ where: { storeId, name: "Apparel" }, select: { id: true } })) ??
      (await db.category.findFirst({ where: { storeId }, select: { id: true } })) ??
      (await db.category.create({ data: { storeId, name: "Apparel" }, select: { id: true } }));
    const supplier = await db.supplier.upsert({
      where: { storeId_companyName: { storeId, companyName: "General Supplier" } },
      update: {},
      create: { storeId, companyName: "General Supplier", contactPerson: "System", phone: "N/A", email: "noreply@karmify.com", address: "N/A" },
      select: { id: true },
    });
    const warehouseId = await getDefaultWarehouseIdFor(storeId);

    const created = await db.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          storeId,
          name,
          sku: body.slug,
          categoryId: category.id,
          supplierId: supplier.id,
          costPrice: 0,
          sellingPrice: body.price,
          status: "active",
          brand: body.shop === "decor" ? "Karmalu Living & Decor" : "Karmalu Originals",
          imageUrl: body.image ?? null,
          description: "Added from the Karmalu website admin. The SKU is the website URL name so website orders match.",
        },
        select: { id: true },
      });
      await tx.stock.create({ data: { storeId, productId: product.id, warehouseId, quantity: 0 } });
      return product;
    });
    await addVariants(storeId, created.id, name, list(body.sizes), list(body.colors));
    await logActivity({ storeId }, "Product Created", `New SKU ${body.slug} – "${name}" added from the website admin.`);
    return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
  } catch (err) {
    console.error("[website-products] failed", body.slug, err);
    return NextResponse.json({ error: "Could not save this product." }, { status: 500 });
  }
}
