"use server";

import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { requireTenant } from "@/lib/tenant";
import { logActivity, getDefaultWarehouseIdFor } from "@/lib/actions/helpers";
import { revalidatePath } from "next/cache";

// Categories
export async function getCategories() {
  const tenant = await requireTenant();
  return db.category.findMany({
    where: { storeId: tenant.storeId },
    orderBy: { name: "asc" },
  });
}

export async function saveCategory(name: string, description?: string) {
  const tenant = await requireTenant();
  const category = await db.category.upsert({
    where: { storeId_name: { storeId: tenant.storeId, name } },
    update: { description },
    create: { storeId: tenant.storeId, name, description },
  });
  await logActivity(tenant, "Category Saved", `Category "${name}" created or updated.`);
  revalidatePath("/products");
  return category;
}

// Suppliers
export async function getSuppliers() {
  const tenant = await requireTenant();
  return db.supplier.findMany({
    where: { storeId: tenant.storeId },
    orderBy: { companyName: "asc" },
  });
}

export async function saveSupplier(form: {
  companyName: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  notes?: string;
}, editingId?: string | null) {
  const tenant = await requireTenant();
  let supplier;
  if (editingId) {
    supplier = await db.supplier.update({
      where: { id: editingId, storeId: tenant.storeId },
      data: form,
    });
    await logActivity(tenant, "Supplier Updated", `Supplier "${form.companyName}" was edited.`);
  } else {
    supplier = await db.supplier.create({
      data: { ...form, storeId: tenant.storeId },
    });
    await logActivity(tenant, "Supplier Created", `Supplier "${form.companyName}" was added.`);
  }
  revalidatePath("/settings");
  return supplier;
}

export async function deleteSupplier(id: string) {
  const tenant = await requireTenant();
  const supplier = await db.supplier.delete({
    where: { id, storeId: tenant.storeId },
  });
  await logActivity(tenant, "Supplier Deleted", `Supplier "${supplier.companyName}" was deleted.`);
  revalidatePath("/settings");
  return supplier;
}

// Warehouses
export async function getDefaultWarehouseId() {
  const tenant = await requireTenant();
  return getDefaultWarehouseIdFor(tenant.storeId);
}

export async function getWarehouses() {
  const tenant = await requireTenant();
  return db.warehouse.findMany({
    where: { storeId: tenant.storeId },
    orderBy: { name: "asc" },
  });
}

export async function saveWarehouse(form: {
  name: string;
  location: string;
  description?: string;
}, editingId?: string | null) {
  const tenant = await requireTenant();
  let warehouse: Awaited<ReturnType<typeof db.warehouse.create>>;
  if (editingId) {
    warehouse = await db.warehouse.update({
      where: { id: editingId, storeId: tenant.storeId },
      data: form,
    });
    await logActivity(tenant, "Warehouse Updated", `Warehouse "${form.name}" was edited.`);
  } else {
    warehouse = await db.warehouse.create({
      data: { ...form, storeId: tenant.storeId },
    });
    await logActivity(tenant, "Warehouse Created", `Warehouse "${form.name}" was created.`);

    // Auto-create stock records for existing products in this new warehouse
    const products = await db.product.findMany({
      where: { storeId: tenant.storeId },
      select: { id: true },
    });
    if (products.length > 0) {
      await db.stock.createMany({
        data: products.map(p => ({
          storeId: tenant.storeId,
          productId: p.id,
          warehouseId: warehouse.id,
          quantity: 0,
        })),
        skipDuplicates: true,
      });
    }
  }
  revalidatePath("/settings");
  return warehouse;
}

export async function deleteWarehouse(id: string) {
  const tenant = await requireTenant();
  const warehouse = await db.warehouse.delete({
    where: { id, storeId: tenant.storeId },
  });
  await logActivity(tenant, "Warehouse Deleted", `Warehouse "${warehouse.name}" was deleted.`);
  revalidatePath("/settings");
  return warehouse;
}

// Products
export async function getProducts() {
  const tenant = await requireTenant();
  return db.product.findMany({
    where: { storeId: tenant.storeId },
    include: {
      category: true,
      supplier: true,
    },
    orderBy: { name: "asc" },
  });
}

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
  initialStock?: number;
}, editingId?: string | null): Promise<{ success: boolean; message: string; product?: Awaited<ReturnType<typeof db.product.create>> }> {
  const tenant = await requireTenant();
  const storeId = tenant.storeId;

  const resolvedSupplierId = await (async () => {
    const supplierId = form.supplierId?.trim();
    if (supplierId) {
      const existingSupplier = await db.supplier.findFirst({
        where: { id: supplierId, storeId },
        select: { id: true },
      });
      if (existingSupplier) return existingSupplier.id;
    }

    const fallbackSupplier = await db.supplier.upsert({
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
    });

    return fallbackSupplier.id;
  })();

  const { stockQuantity, initialStock, ...validProductFields } = form;

  const productData = {
    ...validProductFields,
    supplierId: resolvedSupplierId,
    barcode: form.barcode?.trim() || undefined,
    description: form.description?.trim() || undefined,
    brand: form.brand?.trim() || undefined,
    sku: form.sku?.trim() || `PRD-${Date.now()}`,
  };

  let product: Awaited<ReturnType<typeof db.product.create>>;
  try {
    if (editingId) {
      product = await db.product.update({
        where: { id: editingId, storeId },
        data: productData,
      });
      await logActivity(tenant, "Product Updated", `SKU ${productData.sku} – "${productData.name}" was edited.`);

      if (stockQuantity !== undefined) {
        const warehouseId = await getDefaultWarehouseIdFor(storeId);
        await db.stock.upsert({
          where: { productId_warehouseId: { productId: product.id, warehouseId } },
          update: { quantity: stockQuantity },
          create: { storeId, productId: product.id, warehouseId, quantity: stockQuantity },
        });
      }
    } else {
      product = await db.product.create({
        data: { ...productData, storeId },
      });
      await logActivity(tenant, "Product Created", `New SKU ${productData.sku} – "${productData.name}" added to catalog.`);

      let warehouses = await db.warehouse.findMany({
        where: { storeId },
        select: { id: true },
      });
      if (warehouses.length === 0) {
        warehouses = [{ id: await getDefaultWarehouseIdFor(storeId) }];
      }

      const initialStockQty = Math.max(0, Math.floor(initialStock ?? form.minStockLevel ?? 0));
      await db.stock.createMany({
        data: warehouses.map(w => ({
          storeId,
          productId: product.id,
          warehouseId: w.id,
          quantity: initialStockQty,
        })),
      });
    }

    revalidatePath("/products");
    revalidatePath("/inventory");
    return {
      success: true,
      message: editingId ? "Product updated successfully." : "Product created successfully.",
      product,
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      console.error("Product uniqueness conflict", error);
      return {
        success: false,
        message: "SKU or barcode already exists. Please choose a different value.",
      };
    }

    console.error("Product save failed", error);
    return {
      success: false,
      message: "Unable to save product. Please try again.",
    };
  }
}

export async function deleteProduct(id: string) {
  const tenant = await requireTenant();
  const product = await db.product.delete({
    where: { id, storeId: tenant.storeId },
  });
  await logActivity(tenant, "Product Deleted", `SKU ${product.sku} – "${product.name}" removed from catalog.`);
  revalidatePath("/products");
  revalidatePath("/inventory");
  return product;
}
