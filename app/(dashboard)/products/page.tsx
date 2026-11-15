"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Search, Plus, Edit2, Trash2, Package, AlertTriangle, CheckCircle2,
  ChevronDown, ChevronsUpDown, ChevronsDownUp, Tags, PackagePlus,
} from "lucide-react";
import { CategoryManager } from "@/components/products/CategoryManager";
import { RestockDialog } from "@/components/products/RestockDialog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ProductEditor, type EditorTarget } from "@/components/products/ProductEditor";
import { toast } from "sonner";
import {
  deleteProduct, deleteProducts, ensureDefaultCategories,
} from "@/app/actions";
import { cn, formatNPR } from "@/lib/utils";
import { Pulse } from "@/components/shared/Pulse";
import { PlaceholderRows, PRODUCT_COLUMNS } from "@/components/skeletons/placeholders";
import { EmptyState } from "@/components/shared/EmptyState";
import { useResources } from "@/lib/useResources";
import { resources } from "@/lib/resources";
import { ShowMoreButton, useShowMore } from "@/components/shared/ShowMore";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/shared/Button";
import { mutate } from "@/lib/mutate";
import { useUrlState } from "@/lib/useUrlState";
import type { Product } from "@/lib/types";
import { SHOP_BRAND, useShop } from "@/lib/shop";
import { summarizeVariants, variantCountLabel } from "@/components/shared/VariantStock";
import { StockTableEditor } from "@/components/products/StockTableEditor";

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
  const [editorTarget, setEditorTarget] = useState<EditorTarget | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [restockTarget, setRestockTarget] = useState<Product | null>(null);
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

  // New products go to the shop being viewed.
  const openAdd = () => setEditorTarget({ mode: "add", brand: shop === "all" ? "" : SHOP_BRAND[shop] });
  const openEdit = (p: Product) => setEditorTarget({ mode: "edit", product: p });

  // A click anywhere on a row opens the product's page, except on its own controls.
  const router = useRouter();
  function openProduct(e: React.MouseEvent, id: string) {
    if ((e.target as HTMLElement).closest("button, a, input, label, select, textarea, [data-no-open]")) return;
    if (window.getSelection()?.toString()) return; // selecting text, not opening
    if (e.metaKey || e.ctrlKey) window.open(`/products/${id}`, "_blank");
    else router.push(`/products/${id}`);
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
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" onClick={() => setCategoriesOpen(true)} disabled={loading}>
            <Tags size={16} />
            Categories
          </Button>
          <Button onClick={openAdd}>
            <Plus size={16} />
            Add New Product
          </Button>
        </div>
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
                  <tr
                    onClick={e => openProduct(e, p.id)}
                    className={cn("data-row group cursor-pointer", open && "bg-muted/20 border-b-0", selected.has(p.id) && "bg-primary/5")}
                  >
                    <td data-no-open className="w-10 pl-5 pr-0 py-4">
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
                          <Link href={`/products/${p.id}`} className="block font-semibold text-foreground truncate max-w-[180px] hover:text-primary hover:underline">{p.name}</Link>
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
                        <button type="button" onClick={() => setRestockTarget(p)} title="Restock" aria-label={`Restock ${p.name}`} className="w-8 h-8 md:w-7 md:h-7 flex items-center justify-center rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-950/30 text-muted-foreground hover:text-emerald-600 transition-colors cursor-pointer">
                          <PackagePlus size={13} />
                        </button>
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
                        <StockTableEditor productId={p.id} variants={p.variants} onSaved={() => refetch({ quiet: true })} className="md:ml-10" />
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

      <ProductEditor
        target={editorTarget}
        categories={categories}
        suppliers={suppliers}
        currentStock={getTotalStock}
        onClose={() => setEditorTarget(null)}
        onSaved={() => refetch()}
        onSuppliersChanged={() => refetch({ quiet: true })}
      />
      <CategoryManager
        open={categoriesOpen}
        onClose={() => setCategoriesOpen(false)}
        categories={categories}
        products={products}
        onChanged={() => refetch({ quiet: true })}
      />
      <RestockDialog
        product={restockTarget}
        currentStock={restockTarget ? getTotalStock(restockTarget.id) : 0}
        onClose={() => setRestockTarget(null)}
        onDone={() => refetch({ quiet: true })}
      />
      {deleteModal}
      {bulkDeleteModal}
</>
  );
}

