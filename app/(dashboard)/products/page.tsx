"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Search, Plus, Edit2, Trash2, Package, AlertTriangle, CheckCircle2,
  ChevronDown, ChevronsUpDown, ChevronsDownUp,
} from "lucide-react";
import { toast } from "sonner";
import {
  saveProduct, deleteProduct, deleteProducts, ensureDefaultCategories,
} from "@/app/actions";
import { cn, formatNPR } from "@/lib/utils";
import { Pulse } from "@/components/shared/Pulse";
import { PlaceholderRows, PRODUCT_COLUMNS } from "@/components/skeletons/placeholders";
import { EmptyState } from "@/components/shared/EmptyState";
import { useResources } from "@/lib/useResources";
import { resources } from "@/lib/resources";
import { Dropdown } from "@/components/shared/Dropdown";
import { ShowMoreButton, useShowMore } from "@/components/shared/ShowMore";
import { Modal } from "@/components/shared/Modal";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/shared/Button";
import { mutate } from "@/lib/mutate";
import { useUrlState } from "@/lib/useUrlState";
import type { Product } from "@/lib/types";
import { SHOP_BRAND, productShop, useShop } from "@/lib/shop";
import { VariantMatrix, summarizeVariants, variantCountLabel } from "@/components/shared/VariantStock";

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

