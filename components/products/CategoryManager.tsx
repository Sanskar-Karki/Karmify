"use client";

import React, { useMemo, useState } from "react";
import { Check, Edit2, Plus, Shirt, Trash2, X } from "lucide-react";
import { deleteCategory, saveCategory, setUpClothingCategories } from "@/app/actions";
import { Modal } from "@/components/shared/Modal";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/shared/Button";
import { mutate } from "@/lib/mutate";
import { CLOTHING_CATEGORIES, guessClothingCategory } from "@/lib/categories";
import { cn } from "@/lib/utils";

type Category = { id: string; name: string };
type ProductRef = { id: string; name: string; categoryId: string };

const field = "min-w-0 flex-1 px-3 py-2 rounded-lg border border-border/60 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40";

/** Add, rename and delete categories, and switch the store to the clothing set. */
export function CategoryManager({
  open, onClose, categories, products, onChanged,
}: {
  open: boolean;
  onClose: () => void;
  categories: Category[];
  products: ProductRef[];
  onChanged: () => Promise<unknown>;
}) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const [clothingOpen, setClothingOpen] = useState(false);

  const countById = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of products) counts.set(p.categoryId, (counts.get(p.categoryId) ?? 0) + 1);
    return counts;
  }, [products]);

  // What "Use clothing categories" would do, worked out the same way the server does it.
  const plan = useMemo(() => {
    const clothing = new Set<string>(CLOTHING_CATEGORIES.map(c => c.name.toLowerCase()));
    const oldIds = new Set(categories.filter(c => !clothing.has(c.name.toLowerCase())).map(c => c.id));
    const existing = new Set(categories.map(c => c.name.toLowerCase()));
    const added = CLOTHING_CATEGORIES.filter(c => !existing.has(c.name.toLowerCase())).map(c => c.name);
    const moves: { name: string; to: string }[] = [];
    const left = new Map<string, number>();
    for (const p of products) {
      if (!oldIds.has(p.categoryId)) continue;
      const to = guessClothingCategory(p.name);
      if (to) moves.push({ name: p.name, to });
      else left.set(p.categoryId, (left.get(p.categoryId) ?? 0) + 1);
    }
    const removed = categories.filter(c => oldIds.has(c.id) && !left.has(c.id)).map(c => c.name);
    const kept = categories.filter(c => left.has(c.id)).map(c => `${c.name} (${left.get(c.id)})`);
    return { added, moves, removed, kept, changes: added.length + moves.length + removed.length };
  }, [categories, products]);

  async function run<T>(action: () => Promise<import("@/lib/types").ActionResult<T>>, success: string) {
    setBusy(true);
    const result = await mutate(action, { success });
    if (result.ok) await onChanged();
    setBusy(false);
    return result.ok;
  }

  async function add() {
    const name = newName.trim();
    if (!name) return;
    if (await run(() => saveCategory(name), `Category "${name}" added.`)) setNewName("");
  }

  async function rename(id: string) {
    const name = editName.trim();
    if (!name) return;
    if (await run(() => saveCategory(name, id), `Renamed to "${name}".`)) setEditingId(null);
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title="Categories" size="md" busy={busy}>
        <div className="p-5 sm:p-6 space-y-4">
          {plan.changes > 0 && (
            <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-3">
              <Shirt size={18} className="mt-0.5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Use clothing categories</p>
                <p className="text-[12px] text-muted-foreground">
                  {CLOTHING_CATEGORIES.map(c => c.name).join(", ")}. Products are sorted into them by name.
                </p>
              </div>
              <Button onClick={() => setClothingOpen(true)} disabled={busy} className="shrink-0 px-3 py-1.5 text-xs">Set up</Button>
            </div>
          )}

          <ul className="divide-y divide-border/50 rounded-xl border border-border/60">
            {categories.map(c => {
              const count = countById.get(c.id) ?? 0;
              return (
                <li key={c.id} className="flex items-center gap-2 px-3 py-2">
                  {editingId === c.id ? (
                    <>
                      <input
                        autoFocus
                        aria-label={`New name for ${c.name}`}
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter") void rename(c.id);
                          if (e.key === "Escape") { e.stopPropagation(); setEditingId(null); }
                        }}
                        className={field}
                      />
                      <button type="button" onClick={() => rename(c.id)} disabled={busy} aria-label="Save name" className="flex h-8 w-8 items-center justify-center rounded-lg text-emerald-600 hover:bg-emerald-500/10 cursor-pointer"><Check size={14} /></button>
                      <button type="button" onClick={() => setEditingId(null)} aria-label="Cancel rename" className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted cursor-pointer"><X size={14} /></button>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{count} product{count === 1 ? "" : "s"}</span>
                      <button type="button" onClick={() => { setEditingId(c.id); setEditName(c.name); }} aria-label={`Rename ${c.name}`} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"><Edit2 size={13} /></button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(c)}
                        disabled={count > 0}
                        title={count > 0 ? "Move its products to another category first" : "Delete"}
                        aria-label={`Delete ${c.name}`}
                        className={cn("flex h-8 w-8 items-center justify-center rounded-lg", count > 0 ? "text-muted-foreground/40 cursor-not-allowed" : "text-muted-foreground hover:bg-red-500/10 hover:text-red-500 cursor-pointer")}
                      >
                        <Trash2 size={13} />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="flex gap-2">
            <input
              aria-label="New category name"
              placeholder="New category, e.g. Shorts"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") void add(); }}
              className={field}
            />
            <Button onClick={add} disabled={!newName.trim() || busy} className="shrink-0 px-3 py-2 text-xs"><Plus size={13} /> Add</Button>
          </div>
          <p className="text-[11px] text-muted-foreground">A category with products can&apos;t be deleted. Edit those products and pick another category first.</p>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (deleteTarget) await run(() => deleteCategory(deleteTarget.id), `Category "${deleteTarget.name}" deleted.`);
          setDeleteTarget(null);
        }}
        title={`Delete ${deleteTarget?.name ?? "category"}?`}
        description="It has no products, so nothing else changes."
        confirmLabel="Delete"
      />

      <ConfirmDialog
        open={clothingOpen}
        onClose={() => setClothingOpen(false)}
        size="md"
        onConfirm={async () => {
          await run(() => setUpClothingCategories(), "Clothing categories set up.");
          setClothingOpen(false);
        }}
        title="Switch to clothing categories?"
        description="This changes how products are grouped. Prices, stock and orders are not touched."
        confirmLabel="Switch"
      >
        <div className="mt-3 max-h-60 space-y-2 overflow-y-auto text-[12px]">
          {plan.added.length > 0 && <p><span className="font-semibold">Add:</span> {plan.added.join(", ")}</p>}
          {plan.moves.length > 0 && (
            <div>
              <p className="font-semibold">Move:</p>
              <ul className="ml-4 list-disc text-muted-foreground">
                {plan.moves.map(m => <li key={m.name}>{m.name} → {m.to}</li>)}
              </ul>
            </div>
          )}
          {plan.removed.length > 0 && <p><span className="font-semibold">Remove (left empty):</span> {plan.removed.join(", ")}</p>}
          {plan.kept.length > 0 && (
            <p className="text-muted-foreground"><span className="font-semibold text-foreground">Left as they are</span> (no clothing word in the name): {plan.kept.join(", ")}</p>
          )}
        </div>
      </ConfirmDialog>
    </>
  );
}
