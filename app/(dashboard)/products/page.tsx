"use client";

import { Skeleton } from "boneyard-js/react";
import { ProductsFixture } from "@/components/skeletons/fixtures";
import React, { useState, useEffect } from "react";
import {
  Search, Plus, Edit2, Trash2, Package, X, ChevronDown, AlertTriangle, CheckCircle2
} from "lucide-react";
import {
  getProducts, saveProduct, deleteProduct,
  getCategories, getSuppliers, getStocks,
} from "@/app/actions";
import { cn } from "@/lib/utils";

type ProductForm = {
  name: string; sku: string; barcode: string; description: string; brand: string;
  categoryId: string; supplierId: string; costPrice: number; sellingPrice: number;
  minStockLevel: number; status: string;
};

const emptyProduct: ProductForm = {
  name: "", sku: "", barcode: "", description: "", brand: "",
  categoryId: "", supplierId: "", costPrice: 0, sellingPrice: 0,
  minStockLevel: 5, status: "active"
};

export default function ProductsPage() {
  const [mounted, setMounted] = useState(false);
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [stocks, setStocks] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyProduct);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    refresh().then(() => setMounted(true));
  }, []);

  async function refresh() {
    const [products, categories, suppliers, stocks] = await Promise.all([
      getProducts(), getCategories(), getSuppliers(), getStocks(),
    ]);
    setProducts(products);
    setCategories(categories);
    setSuppliers(suppliers);
    setStocks(stocks);
  }

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

  function openAdd() {
    setEditingId(null);
    setForm(emptyProduct);
    setShowModal(true);
  }

  function openEdit(p: any) {
    setEditingId(p.id);
    setForm({ name: p.name, sku: p.sku, barcode: p.barcode ?? "", description: p.description ?? "", brand: p.brand ?? "", categoryId: p.categoryId, supplierId: p.supplierId, costPrice: p.costPrice, sellingPrice: p.sellingPrice, minStockLevel: p.minStockLevel, status: p.status });
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.name || !form.sku || !form.categoryId || !form.supplierId) return;
    await saveProduct(form, editingId);
    setShowModal(false);
    await refresh();
  }

  async function handleDelete(id: string) {
    await deleteProduct(id);
    setDeleteId(null);
    await refresh();
  }

  const margin = (p: any) => (((p.sellingPrice - p.costPrice) / p.sellingPrice) * 100).toFixed(0);

  if (!mounted) return (
    <Skeleton name="products" loading={true} fixture={<ProductsFixture />}>
      <ProductsFixture />
    </Skeleton>
  );

  return (
    <Skeleton name="products" loading={false} fixture={<ProductsFixture />}>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Product Catalog</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{products.length} total SKUs across all categories</p>
        </div>
        <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold bg-primary text-primary-foreground rounded-xl shadow-md shadow-primary/10 hover:shadow-lg hover:bg-primary/90 hover:scale-[1.02] transition-all cursor-pointer">
          <Plus size={16} />
          Add New Product
        </button>
      </div>

      {/* Search & Category Tabs */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, SKU, or brand..." className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground/50 transition-all" />
        </div>
        <div className="flex gap-1.5 bg-muted/50 border border-border/60 rounded-xl p-1 overflow-x-auto shrink-0">
          <button onClick={() => setActiveTab("all")} className={cn("px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all", activeTab === "all" ? "bg-card text-foreground shadow-sm border border-border/60" : "text-muted-foreground hover:text-foreground")}>All SKUs</button>
          {categories.map(c => (
            <button key={c.id} onClick={() => setActiveTab(c.id)} className={cn("px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all", activeTab === c.id ? "bg-card text-foreground shadow-sm border border-border/60" : "text-muted-foreground hover:text-foreground")}>
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
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-16 text-muted-foreground">
                    <Package size={32} className="mx-auto mb-3 opacity-40" />
                    <p className="font-semibold text-sm">No products found</p>
                    <p className="text-xs mt-1">Try adjusting your search or category filter.</p>
                  </td>
                </tr>
              )}
              {filtered.map(p => {
                const cat = categories.find(c => c.id === p.categoryId);
                const sup = suppliers.find(s => s.id === p.supplierId);
                const totalStock = getTotalStock(p.id);
                const isLow = totalStock < p.minStockLevel;
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
                      <p className="font-bold text-foreground">${p.sellingPrice.toFixed(2)}</p>
                      <p className="text-[10px] text-muted-foreground">cost ${p.costPrice.toFixed(2)} · <span className="text-emerald-500 font-semibold">{margin(p)}% margin</span></p>
                    </td>
                    <td className="px-4 py-4 text-right hidden md:table-cell">
                      <div className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold", isLow ? "bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400" : "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400")}>
                        {isLow ? <AlertTriangle size={11} /> : <CheckCircle2 size={11} />}
                        {totalStock} units
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

      {/* Add/Edit Product Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-border">
              <h2 className="text-lg font-bold">{editingId ? "Edit Product" : "Add New Product"}</h2>
              <button onClick={() => setShowModal(false)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-muted text-muted-foreground cursor-pointer">
                <X size={16} />
              </button>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                { label: "Product Name", key: "name", type: "text", placeholder: "e.g. ProBook Laptop 14-inch" },
                { label: "SKU", key: "sku", type: "text", placeholder: "e.g. PROBOOK-14-001" },
                { label: "Brand", key: "brand", type: "text", placeholder: "e.g. HP" },
                { label: "Barcode", key: "barcode", type: "text", placeholder: "EAN-13 barcode" },
                { label: "Cost Price ($)", key: "costPrice", type: "number", placeholder: "0.00" },
                { label: "Selling Price ($)", key: "sellingPrice", type: "number", placeholder: "0.00" },
                { label: "Min. Stock Level", key: "minStockLevel", type: "number", placeholder: "5" },
              ].map(field => (
                <div key={field.key} className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">{field.label}</label>
                  <input
                    type={field.type}
                    placeholder={field.placeholder}
                    value={(form as any)[field.key] ?? ""}
                    onChange={e => setForm(f => ({ ...f, [field.key]: field.type === "number" ? parseFloat(e.target.value) || 0 : e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                  />
                </div>
              ))}

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Category</label>
                <select value={form.categoryId} onChange={e => setForm(f => ({ ...f, categoryId: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer">
                  <option value="">Select category...</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Supplier</label>
                <select value={form.supplierId} onChange={e => setForm(f => ({ ...f, supplierId: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer">
                  <option value="">Select supplier...</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.companyName}</option>)}
                </select>
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs font-semibold text-muted-foreground">Description</label>
                <textarea value={form.description ?? ""} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} placeholder="Product description..." className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none transition-all" />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Status</label>
                <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as "active" | "inactive" }))} className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer">
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 p-6 border-t border-border">
              <button onClick={() => setShowModal(false)} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-semibold hover:bg-muted transition-colors cursor-pointer">Cancel</button>
              <button onClick={handleSave} className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors cursor-pointer shadow-md shadow-primary/10">
                {editingId ? "Save Changes" : "Create Product"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-950/30 flex items-center justify-center text-red-500">
                <Trash2 size={18} />
              </div>
              <div>
                <h3 className="font-bold text-base">Delete Product?</h3>
                <p className="text-xs text-muted-foreground">This cannot be undone.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setDeleteId(null)} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-semibold hover:bg-muted transition-colors cursor-pointer">Cancel</button>
              <button onClick={() => handleDelete(deleteId)} className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 transition-colors cursor-pointer">Delete</button>
            </div>
          </div>
        </div>
      )}
    </Skeleton>
  );
}
