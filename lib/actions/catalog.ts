"use server";

import { db } from "@/lib/db";
import { MovementType } from "@prisma/client";
import { requireTenant } from "@/lib/tenant";
import { logActivity, getDefaultWarehouseIdFor } from "@/lib/actions/helpers";
import { replaceVariants, type VariantRow } from "@/lib/variants";
import { guarded, isForeignKeyConflict, isUniqueConflict, UserError } from "@/lib/actions/result";
import { CLOTHING_CATEGORIES, guessClothingCategory } from "@/lib/categories";
import { revalidatePath } from "next/cache";

const DEFAULT_CATEGORIES = CLOTHING_CATEGORIES.map(({ name, description }) => ({ name, description }));

/** Gives a brand-new store a starter category list. Safe to call repeatedly. */
export async function ensureDefaultCategories() {
  return guarded("Could not set up default categories.", async () => {
    const tenant = await requireTenant();
    const storeId = tenant.storeId;

    if ((await db.category.count({ where: { storeId } })) > 0) return { created: 0 };

    const { count } = await db.category.createMany({
      data: DEFAULT_CATEGORIES.map(category => ({ ...category, storeId })),
      skipDuplicates: true,
    });
    if (count > 0) await logActivity(tenant, "Categories Created", `Added ${count} default categories.`);
    revalidatePath("/products");
    return { created: count };
  });
}

type SupplierForm = {
  companyName: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  notes?: string;
};

export async function saveSupplier(form: SupplierForm, editingId?: string | null) {
  return guarded("Could not save this supplier.", async () => {
    const companyName = form.companyName.trim();
    if (!companyName) throw new UserError("Company name is required.");
    const data = { ...form, companyName, notes: form.notes?.trim() || null };

    const tenant = await requireTenant();
    let id: string;
    try {
      if (editingId) {
        ({ id } = await db.supplier.update({ where: { id: editingId, storeId: tenant.storeId }, data, select: { id: true } }));
        await logActivity(tenant, "Supplier Updated", `Supplier "${companyName}" was edited.`);
      } else {
        ({ id } = await db.supplier.create({ data: { ...data, storeId: tenant.storeId }, select: { id: true } }));
        await logActivity(tenant, "Supplier Created", `Supplier "${companyName}" was added.`);
      }
    } catch (err) {
      if (isUniqueConflict(err)) throw new UserError(`A supplier named "${companyName}" already exists.`);
      throw err;
    }
    revalidatePath("/settings");
    revalidatePath("/purchases");
    revalidatePath("/products");
    return { id };
  });
}

export async function deleteSupplier(id: string) {
  return guarded("Could not delete this supplier.", async () => {
    const tenant = await requireTenant();
    try {
      const supplier = await db.supplier.delete({ where: { id, storeId: tenant.storeId } });
      await logActivity(tenant, "Supplier Deleted", `Supplier "${supplier.companyName}" was deleted.`);
    } catch (err) {
      if (isForeignKeyConflict(err)) {
        throw new UserError("This supplier is linked to products or purchase orders, so it can't be deleted.");
      }
      throw err;
    }
    revalidatePath("/settings");
  });
}

const STATUSES = new Set(["active", "inactive"]);

