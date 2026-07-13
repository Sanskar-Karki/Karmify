"use client";

import { Skeleton } from "boneyard-js/react";
import { ProductsFixture } from "@/components/skeletons/fixtures";
import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  Search, Plus, Edit2, Trash2, Package, X, ChevronDown, AlertTriangle, CheckCircle2
} from "lucide-react";
import { toast } from "sonner";
import {
  saveProduct, deleteProduct, saveCategory,
} from "@/app/actions";
import { cn, formatNPR } from "@/lib/utils";
import { Pulse } from "@/components/shared/Pulse";
import { EmptyState } from "@/components/shared/EmptyState";
import { useResources } from "@/lib/useResources";
import { resources } from "@/lib/resources";

type ProductForm = {
  name: string; sku: string; barcode: string; description: string; brand: string;
  categoryId: string; supplierId: string; costPrice: number; sellingPrice: number;
  stockQuantity: number; minStockLevel: number; status: string;
};

type VariantOption = {
  id: string;
  name: string;
  quantity: number;
  childGroups: VariantGroup[];
};

type VariantGroup = {
  id: string;
  name: string;
  options: VariantOption[];
};

const emptyProduct: ProductForm = {
  name: "", sku: "", barcode: "", description: "", brand: "",
  categoryId: "", supplierId: "", costPrice: 0, sellingPrice: 0,
  stockQuantity: 0, minStockLevel: 5, status: "active"
};

const fallbackCategories = [
  { id: "fallback-lamp", name: "Lamp", description: "Decorative and functional lamps" },
  { id: "fallback-light", name: "Light", description: "Lighting fixtures and bulbs" },
  { id: "fallback-soft-toys", name: "Soft Toys", description: "Plush toys and kids' soft products" },
  { id: "fallback-electronics-decor", name: "Electronics Decor", description: "Decorative electronics and gadget accessories" },
  { id: "fallback-home-decor", name: "Home Decor", description: "Decorative items for living spaces" },
  { id: "fallback-kitchen", name: "Kitchen", description: "Kitchenware and home essentials" },
  { id: "fallback-fashion", name: "Fashion", description: "Clothing and accessories" },
  { id: "fallback-electronics", name: "Electronics", description: "Phones, gadgets, and accessories" },
  { id: "fallback-furniture", name: "Furniture", description: "Tables, chairs, and home furniture" },
  { id: "fallback-beauty", name: "Beauty", description: "Cosmetics and personal care items" },
  { id: "fallback-sports", name: "Sports", description: "Athletic gear and outdoor equipment" },
  { id: "fallback-books", name: "Books", description: "Printed and digital reading materials" },
  { id: "fallback-toys", name: "Toys", description: "Children's toys and entertainment products" },
  { id: "fallback-pet", name: "Pet Supplies", description: "Pet food, toys, and accessories" },
  { id: "fallback-health", name: "Health", description: "Wellness and personal health products" },
  { id: "fallback-other", name: "Other", description: "Miscellaneous products" },
];

const createVariantOption = (): VariantOption => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  name: "",
  quantity: 0,
  childGroups: [],
});

const createVariantGroup = (): VariantGroup => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  name: "",
  options: [createVariantOption()],
});

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
  if (!variantPart) return { description, variantGroups: [] as VariantGroup[] };

  try {
    const parsed = JSON.parse(variantPart.replace("__VARIANTS__:", ""));
    return { description, variantGroups: parsed as VariantGroup[] };
  } catch {
    return { description, variantGroups: [] as VariantGroup[] };
  }
};

const serializeVariantPayload = (description: string, groups: VariantGroup[]) => {
  const baseDescription = description.trim();
  return groups.length > 0 ? [baseDescription, `__VARIANTS__:${JSON.stringify(groups)}`].filter(Boolean).join("\n") : baseDescription;
};

const calculateGroupChildrenTotal = (group: VariantGroup) =>
  group.options.reduce((sum, option) => sum + (Number(option.quantity) || 0), 0);

const getVariantValidationMessage = (group: VariantGroup, parentQuantity: number) => {
  const childTotal = calculateGroupChildrenTotal(group);
  if (childTotal === 0) return null;
  if (childTotal > parentQuantity) return `Child quantities exceed the parent quantity by ${childTotal - parentQuantity}.`;
  if (childTotal < parentQuantity) return `Remaining quantity: ${parentQuantity - childTotal}`;
  return "Balanced";
};

