"use server";

import { db } from "@/lib/db";
import { MovementType } from "@prisma/client";
import { requireTenant } from "@/lib/tenant";
import { logActivity, getDefaultWarehouseIdFor } from "@/lib/actions/helpers";
import { replaceVariants, type VariantRow } from "@/lib/variants";
import { guarded, isForeignKeyConflict, isUniqueConflict, UserError } from "@/lib/actions/result";
import { revalidatePath } from "next/cache";

const DEFAULT_CATEGORIES = [
  { name: "Lamp", description: "Decorative and functional lamps" },
  { name: "Light", description: "Lighting fixtures and bulbs" },
  { name: "Soft Toys", description: "Plush toys and kids' soft products" },
  { name: "Electronics Decor", description: "Decorative electronics and gadget accessories" },
  { name: "Home Decor", description: "Decorative items for living spaces" },
  { name: "Kitchen", description: "Kitchenware and home essentials" },
  { name: "Fashion", description: "Clothing and accessories" },
  { name: "Electronics", description: "Phones, gadgets, and accessories" },
  { name: "Furniture", description: "Tables, chairs, and home furniture" },
  { name: "Beauty", description: "Cosmetics and personal care items" },
  { name: "Sports", description: "Athletic gear and outdoor equipment" },
  { name: "Books", description: "Printed and digital reading materials" },
  { name: "Toys", description: "Children's toys and entertainment products" },
  { name: "Pet Supplies", description: "Pet food, toys, and accessories" },
  { name: "Health", description: "Wellness and personal health products" },
  { name: "Other", description: "Miscellaneous products" },
];

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
    try {
      if (editingId) {
        await db.supplier.update({ where: { id: editingId, storeId: tenant.storeId }, data });
        await logActivity(tenant, "Supplier Updated", `Supplier "${companyName}" was edited.`);
      } else {
        await db.supplier.create({ data: { ...data, storeId: tenant.storeId } });
        await logActivity(tenant, "Supplier Created", `Supplier "${companyName}" was added.`);
      }
    } catch (err) {
      if (isUniqueConflict(err)) throw new UserError(`A supplier named "${companyName}" already exists.`);
      throw err;
    }
    revalidatePath("/settings");
    revalidatePath("/purchases");
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