export async function saveProduct(form: {
  name: string;
  sku: string;
  barcode?: string;
  description?: string;
  brand?: string;
  categoryId: string;
  supplierId: string;
  costPrice: number;
  sellingPrice: number;
  minStockLevel: number;
  stockQuantity: number;
  status: string;
  /** Stock per size/colour. When given (even empty), replaces the product's rows; a non-empty list sets the stock total. */
  variants?: VariantRow[];
}, editingId?: string | null) {
  return guarded("Unable to save product. Please try again.", async () => {
    const name = form.name.trim();
    if (!name) throw new UserError("Product name is required.");
    if (!(form.costPrice >= 0) || !(form.sellingPrice >= 0)) throw new UserError("Prices can't be negative.");
    if (!Number.isInteger(form.stockQuantity) || form.stockQuantity < 0) {
      throw new UserError("Stock must be a whole number of 0 or more.");
    }
    if (!STATUSES.has(form.status)) throw new UserError("Unknown product status.");

    const tenant = await requireTenant();
    const storeId = tenant.storeId;
    if (form.variants && form.variants.length > 0) {
      form = { ...form, stockQuantity: form.variants.reduce((sum, v) => sum + Math.max(0, Math.floor(Number(v.quantity) || 0)), 0) };
    }

    const category = await db.category.findFirst({ where: { id: form.categoryId, storeId }, select: { id: true } });
    if (!category) throw new UserError("That category no longer exists. Refresh and try again.");

    const existingSupplier = form.supplierId?.trim()
      ? await db.supplier.findFirst({ where: { id: form.supplierId.trim(), storeId }, select: { id: true } })
      : null;
    const supplier = existingSupplier ?? await db.supplier.upsert({
      where: { storeId_companyName: { storeId, companyName: "General Supplier" } },
      update: {},
      create: {
        storeId,
        companyName: "General Supplier",
        contactPerson: "System",
        phone: "N/A",
        email: "noreply@karmify.com",
        address: "N/A",
      },
      select: { id: true },
    });

    const warehouseId = await getDefaultWarehouseIdFor(storeId);
    const sku = form.sku?.trim() || `PRD-${Date.now()}`;
    const productData = {
      name,
      sku,
      categoryId: category.id,
      supplierId: supplier.id,
      costPrice: form.costPrice,
      sellingPrice: form.sellingPrice,
      minStockLevel: form.minStockLevel,
      status: form.status,
      barcode: form.barcode?.trim() || null,
      description: form.description?.trim() || null,
      brand: form.brand?.trim() || null,
    };

    // The product and its stock are written together, so a failure can't leave
    // a product with no stock row behind for the next save to collide with.
    try {
      const product = await db.$transaction(async (tx) => {
        if (editingId) {
          const updated = await tx.product.update({ where: { id: editingId, storeId }, data: productData });
          const current = await tx.stock.findUnique({
            where: { productId_warehouseId: { productId: updated.id, warehouseId } },
            select: { quantity: true },
          });
          const oldQty = current?.quantity ?? 0;
          const difference = form.stockQuantity - oldQty;

          if (difference !== 0) {
            await tx.stock.upsert({
              where: { productId_warehouseId: { productId: updated.id, warehouseId } },
              update: { quantity: form.stockQuantity },
              create: { storeId, productId: updated.id, warehouseId, quantity: form.stockQuantity },
            });
            await tx.stockMovement.create({
              data: {
                storeId,
                productId: updated.id,
                quantity: Math.abs(difference),
                type: MovementType.ADJUSTMENT,
                sourceWhId: difference < 0 ? warehouseId : null,
                destWhId: difference > 0 ? warehouseId : null,
                notes: `Edited in catalog: ${oldQty} to ${form.stockQuantity}`,
                userId: tenant.userId,
              },
            });
          }
          if (form.variants) await replaceVariants(tx, storeId, updated.id, form.variants);
          return updated;
        }

        const created = await tx.product.create({ data: { ...productData, storeId } });
        await tx.stock.create({
          data: { storeId, productId: created.id, warehouseId, quantity: form.stockQuantity },
        });
        if (form.stockQuantity > 0) {
          await tx.stockMovement.create({
            data: {
              storeId,
              productId: created.id,
              quantity: form.stockQuantity,
              type: MovementType.STOCK_IN,
              destWhId: warehouseId,
              notes: "Opening stock",
              userId: tenant.userId,
            },
          });
        }
        if (form.variants) await replaceVariants(tx, storeId, created.id, form.variants);
        return created;
      }, { timeout: 15_000, maxWait: 10_000 });

      await logActivity(
        tenant,
        editingId ? "Product Updated" : "Product Created",
        editingId ? `SKU ${sku} – "${name}" was edited.` : `New SKU ${sku} – "${name}" added to catalog.`
      );

      revalidatePath("/products");
      revalidatePath("/inventory");
      return { id: product.id };
    } catch (err) {
      if (isUniqueConflict(err)) throw new UserError("SKU or barcode already exists. Please choose a different value.");
      throw err;
    }
  });
}

/**
 * Deletes several products. Each is tried on its own, so one with sales or
 * purchase history (which can't be deleted) doesn't stop the rest; those are
 * returned in `kept` to be set Inactive instead.
 */
export async function deleteProducts(ids: string[]) {
  return guarded("Could not delete the selected products.", async () => {
    if (!Array.isArray(ids) || ids.length === 0) throw new UserError("Select at least one product.");
    if (ids.length > 500) throw new UserError("Delete at most 500 products at a time.");
    const tenant = await requireTenant();

    const products = await db.product.findMany({
      where: { storeId: tenant.storeId, id: { in: [...new Set(ids)] } },
      select: { id: true, name: true, sku: true },
    });
    const deleted: string[] = [];
    const kept: string[] = [];
    for (const product of products) {
      try {
        await db.product.delete({ where: { id: product.id, storeId: tenant.storeId } });
        deleted.push(product.name);
      } catch (err) {
        if (isForeignKeyConflict(err)) kept.push(product.name);
        else throw err;
      }
    }

    if (deleted.length > 0) {
      await logActivity(tenant, "Products Deleted", `${deleted.length} removed from catalog: ${deleted.join(", ").slice(0, 900)}.`);
    }
    revalidatePath("/products");
    revalidatePath("/inventory");
    return { deleted: deleted.length, kept };
  });
}