export default function ProductsPage() {
  const { products, categories, suppliers, stocks, loading, refetch } = useResources({
    products: resources.products,
    categories: resources.categories,
    suppliers: resources.suppliers,
    stocks: resources.stocks,
  });
  const [search, setSearch] = useUrlState("q");
  const shop = useShop();
  const [activeTab, setActiveTab] = useState("all");
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyProduct);
  const [variantRows, setVariantRows] = useState<VariantRow[]>([]);
  const [sizesText, setSizesText] = useState("");
  const [colorsText, setColorsText] = useState("");
  const [formSnapshot, setFormSnapshot] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Bulk actions: ticked products (by id) and the bulk-delete confirmation.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // Last ticked row's id, so Shift+click can tick (or untick) everything in between.
  const lastPicked = useRef<string | null>(null);
  // Products whose size × colour stock table is open under their row.
  const [stockOpen, setStockOpen] = useState<Set<string>>(() => new Set());
  const categoryOptions = categories;

  const stockByProduct = useMemo(() => {
    const totals = new Map<string, number>();
    for (const s of stocks) totals.set(s.productId, (totals.get(s.productId) ?? 0) + s.quantity);
    return totals;
  }, [stocks]);
  const categoryById = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories]);
  const supplierById = useMemo(() => new Map(suppliers.map(s => [s.id, s])), [suppliers]);

  const getTotalStock = (productId: string) => stockByProduct.get(productId) ?? 0;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(p => {
      const matchSearch =
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.barcode?.toLowerCase().includes(q) ||
        p.brand?.toLowerCase().includes(q);
      return matchSearch && (activeTab === "all" || p.categoryId === activeTab);
    });
  }, [products, search, activeTab]);

  const { visible: displayed, remaining, step, showMore } = useShowMore(filtered);

  const withSizes = displayed.filter(p => p.variants.length > 0);
  const allStockOpen = withSizes.length > 0 && withSizes.every(p => stockOpen.has(p.id));
  const toggleStock = (id: string) =>
    setStockOpen(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAllStock = () => setStockOpen(allStockOpen ? new Set() : new Set(withSizes.map(p => p.id)));

  const formIsDirty = JSON.stringify({ form, variantRows }) !== formSnapshot;
  const variantTotal = variantRows.reduce((sum, v) => sum + (Number(v.quantity) || 0), 0);
  const hasVariants = variantRows.length > 0;

  function openAdd() {
    // New products go to the shop being viewed.
    const next = {
      ...emptyProduct,
      categoryId: categories[0]?.id ?? "",
      supplierId: suppliers[0]?.id ?? "",
      brand: shop === "all" ? "" : SHOP_BRAND[shop],
    };
    setEditingId(null);
    setForm(next);
    setVariantRows([]);
    setSizesText("");
    setColorsText("");
    setFormSnapshot(JSON.stringify({ form: next, variantRows: [] }));
    setShowModal(true);
  }

  function openEdit(p: Product) {
    setEditingId(p.id);
    const { description, variantGroups: parsedGroups } = parseVariantPayload(p.description ?? "");
    const next: ProductForm = {
      name: p.name,
      sku: p.sku,
      barcode: p.barcode ?? "",
      description,
      brand: p.brand ?? "",
      categoryId: p.categoryId,
      supplierId: p.supplierId,
      costPrice: p.costPrice,
      sellingPrice: p.sellingPrice,
      stockQuantity: getTotalStock(p.id),
      minStockLevel: p.minStockLevel,
      status: p.status,
    };
    setForm(next);
    // Real rows win; otherwise carry over anything saved by the old editor.
    const rows: VariantRow[] = p.variants.length
      ? p.variants.map(v => ({ size: v.size, color: v.color, quantity: v.quantity }))
      : legacyRows(parsedGroups);
    setVariantRows(rows);
    setSizesText("");
    setColorsText("");
    setFormSnapshot(JSON.stringify({ form: next, variantRows: rows }));
    setShowModal(true);
  }

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
    if (result.ok) {
      setShowModal(false);
      await refetch();
    }
    setSaving(false);
  }

  // Only ids that still exist count (a product may have been deleted elsewhere).
  const selectedIds = products.filter(p => selected.has(p.id)).map(p => p.id);
  /** Ticks/unticks one row; with Shift held, every shown row from the last one clicked to this one follows it. */
  const pickRow = (id: string, shiftKey: boolean, rows: { id: string }[]) => {
    setSelected(current => {
      const next = new Set(current);
      const turnOn = !current.has(id);
      const from = shiftKey && lastPicked.current ? rows.findIndex(r => r.id === lastPicked.current) : -1;
      const to = rows.findIndex(r => r.id === id);
      const range = from >= 0 && to >= 0 ? rows.slice(Math.min(from, to), Math.max(from, to) + 1) : [{ id }];
      for (const row of range) {
        if (turnOn) next.add(row.id);
        else next.delete(row.id);
      }
      return next;
    });
    lastPicked.current = id;
  };

  async function confirmBulkDelete() {
    if (selectedIds.length === 0) return;
    setBulkDeleting(true);
    const result = await mutate(() => deleteProducts(selectedIds), {
      loading: `Deleting ${selectedIds.length} product${selectedIds.length === 1 ? "" : "s"}…`,
      success: data => `${data.deleted} product${data.deleted === 1 ? "" : "s"} deleted.`,
    });
    setBulkDeleting(false);
    setBulkOpen(false);
    if (result.ok) {
      if (result.data.kept.length > 0) {
        toast.warning(
          `Kept ${result.data.kept.length} with sales or purchase history: ${result.data.kept.join(", ")}. Set them to Inactive instead.`,
          { duration: 9000 }
        );
      }
      setSelected(new Set());
      await refetch();
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const result = await mutate(() => deleteProduct(deleteTarget.id), {
      success: `"${deleteTarget.name}" deleted.`,
    });
    setDeleteOpen(false);
    if (result.ok) await refetch();
  }

  const margin = (p: Product) => (p.sellingPrice > 0 ? (((p.sellingPrice - p.costPrice) / p.sellingPrice) * 100).toFixed(0) : "0");

  const seededCategories = useRef(false);

  // New stores start with a useful category list.
  useEffect(() => {
    if (loading || categories.length > 0 || seededCategories.current) return;
    seededCategories.current = true;
    void ensureDefaultCategories()
      .then(result => (result.ok && result.data.created > 0 ? refetch() : undefined))
      .catch(error => console.error("Failed to create default categories", error));
  }, [categories.length, loading, refetch]);

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

  const productModal = (
    <Modal
      open={showModal}
      onClose={() => setShowModal(false)}
      title={editingId ? "Edit Product" : "Add New Product"}
      size="lg"
      busy={saving}
      dirty={formIsDirty}
      footer={
        <>
          <Button variant="secondary" onClick={() => setShowModal(false)} disabled={saving} className="flex-1">Cancel</Button>
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
                placeholder="e.g. ProBook Laptop 14-inch"
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
                options={categoryOptions.map(c => ({ value: c.id, label: c.name }))}
              />
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

  const bulkDeleteModal = (
    <ConfirmDialog
      open={bulkOpen}
      onClose={() => !bulkDeleting && setBulkOpen(false)}
      onConfirm={confirmBulkDelete}
      title={`Delete ${selectedIds.length} product${selectedIds.length === 1 ? "" : "s"}?`}
      description="This can't be undone. Any with sales or purchase history are skipped and kept, so set those to Inactive instead."
      confirmLabel={`Delete ${selectedIds.length}`}
    />
  );

  const deleteModal = (
    <ConfirmDialog
      open={deleteOpen}
      onClose={() => setDeleteOpen(false)}
      onConfirm={confirmDelete}
      title={`Delete ${deleteTarget?.name ?? "product"}?`}
      description="This can't be undone. Products with sales or purchase history can't be deleted, so set those to Inactive instead."
      confirmLabel="Delete"
    />
  );

  return (
<>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Product Catalog</h1>
          {loading ? <Pulse className="h-3 w-44 mt-1.5" /> : <p className="text-xs text-muted-foreground mt-0.5">{products.length} total SKUs across all categories</p>}
        </div>
        <Button onClick={openAdd} className="shrink-0">
          <Plus size={16} />
          Add New Product
        </Button>
      </div>

      {/* Search & Category Tabs */}
      <div className="flex flex-col md:flex-row gap-3 my-4  ">
        <div className="relative flex-1 ">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15} />
          <input value={search} onChange={e => setSearch(e.target.value)} aria-label="Search products" placeholder="Search by name, SKU, barcode or brand..." className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground/50 transition-all" />
        </div>
        <div className="flex gap-1.5 bg-muted/50 border border-border/60 rounded-xl p-1 overflow-x-auto md:max-w-[55%]">
          <button type="button" aria-pressed={activeTab === "all"} onClick={() => setActiveTab("all")} className={cn("px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all", activeTab === "all" ? "bg-card text-foreground shadow-sm border border-border/60" : "text-muted-foreground hover:text-foreground")}>All SKUs</button>
          {categoryOptions.map(c => (
            <button key={c.id} type="button" aria-pressed={activeTab === c.id} onClick={() => setActiveTab(c.id)} className={cn("px-3 py-1.5 cursor-pointer rounded-lg text-xs font-semibold whitespace-nowrap transition-all", activeTab === c.id ? "bg-card text-foreground shadow-sm border border-border/60" : "text-muted-foreground hover:text-foreground")}>
              {c.name}
            </button>
          ))}
        </div>
      </div>


      {/* Bulk actions */}
      {selectedIds.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-2.5">
          <p className="text-sm font-semibold">{selectedIds.length} selected</p>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={() => setSelected(new Set())} className="px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors cursor-pointer">
              Clear
            </button>
            <button type="button" onClick={() => setBulkOpen(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors cursor-pointer">
              <Trash2 size={13} /> Delete selected
            </button>
          </div>
        </div>
      )}

      {/* Products Table */}
      <div className="bg-card border border-border/80 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-muted/30">
                <th className="w-10 pl-5 pr-0 py-3.5">
                  <input
                    type="checkbox"
                    aria-label="Select all shown products"
                    className="h-4 w-4 accent-[var(--primary)] cursor-pointer align-middle"
                    disabled={loading || displayed.length === 0}
                    checked={displayed.length > 0 && displayed.every(p => selected.has(p.id))}
                    ref={el => {
                      if (el) el.indeterminate = displayed.some(p => selected.has(p.id)) && !displayed.every(p => selected.has(p.id));
                    }}
                    onChange={e => {
                      const all = e.target.checked;
                      setSelected(current => {
                        const next = new Set(current);
                        for (const p of displayed) {
                          if (all) next.add(p.id);
                          else next.delete(p.id);
                        }
                        return next;
                      });
                    }}
                  />
                </th>
                <th className="text-left px-5 py-3.5 text-xs font-bold text-muted-foreground uppercase tracking-wider">Product</th>
                <th className="text-left px-4 py-3.5 text-xs font-bold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Category</th>
                <th className="text-left px-4 py-3.5 text-xs font-bold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Supplier</th>
                <th className="text-right px-4 py-3.5 text-xs font-bold text-muted-foreground uppercase tracking-wider">Price</th>
                <th className="text-right px-4 py-3.5 text-xs font-bold text-muted-foreground uppercase tracking-wider hidden md:table-cell">
                  <span className="inline-flex items-center justify-end gap-1">
                    Stock
                    {!loading && withSizes.length > 0 && (
                      <button
                        type="button"
                        onClick={toggleAllStock}
                        aria-label={allStockOpen ? "Hide all sizes and colours" : "Show sizes and colours for every product"}
                        title={allStockOpen ? "Hide all sizes and colours" : "Show all sizes and colours"}
                        className="w-5 h-5 inline-flex items-center justify-center rounded-md hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                      >
                        {allStockOpen ? <ChevronsDownUp size={13} /> : <ChevronsUpDown size={13} />}
                      </button>
                    )}
                  </span>
                </th>
                <th className="text-center px-4 py-3.5 text-xs font-bold text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="relative px-4 py-3.5"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {loading && <PlaceholderRows columns={[{ label: "", cell: () => null }, ...PRODUCT_COLUMNS]} cellClassName="px-5 py-4" />}
              {!loading && filtered.length === 0 && (
                products.length === 0 ? (
                  <EmptyState
                    colSpan={8}
                    icon={Package}
                    title="No products yet"
                    description="Create your first product to start building your catalog."
                    action={
                      <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors cursor-pointer">
                        <Plus size={15} /> Add New Product
                      </button>
                    }
                  />
                ) : (
                  <EmptyState colSpan={8} icon={Search} title="No matching products" description="Try adjusting your search or category filter." />
                )
              )}
              {!loading && displayed.map(p => {
                const cat = categoryById.get(p.categoryId);
                const sup = supplierById.get(p.supplierId);
                const totalStock = getTotalStock(p.id);
                const isLow = totalStock < p.minStockLevel;
                const summary = p.variants.length > 0 ? summarizeVariants(p.variants) : null;
                const open = summary !== null && stockOpen.has(p.id);
                const sizesButton = (className: string, iconSize: number) => summary && (
                  <button
                    type="button"
                    onClick={() => toggleStock(p.id)}
                    aria-expanded={open}
                    aria-controls={`stock-${p.id}`}
                    title={open ? "Hide sizes and colours" : "Show stock by size and colour"}
                    className={cn("inline-flex items-center gap-1 transition-colors cursor-pointer", className)}
                  >
                    {variantCountLabel(summary)}
                    <ChevronDown size={iconSize} className={cn("transition-transform", open && "rotate-180")} />
                  </button>
                );
                return (
                  <React.Fragment key={p.id}>
                  <tr className={cn("data-row group", open && "bg-muted/20 border-b-0", selected.has(p.id) && "bg-primary/5")}>
                    <td className="w-10 pl-5 pr-0 py-4">
                      <input
                        type="checkbox"
                        aria-label={`Select ${p.name}`}
                        className="h-4 w-4 accent-[var(--primary)] cursor-pointer align-middle"
                        checked={selected.has(p.id)}
                        onChange={e => pickRow(p.id, (e.nativeEvent as MouseEvent).shiftKey === true, displayed)}
                      />
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-primary/8 border border-border/40 flex items-center justify-center shrink-0">
                          <Package size={16} className="text-primary/70" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground truncate max-w-[180px]">{p.name}</p>
                          <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{p.sku}</p>
                          {/* Category + stock surfaced here on mobile, where their dedicated columns are hidden */}
                          <div className="flex flex-wrap items-center gap-1.5 mt-1 md:hidden">
                            <span className="text-[10px] bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded font-medium">{cat?.name ?? "—"}</span>
                            <span className={cn("inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded", isLow ? "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400" : "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400")}>
                              {isLow ? <AlertTriangle size={9} /> : <CheckCircle2 size={9} />}
                              {totalStock} units
                            </span>
                            {sizesButton("text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground hover:text-foreground", 10)}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 hidden md:table-cell">
                      <span className="text-xs bg-secondary text-secondary-foreground px-2.5 py-1 rounded-lg font-medium">{cat?.name ?? "—"}</span>
                    </td>
                    <td className="px-4 py-4 hidden lg:table-cell">
                      <p className="text-xs text-muted-foreground">{sup?.companyName ?? "—"}</p>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <p className="font-bold text-foreground">{formatNPR(p.sellingPrice)}</p>
                      <p className="text-[11px] text-muted-foreground">cost {formatNPR(p.costPrice)} · <span className="text-emerald-700 dark:text-emerald-400 font-semibold">{margin(p)}% margin</span></p>
                    </td>
                    <td className="px-4 py-4 text-right hidden md:table-cell">
                      <div className="flex flex-col items-end gap-1">
                        <div className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold", isLow ? "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400" : "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400")}>
                          {isLow ? <AlertTriangle size={11} /> : <CheckCircle2 size={11} />}
                          {totalStock} units
                        </div>
                        {sizesButton("-mr-1.5 px-1.5 py-0.5 rounded-md text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted", 12)}
                        {summary && summary.soldOut.length > 0 ? (
                          <span title={`Sold out: ${summary.soldOut.join(", ")}`} className="text-[11px] font-semibold text-red-600 dark:text-red-400">
                            {summary.soldOut.length} of {summary.options} sold out
                          </span>
                        ) : summary && summary.low.length > 0 ? (
                          <span title={`Running low: ${summary.low.join(", ")}`} className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                            {summary.low.length} running low
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-center">
                      <span className={cn("text-[11px] font-bold uppercase px-2.5 py-1 rounded-full", p.status === "active" ? "bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500")}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity justify-end">
                        <button type="button" onClick={() => openEdit(p)} aria-label={`Edit ${p.name}`} className="w-8 h-8 md:w-7 md:h-7 flex items-center justify-center rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                          <Edit2 size={13} />
                        </button>
                        <button type="button" onClick={() => { setDeleteTarget(p); setDeleteOpen(true); }} aria-label={`Delete ${p.name}`} className="w-8 h-8 md:w-7 md:h-7 flex items-center justify-center rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 text-muted-foreground hover:text-red-500 transition-colors cursor-pointer">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {open && (
                    <tr id={`stock-${p.id}`} className={cn("bg-muted/20", selected.has(p.id) && "bg-primary/5")}>
                      <td colSpan={8} className="px-5 pt-0 pb-4">
                        <VariantMatrix variants={p.variants} onEdit={() => openEdit(p)} className="md:ml-10 w-fit max-w-full" />
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {!loading && <ShowMoreButton remaining={remaining} step={step} onClick={showMore} />}
      </div>

      {productModal}
      {deleteModal}
      {bulkDeleteModal}
</>
  );
}

