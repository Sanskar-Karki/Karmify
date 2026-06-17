import { z } from "zod";

export const ProductFormSchema = z.object({
  name: z.string().min(2, "Product name must be at least 2 characters"),
  sku: z.string().min(3, "SKU must be at least 3 characters"),
  barcode: z.string().optional().or(z.literal("")),
  description: z.string().optional().or(z.literal("")),
  brand: z.string().optional().or(z.literal("")),
  categoryId: z.string().uuid("Please select a valid category"),
  supplierId: z.string().uuid("Please select a valid supplier"),
  costPrice: z.coerce.number().positive("Cost price must be greater than 0"),
  sellingPrice: z.coerce.number().positive("Selling price must be greater than 0"),
  minStockLevel: z.coerce.number().int().nonnegative("Minimum stock level must be 0 or greater"),
  imageUrl: z.string().url("Please provide a valid image URL").optional().or(z.literal("")),
  expiryDate: z.string().optional().or(z.literal("")),
  // Used strictly on creation for initial stock allocation
  warehouseId: z.string().uuid("Please select an initial warehouse").optional(),
  initialStock: z.coerce.number().int().nonnegative("Initial stock must be 0 or greater").optional(),
}).refine((data) => data.sellingPrice >= data.costPrice, {
  message: "Selling price must be greater than or equal to cost price",
  path: ["sellingPrice"],
});

export type ProductFormValues = z.infer<typeof ProductFormSchema>;