export async function deleteProduct(id: string) {
  return guarded("Could not delete this product.", async () => {
    const tenant = await requireTenant();
    try {
      const product = await db.product.delete({ where: { id, storeId: tenant.storeId } });
      await logActivity(tenant, "Product Deleted", `SKU ${product.sku} – "${product.name}" removed from catalog.`);
    } catch (err) {
      if (isForeignKeyConflict(err)) {
        throw new UserError("This product has sales or purchase history, so it can't be deleted. Edit it and set the status to Inactive instead.");
      }
      throw err;
    }
    revalidatePath("/products");
    revalidatePath("/inventory");
  });
}

/**
 * Switches the store to the clothing categories: adds any that are missing,
 * moves products whose name clearly points to one (e.g. "Pu Leather Jacket" →
 * Jackets) out of the old general categories, then removes old categories that
 * are left empty. Products that match nothing stay where they are.
 */
export async function setUpClothingCategories() {
  return guarded("Could not set up the clothing categories.", async () => {
    const tenant = await requireTenant();
    const storeId = tenant.storeId;
    const clothingNames = new Set<string>(CLOTHING_CATEGORIES.map(c => c.name.toLowerCase()));

    const result = await db.$transaction(async (tx) => {
      await tx.category.createMany({
        data: DEFAULT_CATEGORIES.map(c => ({ ...c, storeId })),
        skipDuplicates: true,
      });
      const categories = await tx.category.findMany({ where: { storeId }, select: { id: true, name: true } });
      const idByName = new Map(categories.map(c => [c.name.toLowerCase(), c.id]));
      const oldIds = categories.filter(c => !clothingNames.has(c.name.toLowerCase())).map(c => c.id);

      const products = await tx.product.findMany({
        where: { storeId, categoryId: { in: oldIds } },
        select: { id: true, name: true },
      });
      const moved: string[] = [];
      for (const product of products) {
        const target = guessClothingCategory(product.name);
        const targetId = target ? idByName.get(target.toLowerCase()) : undefined;
        if (!targetId) continue;
        await tx.product.update({ where: { id: product.id }, data: { categoryId: targetId } });
        moved.push(`${product.name} → ${target}`);
      }

      const stillUsed = new Set(
        (await tx.product.groupBy({ by: ["categoryId"], where: { storeId, categoryId: { in: oldIds } } })).map(g => g.categoryId)
      );
      const emptyOld = categories.filter(c => oldIds.includes(c.id) && !stillUsed.has(c.id));
      if (emptyOld.length) await tx.category.deleteMany({ where: { storeId, id: { in: emptyOld.map(c => c.id) } } });
      return { moved, removed: emptyOld.map(c => c.name) };
    }, { timeout: 20_000, maxWait: 10_000 });

    await logActivity(
      tenant,
      "Categories Updated",
      `Switched to clothing categories. Moved ${result.moved.length} product(s)${result.removed.length ? `; removed empty: ${result.removed.join(", ")}` : ""}.`
    );
    revalidatePath("/products");
    return result;
  });
}

/** Adds a category, or renames one when `editingId` is given. */
export async function saveCategory(name: string, editingId?: string | null) {
  return guarded("Could not save this category.", async () => {
    const clean = name.trim().replace(/\s+/g, " ").slice(0, 60);
    if (!clean) throw new UserError("Category name is required.");
    const tenant = await requireTenant();
    try {
      if (editingId) {
        const before = await db.category.findFirst({ where: { id: editingId, storeId: tenant.storeId }, select: { name: true } });
        if (!before) throw new UserError("That category no longer exists. Refresh and try again.");
        await db.category.update({ where: { id: editingId, storeId: tenant.storeId }, data: { name: clean } });
        await logActivity(tenant, "Category Renamed", `Category "${before.name}" renamed to "${clean}".`);
      } else {
        await db.category.create({ data: { storeId: tenant.storeId, name: clean } });
        await logActivity(tenant, "Category Created", `Category "${clean}" was added.`);
      }
    } catch (err) {
      if (isUniqueConflict(err)) throw new UserError(`A category named "${clean}" already exists.`);
      throw err;
    }
    revalidatePath("/products");
  });
}

/** Deletes a category that has no products. */
export async function deleteCategory(id: string) {
  return guarded("Could not delete this category.", async () => {
    const tenant = await requireTenant();
    const category = await db.category.findFirst({
      where: { id, storeId: tenant.storeId },
      select: { name: true, _count: { select: { products: true } } },
    });
    if (!category) throw new UserError("That category no longer exists. Refresh and try again.");
    if (category._count.products > 0) {
      throw new UserError(`"${category.name}" still has ${category._count.products} product(s). Move them to another category first.`);
    }
    if ((await db.category.count({ where: { storeId: tenant.storeId } })) <= 1) {
      throw new UserError("Keep at least one category: every product needs one.");
    }
    await db.category.delete({ where: { id, storeId: tenant.storeId } });
    await logActivity(tenant, "Category Deleted", `Category "${category.name}" was deleted.`);
    revalidatePath("/products");
  });
}
