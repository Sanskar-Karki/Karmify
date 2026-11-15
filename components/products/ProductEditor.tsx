"use client";

// The add / edit product form, shared by the catalog and a product's own page.

import React, { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { saveProduct, saveSupplier } from "@/app/actions";
import { Dropdown } from "@/components/shared/Dropdown";
import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/shared/Button";
import { mutate } from "@/lib/mutate";
import { SHOP_BRAND, productShop } from "@/lib/shop";
import type { Product } from "@/lib/types";

type ProductForm = {
  name: string; sku: string; barcode: string; description: string; brand: string;
  categoryId: string; supplierId: string; costPrice: number; sellingPrice: number;
  stockQuantity: number; minStockLevel: number; status: string;
};

/** Stock for one size/colour combination. */
type VariantRow = { size: string; color: string; quantity: number };

// Sizes saved by the old editor (hidden in the description), kept readable so
// they can be carried over the first time such a product is opened.
type LegacyOption = { name: string; quantity: number; childGroups?: { name: string; options: LegacyOption[] }[] };
type LegacyGroup = { name: string; options: LegacyOption[] };

const STATUS_OPTIONS = [
  { value: "active", label: "Active (shown in POS)" },
  { value: "inactive", label: "Inactive (hidden from POS)" },
];

const emptyProduct: ProductForm = {
  name: "", sku: "", barcode: "", description: "", brand: "",
  categoryId: "", supplierId: "", costPrice: 0, sellingPrice: 0,
  stockQuantity: 0, minStockLevel: 5, status: "active"
};

const generateSku = (name: string, categoryName?: string) => {
  const safeName = name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const safeCategory = (categoryName || "PRD").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const base = safeName || "ITEM";
  const category = safeCategory || "PRD";
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `${category}-${base}-${suffix}`.slice(0, 24);
};

const parseVariantPayload = (value: string) => {
  const parts = value.split("\n").filter(Boolean);
  const variantPart = parts.find(part => part.startsWith("__VARIANTS__:"));
  const description = parts.filter(part => !part.startsWith("__VARIANTS__:")).join("\n");
  if (!variantPart) return { description, variantGroups: [] as LegacyGroup[] };

  try {
    const parsed = JSON.parse(variantPart.replace("__VARIANTS__:", ""));
    return { description, variantGroups: parsed as LegacyGroup[] };
  } catch {
    return { description, variantGroups: [] as LegacyGroup[] };
  }
};

/** Old groups as rows: "Size: M → Colour: Navy (3)" becomes { size: "M", color: "Navy", quantity: 3 }. */
const legacyRows = (groups: LegacyGroup[]): VariantRow[] => {
  const first = groups[0];
  if (!first) return [];
  return first.options.flatMap(option => {
    const child = option.childGroups?.[0];
    return child?.options.length
      ? child.options.map(c => ({ size: option.name, color: c.name, quantity: Number(c.quantity) || 0 }))
      : [{ size: option.name, color: "", quantity: Number(option.quantity) || 0 }];
  }).filter(row => row.size || row.color);
};

const splitList = (text: string) => [...new Set(text.split(/[,\n]/).map(s => s.trim()).filter(Boolean))];

/** What the form opens on: a new product (for a shop), or an existing one. */
export type EditorTarget = { mode: "add"; brand: string } | { mode: "edit"; product: Product };

type Props = {
  /** null keeps the form closed. */
  target: EditorTarget | null;
  categories: { id: string; name: string }[];
  suppliers: { id: string; companyName: string }[];
  /** The product's current stock total. */
  currentStock: (productId: string) => number;
  onClose: () => void;
  /** After a successful save. */
  onSaved: () => Promise<unknown> | void;
  /** A supplier was added from inside the form. */
  onSuppliersChanged: () => Promise<unknown> | void;
};

/** Opens fresh each time: the form state starts from `target`. */
export function ProductEditor({ target, ...props }: Props) {
  if (!target) return null;
  return <Editor key={target.mode === "edit" ? target.product.id : "new"} target={target} {...props} />;
}

function initialFor(target: EditorTarget, categories: Props["categories"], suppliers: Props["suppliers"], currentStock: Props["currentStock"]) {
  if (target.mode === "add") {
    const form: ProductForm = {
      ...emptyProduct,
      categoryId: categories[0]?.id ?? "",
      supplierId: suppliers[0]?.id ?? "",
      brand: target.brand,
    };
    return { form, rows: [] as VariantRow[] };
  }
  const p = target.product;
  const { description, variantGroups } = parseVariantPayload(p.description ?? "");
  const form: ProductForm = {
    name: p.name,
    sku: p.sku,
    barcode: p.barcode ?? "",
    description,
    brand: p.brand ?? "",
    categoryId: p.categoryId,
    supplierId: p.supplierId,
    costPrice: p.costPrice,
    sellingPrice: p.sellingPrice,
    stockQuantity: currentStock(p.id),
    minStockLevel: p.minStockLevel,
    status: p.status,
  };
  // Real rows win; otherwise carry over anything saved by the old editor.
  const rows: VariantRow[] = p.variants.length
    ? p.variants.map(v => ({ size: v.size, color: v.color, quantity: v.quantity }))
    : legacyRows(variantGroups);
  return { form, rows };
}

function Editor({ target, categories, suppliers, currentStock, onClose, onSaved, onSuppliersChanged }: Props & { target: EditorTarget }) {
  const editingId = target.mode === "edit" ? target.product.id : null;
  const [initial] = useState(() => initialFor(target, categories, suppliers, currentStock));
  const [form, setForm] = useState<ProductForm>(initial.form);
  const [variantRows, setVariantRows] = useState<VariantRow[]>(initial.rows);
  const [sizesText, setSizesText] = useState("");
  const [colorsText, setColorsText] = useState("");
  const [saving, setSaving] = useState(false);
  // Adding a supplier from inside the product form.
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState("");
  const [savingSupplier, setSavingSupplier] = useState(false);
  const categoryById = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories]);

  const formIsDirty = JSON.stringify({ form, variantRows }) !== JSON.stringify({ form: initial.form, variantRows: initial.rows });
  const variantTotal = variantRows.reduce((sum, v) => sum + (Number(v.quantity) || 0), 0);
  const hasVariants = variantRows.length > 0;

  async function handleSave() {
    const missing: string[] = [];
    if (!form.name.trim()) missing.push("Product Name");
    if (!form.categoryId) missing.push("Category");
    if (!(form.costPrice > 0)) missing.push("Cost Price");
    if (!(form.sellingPrice > 0)) missing.push("Selling Price");
    // A product that has sold out still has to be editable, so 0 is only
    // rejected when creating one.
    if (!editingId && !hasVariants && !(form.stockQuantity > 0)) missing.push("Stock");
    if (variantRows.some(v => !v.size.trim() && !v.color.trim())) {
      toast.error("Every size/colour row needs a size or a colour (or remove the empty row).");
      return;
    }
    if (missing.length > 0) {
      toast.error(`Please fill required fields: ${missing.join(", ")}`);
      return;
    }

    const supplierId = form.supplierId || suppliers[0]?.id || "";

    if (form.sellingPrice < form.costPrice) {
      toast.warning("Selling price is below cost. Saving anyway.", { id: "below-cost" });
    }

    setSaving(true);
    const result = await mutate(
      () => saveProduct({
        ...form,
        description: form.description.trim(),
        // With sizes, stock is their total; the old hidden variant text is dropped on save.
        stockQuantity: hasVariants ? variantTotal : form.stockQuantity,
        variants: variantRows,
        supplierId,
        sku: form.sku.trim() || generateSku(form.name, categoryById.get(form.categoryId)?.name),
      }, editingId),
      { success: editingId ? "Product updated." : "Product created." }
    );
    setSaving(false);
    if (result.ok) {
      onClose();
      await onSaved();
    }
  }

  /** Creates a supplier by name (other details can be filled in Settings) and picks it. */
  async function addSupplier() {
    const companyName = newSupplierName.trim();
    if (!companyName) return void toast.error("Type the supplier's name first.");
    const existing = suppliers.find(s => s.companyName.trim().toLowerCase() === companyName.toLowerCase());
    if (existing) {
      setForm(f => ({ ...f, supplierId: existing.id }));
      setAddingSupplier(false);
      return;
    }
    setSavingSupplier(true);
    const result = await mutate(
      () => saveSupplier({ companyName, contactPerson: "-", phone: "-", email: "-", address: "-" }),
      { success: `Supplier "${companyName}" added.` }
    );
    setSavingSupplier(false);
    if (!result.ok) return;
    setForm(f => ({ ...f, supplierId: result.data.id }));
    setAddingSupplier(false);
    await onSuppliersChanged();
  }

  /** Adds every size × colour typed above that isn't in the table yet (at 0). */
  function addCombinations() {
    const sizes = splitList(sizesText);
    const colors = splitList(colorsText);
    if (sizes.length === 0 && colors.length === 0) {
      toast.error("Type some sizes and/or colours first, e.g. S, M, L.");
      return;
    }
    const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
    setVariantRows(current => {
      const next = [...current];
      for (const size of sizes.length ? sizes : [""]) {
        for (const color of colors.length ? colors : [""]) {
          if (!next.some(v => same(v.size, size) && same(v.color, color))) next.push({ size, color, quantity: 0 });
        }
      }
      return next;
    });
    setSizesText("");
    setColorsText("");
  }
  const updateRow = (index: number, patch: Partial<VariantRow>) =>
    setVariantRows(current => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <Modal
      open
      onClose={() => onClose()}
      title={editingId ? "Edit Product" : "Add New Product"}
      size="lg"
      busy={saving}
      dirty={formIsDirty}
      footer={
        <>
          <Button variant="secondary" onClick={() => onClose()} disabled={saving} className="flex-1">Cancel</Button>
          <Button onClick={handleSave} loading={saving} className="flex-1">
            {saving ? "Saving…" : editingId ? "Save Changes" : "Create Product"}
          </Button>
        </>
      }
    >
        <div className="p-5 sm:p-6 space-y-4">
          {/* Required fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs font-semibold text-muted-foreground">Product Name <span className="text-primary">*</span></label>
              <input
                type="text"
                data-autofocus
                aria-label="Product Name"
                placeholder="e.g. Pu Leather Jacket"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-xl border border-border/60 bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/30 transition-all hover:border-border/80"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">SKU</label>
              <input
                type="text"
                readOnly
                value={form.sku || "Generated when saved"}
                aria-label="SKU"
                className="w-full px-3 py-2.5 rounded-xl border border-border/60 bg-muted/40 text-foreground text-sm cursor-not-allowed"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Category <span className="text-primary">*</span></label>
              <Dropdown
                aria-label="Category"
                value={form.categoryId}
                onChange={v => setForm(f => ({ ...f, categoryId: v }))}
                disabled={categories.length === 0}
                placeholder={categories.length === 0 ? "Setting up categories..." : "Select category..."}
                options={categories.map(c => ({ value: c.id, label: c.name }))}
              />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs font-semibold text-muted-foreground">Supplier</label>
              {addingSupplier ? (
                <div className="flex gap-2">
                  <input
                    autoFocus
                    aria-label="New supplier name"
                    placeholder="Supplier or workshop name"
                    value={newSupplierName}
                    onChange={e => setNewSupplierName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") { e.preventDefault(); void addSupplier(); }
                      if (e.key === "Escape") { e.stopPropagation(); setAddingSupplier(false); }
                    }}
                    className="min-w-0 flex-1 px-3 py-2.5 rounded-xl border border-border/60 bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <Button onClick={addSupplier} loading={savingSupplier} className="shrink-0 px-3 py-2 text-xs">Add</Button>
                  <Button variant="secondary" onClick={() => setAddingSupplier(false)} disabled={savingSupplier} className="shrink-0 px-3 py-2 text-xs">Cancel</Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <div className="min-w-0 flex-1">
                    <Dropdown
                      aria-label="Supplier"
                      value={form.supplierId}
                      onChange={v => setForm(f => ({ ...f, supplierId: v }))}
                      placeholder={suppliers.length === 0 ? "No suppliers yet (General Supplier is used)" : "Select supplier..."}
                      disabled={suppliers.length === 0}
                      options={suppliers.map(s => ({ value: s.id, label: s.companyName }))}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => { setNewSupplierName(""); setAddingSupplier(true); }}
                    className="shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-semibold bg-primary/10 text-primary hover:bg-primary/15 cursor-pointer"
                  >
                    <Plus size={13} /> New
                  </button>
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">Who makes or supplies this product. Full supplier details are in Settings.</p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Cost Price (Rs.) <span className="text-primary">*</span></label>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                aria-label="Cost Price"
                placeholder="0.00"
                value={form.costPrice || ""}
                onChange={e => setForm(f => ({ ...f, costPrice: parseFloat(e.target.value) || 0 }))}
                className="w-full px-3 py-2.5 rounded-xl border border-border/60 bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40  focus:border-primary/30 transition-all hover:border-border/80"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Selling Price (Rs.) <span className="text-primary">*</span></label>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                aria-label="Selling Price"
                placeholder="0.00"
                value={form.sellingPrice || ""}
                onChange={e => setForm(f => ({ ...f, sellingPrice: parseFloat(e.target.value) || 0 }))}
                className="w-full px-3 py-2.5 rounded-xl border border-border/60 bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/30 transition-all hover:border-border/80"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Stock <span className="text-primary">*</span></label>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                aria-label="Stock"
                placeholder="0"
                value={hasVariants ? variantTotal : form.stockQuantity || ""}
                onChange={e => setForm(f => ({ ...f, stockQuantity: Math.max(0, parseInt(e.target.value) || 0) }))}
                disabled={hasVariants}
                title={hasVariants ? "Total of the sizes/colours below" : undefined}
                className="w-full px-3 py-2.5 rounded-xl border border-border/60 bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/30 transition-all hover:border-border/80"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="product-min-stock" className="text-xs font-semibold text-muted-foreground">Low-stock alert at</label>
              <input
                id="product-min-stock"
                type="number"
                inputMode="numeric"
                min={0}
                value={form.minStockLevel}
                onChange={e => setForm(f => ({ ...f, minStockLevel: Math.max(0, parseInt(e.target.value) || 0) }))}
                className="w-full px-3 py-2.5 rounded-xl border border-border/60 bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/30 transition-all hover:border-border/80"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Status</label>
              <Dropdown aria-label="Status" value={form.status} onChange={v => setForm(f => ({ ...f, status: v }))} options={STATUS_OPTIONS} />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="product-barcode" className="text-xs font-semibold text-muted-foreground">Barcode</label>
              <input
                id="product-barcode"
                value={form.barcode}
                onChange={e => setForm(f => ({ ...f, barcode: e.target.value }))}
                placeholder="Scan or type"
                className="w-full px-3 py-2.5 rounded-xl border border-border/60 bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/30 transition-all hover:border-border/80"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="product-brand" className="text-xs font-semibold text-muted-foreground">Shop</label>
              <select
                id="product-brand"
                value={productShop(form.brand) ? SHOP_BRAND[productShop(form.brand)!] : form.brand}
                onChange={e => setForm(f => ({ ...f, brand: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-xl border border-border/60 bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/30 transition-all hover:border-border/80"
              >
                <option value="">Not set (shows under All shops only)</option>
                <option value={SHOP_BRAND.originals}>{SHOP_BRAND.originals}</option>
                <option value={SHOP_BRAND.decor}>{SHOP_BRAND.decor}</option>
                {form.brand && !productShop(form.brand) && <option value={form.brand}>{form.brand}</option>}
              </select>
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs font-semibold text-muted-foreground">Description</label>
              <textarea
                rows={3}
                placeholder="Add product description..."
                value={form.description ?? ""}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-xl border border-border/60 bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/30 resize-none transition-all hover:border-border/80"
              />
            </div>
          </div>

          <div className="border-t border-border/50 pt-3 space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Sizes &amp; colours</h3>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                For clothing: stock per size and colour. The product&apos;s stock becomes their total, and sales take from the exact size sold.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
              <label className="space-y-1">
                <span className="text-[12px] font-semibold text-muted-foreground">Sizes</span>
                <input value={sizesText} onChange={e => setSizesText(e.target.value)} placeholder="S, M, L, XL" className="w-full px-3 py-2 rounded-lg border border-border/60 bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
              </label>
              <label className="space-y-1">
                <span className="text-[12px] font-semibold text-muted-foreground">Colours</span>
                <input value={colorsText} onChange={e => setColorsText(e.target.value)} placeholder="Black, Navy" className="w-full px-3 py-2 rounded-lg border border-border/60 bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
              </label>
              <button type="button" onClick={addCombinations} className="px-3 py-2 rounded-lg text-xs font-semibold bg-primary/10 text-primary hover:bg-primary/15 cursor-pointer whitespace-nowrap">
                Create combinations
              </button>
            </div>

            {hasVariants && (
              <div className="rounded-xl border border-border/60 overflow-hidden">
                <div className="grid grid-cols-[1fr_1fr_6rem_2rem] gap-2 px-3 py-2 bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <span>Size</span><span>Colour</span><span className="text-right">Stock</span><span />
                </div>
                <div className="divide-y divide-border/40 max-h-64 overflow-y-auto">
                  {variantRows.map((row, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_6rem_2rem] gap-2 px-3 py-1.5 items-center">
                      <input value={row.size} onChange={e => updateRow(i, { size: e.target.value })} placeholder="—" aria-label={`Size ${i + 1}`} className="w-full px-3 py-2 rounded-lg border border-border/60 bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 py-1.5" />
                      <input value={row.color} onChange={e => updateRow(i, { color: e.target.value })} placeholder="—" aria-label={`Colour ${i + 1}`} className="w-full px-3 py-2 rounded-lg border border-border/60 bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 py-1.5" />
                      <input
                        type="number" inputMode="numeric" min={0}
                        value={row.quantity}
                        onChange={e => updateRow(i, { quantity: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                        onFocus={e => e.target.select()}
                        aria-label={`Stock for ${[row.size, row.color].filter(Boolean).join(" ") || "row " + (i + 1)}`}
                        className="w-full px-3 py-2 rounded-lg border border-border/60 bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 py-1.5 text-right"
                      />
                      <button type="button" onClick={() => setVariantRows(rows => rows.filter((_, j) => j !== i))} aria-label="Remove row" className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-500/10 cursor-pointer">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between px-3 py-2 bg-muted/30 text-xs">
                  <button type="button" onClick={() => setVariantRows(rows => [...rows, { size: "", color: "", quantity: 0 }])} className="font-semibold text-primary hover:underline cursor-pointer">
                    + Add row
                  </button>
                  <span className="font-semibold">Total stock: {variantTotal}</span>
                </div>
              </div>
            )}
          </div>
        </div>
    </Modal>
  );
}