const updateVariantGroupById = (groups: VariantGroup[], targetGroupId: string, updater: (group: VariantGroup) => VariantGroup): VariantGroup[] =>
  groups.map(group => {
    if (group.id === targetGroupId) return updater(group);
    return {
      ...group,
      options: group.options.map(option => ({
        ...option,
        childGroups: updateVariantGroupById(option.childGroups, targetGroupId, updater),
      })),
    };
  });

export default function ProductsPage() {
  const { products, categories, suppliers, stocks, loading, refetch } = useResources({
    products: resources.products,
    categories: resources.categories,
    suppliers: resources.suppliers,
    stocks: resources.stocks,
  });
  const [search, setSearch] = useState("");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) setSearch(q);
  }, []);
  const [activeTab, setActiveTab] = useState("all");
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyProduct);
  const [variantGroups, setVariantGroups] = useState<VariantGroup[]>([]);
  const [showOptional, setShowOptional] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const modalRoot = typeof document !== "undefined" ? document.body : null;
  const categoryOptions = categories;

  const getTotalStock = (productId: string) =>
    stocks.filter(s => s.productId === productId).reduce((a, s) => a + s.quantity, 0);

  const filtered = products.filter(p => {
    const matchSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.sku.toLowerCase().includes(search.toLowerCase()) ||
      p.brand?.toLowerCase().includes(search.toLowerCase());
    const matchTab =
      activeTab === "all" || p.categoryId === activeTab;
    return matchSearch && matchTab;
  });

  const getVariantStockSummary = (product: any) => {
    const variants = [
      { color: "Red", stock: product?.stock?.quantity ?? 0 },
      { color: "Blue", stock: 0 },
      { color: "Green", stock: 0 },
      { color: "Black", stock: 0 },
      { color: "White", stock: 0 },
    ];

    const name = `${product?.name ?? ""} ${product?.description ?? ""}`.toLowerCase();
    const colorMatches = name.match(/(red|blue|green|black|white|pink|yellow|orange|purple|gray|grey|gold|silver|brown|beige)/g) || [];
    const uniqueColors = [...new Set(colorMatches.map(color => color.charAt(0).toUpperCase() + color.slice(1)))];

    if (uniqueColors.length > 0) {
      return uniqueColors.slice(0, 3).map(color => ({
        color,
        stock: Math.max(0, Math.floor((product?.stock?.quantity ?? 0) / Math.max(1, uniqueColors.length))),
      }));
    }

    return variants.slice(0, 2).map(v => ({ ...v }));
  };

  function openAdd() {
    setEditingId(null);
    setForm({ ...emptyProduct, categoryId: categories[0]?.id ?? "", supplierId: suppliers[0]?.id ?? "" });
    setVariantGroups([]);
    setShowOptional(false);
    setShowModal(true);
  }

  function openEdit(p: any) {
    setEditingId(p.id);
    const { description, variantGroups: parsedGroups } = parseVariantPayload(p.description ?? "");
    const totalStock = getTotalStock(p.id);
    setForm({
      name: p.name,
      sku: p.sku,
      barcode: p.barcode ?? "",
      description,
      brand: p.brand ?? "",
      categoryId: p.categoryId,
      supplierId: p.supplierId,
      costPrice: p.costPrice,
      sellingPrice: p.sellingPrice,
      stockQuantity: totalStock,
      minStockLevel: p.minStockLevel,
      status: p.status,
    });
    setVariantGroups(parsedGroups);
    setShowOptional(Boolean(p.brand || p.barcode || p.description));
    setShowModal(true);
  }

  async function handleSave() {
    const missing: string[] = [];
    if (!form.name.trim()) missing.push("Product Name");
    if (!form.categoryId) missing.push("Category");
    if (!(form.costPrice > 0)) missing.push("Cost Price");
    if (!(form.sellingPrice > 0)) missing.push("Selling Price");
    if (!(form.stockQuantity > 0)) missing.push("Stock");
    if (missing.length > 0) {
      toast.error(`Please fill required fields: ${missing.join(", ")}`);
      return;
    }

    const supplierId = form.supplierId || suppliers[0]?.id || "";

    try {
      setSaving(true);
      const description = serializeVariantPayload(form.description, variantGroups);
      const result = await saveProduct({
        ...form,
        description,
        supplierId,
        sku: form.sku.trim() || generateSku(form.name, categories.find(c => c.id === form.categoryId)?.name),
        initialStock: form.stockQuantity,
        stockQuantity: form.stockQuantity,
      }, editingId);

      if (!result.success) {
        toast.error(result.message);
        return;
      }

      toast.success(result.message);
      setShowModal(false);
      await refetch();
    } catch {
      toast.error("Could not save product. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    await deleteProduct(id);
    setDeleteId(null);
    await refetch();
  }

  const margin = (p: any) => (((p.sellingPrice - p.costPrice) / p.sellingPrice) * 100).toFixed(0);

  useEffect(() => {
    if (!loading && categories.length === 0) {
      void (async () => {
        try {
          await Promise.all(fallbackCategories.map(category => saveCategory(category.name, category.description)));
          await refetch();
        } catch (error) {
          console.error("Failed to seed default categories", error);
        }
      })();
    }
  }, [categories.length, loading, refetch]);

  useEffect(() => {
    if (editingId) return;
    if (!form.name.trim()) return;

    const nextSku = generateSku(form.name, categories.find(c => c.id === form.categoryId)?.name);
    setForm(current => (current.sku === nextSku ? current : { ...current, sku: nextSku }));
  }, [editingId, form.name, form.categoryId, categories]);

  const updateGroup = (groupId: string, updater: (group: VariantGroup) => VariantGroup) => {
    setVariantGroups(current => updateVariantGroupById(current, groupId, updater));
  };

  const addVariantGroup = () => setVariantGroups(current => [...current, createVariantGroup()]);
  const addVariantOption = (groupId: string) => {
    updateGroup(groupId, group => ({ ...group, options: [...group.options, createVariantOption()] }));
  };
  const addChildGroup = (groupId: string, optionId: string) => {
    updateGroup(groupId, group => ({
      ...group,
      options: group.options.map(option => option.id === optionId ? { ...option, childGroups: [...option.childGroups, createVariantGroup()] } : option),
    }));
  };
  const removeVariantGroup = (groupId: string) => setVariantGroups(current => current.filter(group => group.id !== groupId));
  const removeVariantOption = (groupId: string, optionId: string) => {
    updateGroup(groupId, group => ({ ...group, options: group.options.filter(option => option.id !== optionId) }));
  };

  const productModal = showModal ? (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="relative z-[1001] bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-6 border-b border-border bg-card rounded-t-2xl shrink-0">
          <h2 className="text-lg font-bold text-foreground">{editingId ? "Edit Product" : "Add New Product"}</h2>
          <button onClick={() => setShowModal(false)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer shrink-0">
            <X size={18} />
          </button>
        </div>
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* Required fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs font-semibold text-muted-foreground">Product Name <span className="text-primary">*</span></label>
              <input
                type="text"
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
                value={form.sku || "Auto-generated"}
                className="w-full px-3 py-2.5 rounded-xl border border-border/60 bg-muted/40 text-foreground text-sm cursor-not-allowed"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Category <span className="text-primary">*</span></label>
              <select
                value={form.categoryId}
                onChange={e => setForm(f => ({ ...f, categoryId: e.target.value }))}
                disabled={categories.length === 0}
                className="w-full px-3 py-2.5 rounded-xl border border-border/60 bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/30 cursor-pointer transition-all hover:border-border/80"
              >
                <option value="">{categories.length === 0 ? "Loading categories..." : "Select category..."}</option>
                {categoryOptions.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Cost Price (Rs.) <span className="text-primary">*</span></label>
              <input
                type="number"
                placeholder="0.00"
                value={form.costPrice || ""}
                onChange={e => setForm(f => ({ ...f, costPrice: parseFloat(e.target.value) || 0 }))}
                className="w-full px-3 py-2.5 rounded-xl border border-border/60 bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/30 transition-all hover:border-border/80"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Selling Price (Rs.) <span className="text-primary">*</span></label>
              <input
                type="number"
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
                placeholder="0"
                value={form.stockQuantity || ""}
                onChange={e => setForm(f => ({ ...f, stockQuantity: parseFloat(e.target.value) || 0 }))}
                className="w-full px-3 py-2.5 rounded-xl border border-border/60 bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/30 transition-all hover:border-border/80"
              />
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

          <div className="border-t border-border/50 pt-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Inventory Variants</h3>
              <button type="button" onClick={addVariantGroup} className="text-xs font-semibold text-primary hover:text-primary/80 transition-colors cursor-pointer">
                + Add Variant Group
              </button>
            </div>
            <div className="mt-3 space-y-3">
              {variantGroups.length === 0 && (
                <p className="text-xs text-muted-foreground">No variant groups yet. Add one to split inventory by color, size, material, or any custom attribute.</p>
              )}
              {variantGroups.map(group => {
                const validation = getVariantValidationMessage(group, form.minStockLevel);
                return (
                  <div key={group.id} className="rounded-2xl border border-border/60 bg-muted/20 p-3 space-y-3">
                    <div className="flex items-center gap-2">
                      <input
                        value={group.name}
                        onChange={e => updateGroup(group.id, current => ({ ...current, name: e.target.value }))}
                        placeholder="Variant type (e.g. Color, Size, Material)"
                        className="flex-1 px-3 py-2 rounded-xl border border-border/60 bg-background text-sm"
                      />
                      <button type="button" onClick={() => removeVariantGroup(group.id)} className="text-xs text-red-500 hover:text-red-600">Remove</button>
                    </div>
                    <div className="space-y-2">
                      {group.options.map(option => (
                        <div key={option.id} className="rounded-xl border border-border/40 bg-background/70 p-2.5 space-y-2">
                          <div className="flex items-center gap-2">
                            <input
                              value={option.name}
                              onChange={e => updateGroup(group.id, current => ({
                                ...current,
                                options: current.options.map(item => item.id === option.id ? { ...item, name: e.target.value } : item),
                              }))}
                              placeholder="Variant option (e.g. Black, S, Velvet)"
                              className="flex-1 px-2.5 py-2 rounded-lg border border-border/60 bg-background text-sm"
                            />
                            <input
                              type="number"
                              min="0"
                              value={option.quantity}
                              onChange={e => updateGroup(group.id, current => ({
                                ...current,
                                options: current.options.map(item => item.id === option.id ? { ...item, quantity: Number(e.target.value) || 0 } : item),
                              }))}
                              placeholder="Qty"
                              className="w-24 px-2.5 py-2 rounded-lg border border-border/60 bg-background text-sm"
                            />
                            <button type="button" onClick={() => removeVariantOption(group.id, option.id)} className="text-xs text-red-500 hover:text-red-600">Delete</button>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={() => addVariantOption(group.id)} className="text-[11px] font-semibold text-muted-foreground hover:text-foreground">+ Add Option</button>
                            <button type="button" onClick={() => addChildGroup(group.id, option.id)} className="text-[11px] font-semibold text-muted-foreground hover:text-foreground">+ Add Child Variant</button>
                          </div>
                          {option.childGroups.length > 0 && (
                            <div className="ml-2 space-y-2 border-l border-border/40 pl-3">
                              {option.childGroups.map(childGroup => {
                                const childValidation = getVariantValidationMessage(childGroup, option.quantity);
                                return (
                                  <div key={childGroup.id} className="rounded-lg border border-border/40 bg-muted/20 p-2.5 space-y-2">
                                    <div className="flex items-center gap-2">
                                      <input
                                        value={childGroup.name}
                                        onChange={e => updateGroup(group.id, current => ({
                                          ...current,
                                          options: current.options.map(item => item.id === option.id ? { ...item, childGroups: item.childGroups.map(child => child.id === childGroup.id ? { ...child, name: e.target.value } : child) } : item),
                                        }))}
                                        placeholder="Child variant type"
                                        className="flex-1 px-2.5 py-2 rounded-lg border border-border/60 bg-background text-sm"
                                      />
                                      <button type="button" onClick={() => updateGroup(group.id, current => ({
                                        ...current,
                                        options: current.options.map(item => item.id === option.id ? { ...item, childGroups: item.childGroups.filter(child => child.id !== childGroup.id) } : item),
                                      }))} className="text-xs text-red-500 hover:text-red-600">Remove</button>
                                    </div>
                                    <div className="space-y-2">
                                      {childGroup.options.map(childOption => (
                                        <div key={childOption.id} className="flex items-center gap-2">
                                          <input
                                            value={childOption.name}
                                            onChange={e => updateGroup(group.id, current => ({
                                              ...current,
                                              options: current.options.map(item => item.id === option.id ? { ...item, childGroups: item.childGroups.map(child => child.id === childGroup.id ? { ...child, options: child.options.map(childItem => childItem.id === childOption.id ? { ...childItem, name: e.target.value } : childItem) } : child) } : item),
                                            }))}
                                            placeholder="Child option"
                                            className="flex-1 px-2.5 py-2 rounded-lg border border-border/60 bg-background text-sm"
                                          />
                                          <input
                                            type="number"
                                            min="0"
                                            value={childOption.quantity}
                                            onChange={e => updateGroup(group.id, current => ({
                                              ...current,
                                              options: current.options.map(item => item.id === option.id ? { ...item, childGroups: item.childGroups.map(child => child.id === childGroup.id ? { ...child, options: child.options.map(childItem => childItem.id === childOption.id ? { ...childItem, quantity: Number(e.target.value) || 0 } : childItem) } : child) } : item),
                                            }))}
                                            placeholder="Qty"
                                            className="w-24 px-2.5 py-2 rounded-lg border border-border/60 bg-background text-sm"
                                          />
                                        </div>
                                      ))}
                                      <button type="button" onClick={() => updateGroup(group.id, current => ({
                                        ...current,
                                        options: current.options.map(item => item.id === option.id ? { ...item, childGroups: item.childGroups.map(child => child.id === childGroup.id ? { ...child, options: [...child.options, createVariantOption()] } : child) } : item),
                                      }))} className="text-[11px] font-semibold text-muted-foreground hover:text-foreground">+ Add Child Option</button>
                                    </div>
                                    {childValidation && <p className={cn("text-[11px]", childValidation.includes("exceed") ? "text-red-500" : "text-amber-600")}>{childValidation}</p>}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    {validation && <p className={cn("text-[11px]", validation.includes("exceed") ? "text-red-500" : "text-amber-600")}>{validation}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="flex gap-3 p-6 border-t border-border bg-card rounded-b-2xl shrink-0">
          <button
            onClick={() => setShowModal(false)}
            className="flex-1 py-2.5 rounded-xl border border-border/60 text-foreground text-sm font-semibold hover:bg-muted hover:border-border/80 transition-all cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 active:scale-95 transition-all cursor-pointer shadow-md shadow-primary/10 hover:shadow-lg hover:shadow-primary/20 disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100"
          >
            {saving ? "Saving…" : editingId ? "Save Changes" : "Create Product"}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  const deleteModal = deleteId ? (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="relative z-[1001] bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-950/30 flex items-center justify-center text-red-600 dark:text-red-400 shrink-0">
            <Trash2 size={20} />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-base text-foreground">Delete Product?</h3>
            <p className="text-sm text-muted-foreground mt-1">This action cannot be undone. The product will be permanently removed from your catalog.</p>
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <button
            onClick={() => setDeleteId(null)}
            className="flex-1 py-2.5 rounded-xl border border-border/60 text-foreground text-sm font-semibold hover:bg-muted hover:border-border/80 transition-all cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => handleDelete(deleteId)}
            className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 active:scale-95 transition-all cursor-pointer shadow-md shadow-red-500/20 hover:shadow-lg hover:shadow-red-500/30"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <Skeleton name="products" loading={false} fixture={<ProductsFixture />} fallback={<ProductsFixture />}>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Product Catalog</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{loading ? "Loading catalog…" : `${products.length} total SKUs across all categories`}</p>
        </div>
        <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold bg-primary text-primary-foreground rounded-xl shadow-md shadow-primary/10 hover:shadow-lg hover:bg-primary/90 hover:scale-[1.02] transition-all cursor-pointer">
          <Plus size={16} />
          Add New Product
        </button>
      </div>

      {/* Search & Category Tabs */}
      <div className="flex flex-col md:flex-row gap-3 my-4  ">
        <div className="relative flex-1 ">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, SKU, or brand..." className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground/50 transition-all" />
        </div>
        <div className="flex gap-1.5 bg-muted/50 border border-border/60 rounded-xl p-1 overflow-x-auto shrink-0">
          <button onClick={() => setActiveTab("all")} className={cn("px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all", activeTab === "all" ? "bg-card text-foreground shadow-sm border border-border/60" : "text-muted-foreground hover:text-foreground")}>All SKUs</button>
          {categoryOptions.map(c => (
            <button key={c.id} onClick={() => setActiveTab(c.id)} className={cn("px-3 py-1.5 cursor-pointer rounded-lg text-xs font-semibold whitespace-nowrap transition-all", activeTab === c.id ? "bg-card text-foreground shadow-sm border border-border/60" : "text-muted-foreground hover:text-foreground")}>
              {c.name}
            </button>
          ))}
        </div>
      </div>


      {/* Products Table */}
      <div className="bg-card border border-border/80 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-muted/30">
                <th className="text-left px-5 py-3.5 text-xs font-bold text-muted-foreground uppercase tracking-wider">Product</th>
                <th className="text-left px-4 py-3.5 text-xs font-bold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Category</th>
                <th className="text-left px-4 py-3.5 text-xs font-bold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Supplier</th>
                <th className="text-right px-4 py-3.5 text-xs font-bold text-muted-foreground uppercase tracking-wider">Price</th>
                <th className="text-right px-4 py-3.5 text-xs font-bold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Stock</th>
                <th className="text-center px-4 py-3.5 text-xs font-bold text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="px-4 py-3.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {loading && (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={7} className="px-5 py-4"><Pulse className="h-8 w-full" /></td>
                  </tr>
                ))
              )}
              {!loading && filtered.length === 0 && (
                products.length === 0 ? (
                  <EmptyState
                    colSpan={7}
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
                  <EmptyState colSpan={7} icon={Search} title="No matching products" description="Try adjusting your search or category filter." />
                )
              )}
              {!loading && filtered.map(p => {
                const cat = categories.find(c => c.id === p.categoryId);
                const sup = suppliers.find(s => s.id === p.supplierId);
                const totalStock = getTotalStock(p.id);
                const isLow = totalStock < p.minStockLevel;
                const variantSummary = getVariantStockSummary({ ...p, stock: { quantity: totalStock } });
                return (
                  <tr key={p.id} className="hover:bg-muted/20 transition-colors group">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-primary/8 border border-border/40 flex items-center justify-center shrink-0">
                          <Package size={16} className="text-primary/70" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground truncate max-w-[180px]">{p.name}</p>
                          <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{p.sku}</p>
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
                      <p className="text-[10px] text-muted-foreground">cost {formatNPR(p.costPrice)} · <span className="text-emerald-500 font-semibold">{margin(p)}% margin</span></p>
                    </td>
                    <td className="px-4 py-4 text-right hidden md:table-cell">
                      <div className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold", isLow ? "bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400" : "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400")}>
                        {isLow ? <AlertTriangle size={11} /> : <CheckCircle2 size={11} />}
                        {totalStock} units
                      </div>
                      <div className="mt-1.5 flex flex-wrap justify-end gap-1">
                        {variantSummary.map(item => (
                          <span key={`${p.id}-${item.color}`} className="text-[10px] px-2 py-0.5 rounded-full bg-muted/70 text-muted-foreground">
                            {item.color}: {item.stock}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-center">
                      <span className={cn("text-[10px] font-bold uppercase px-2.5 py-1 rounded-full", p.status === "active" ? "bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500")}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity justify-end">
                        <button onClick={() => openEdit(p)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                          <Edit2 size={13} />
                        </button>
                        <button onClick={() => setDeleteId(p.id)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 text-muted-foreground hover:text-red-500 transition-colors cursor-pointer">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {modalRoot && createPortal(productModal, modalRoot)}
      {modalRoot && createPortal(deleteModal, modalRoot)}
    </Skeleton>
  );
}

