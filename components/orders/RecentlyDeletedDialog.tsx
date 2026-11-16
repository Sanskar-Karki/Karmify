"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ArchiveRestore, Globe, RotateCcw, Trash2 } from "lucide-react";
import { listDeletedSales, purgeDeletedSale, restoreDeletedSale } from "@/app/actions";
import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/shared/Button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { mutate } from "@/lib/mutate";
import { cn, formatNPR } from "@/lib/utils";
import type { ActionResult } from "@/lib/types";

type DeletedList = Awaited<ReturnType<typeof listDeletedSales>> extends ActionResult<infer T> ? T : never;
type Deleted = DeletedList extends (infer R)[] ? R : never;

const ago = (d: Date | string) => {
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  return days === 1 ? "yesterday" : `${days} days ago`;
};
const daysLeft = (d: Date | string) => Math.max(0, 30 - Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000));

/** Orders deleted in the last 30 days, each one restorable or removable for good. */
export function RecentlyDeletedDialog({ open, onClose, onRestored }: { open: boolean; onClose: () => void; onRestored: () => Promise<unknown> | void }) {
  const [rows, setRows] = useState<Deleted[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<Deleted | null>(null);
  const [takeStock, setTakeStock] = useState(true);
  const [purging, setPurging] = useState<Deleted | null>(null);

  const load = useCallback(async () => {
    const result = await listDeletedSales();
    setRows(result.ok ? result.data : []);
  }, []);
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [open, load]);

  async function restore(row: Deleted, withStock: boolean) {
    setBusy(row.id);
    const result = await mutate(() => restoreDeletedSale(row.id, { takeStock: withStock }), {
      success: r => `${r.invoiceNumber} restored${r.renumbered ? " (its number was taken, so it got a new one)" : ""}${r.unitsTaken ? ` · ${r.unitsTaken} unit${r.unitsTaken === 1 ? "" : "s"} taken out of stock again` : ""}.`,
    });
    setBusy(null);
    if (result.ok) {
      setRestoring(null);
      await Promise.all([load(), onRestored()]);
    }
  }

  async function purge(row: Deleted) {
    setBusy(row.id);
    const result = await mutate(() => purgeDeletedSale(row.id), { success: r => `${r.invoiceNumber} deleted for good.` });
    setBusy(null);
    if (result.ok) {
      setPurging(null);
      await load();
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="lg"
        icon={ArchiveRestore}
        title="Recently deleted"
        description="Deleted orders are kept for 30 days. Restore one to put it back exactly as it was."
      >
        {rows === null ? (
          <div className="space-y-2 p-5" aria-busy="true">
            {[0, 1, 2].map(i => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center text-muted-foreground">
            <ArchiveRestore size={28} className="opacity-40" />
            <p className="text-sm font-semibold">Nothing deleted recently</p>
            <p className="text-xs">Orders you delete show up here for 30 days.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map(row => (
              <li key={row.id} className="flex flex-wrap items-start gap-3 px-5 py-4 sm:flex-nowrap">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-foreground">
                    <span className="font-mono">{row.invoiceNumber}</span>
                    <span className="font-semibold">· {row.customerName || "Walk-in Customer"}</span>
                    {row.website && <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted-foreground"><Globe size={10} /> Website</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatNPR(row.totalAmount)} · {row.itemCount} item{row.itemCount === 1 ? "" : "s"}
                    {row.orderedAt && ` · ordered ${new Date(row.orderedAt).toLocaleDateString()}`}
                  </p>
                  <p className="truncate text-xs text-muted-foreground" title={row.items.map(i => `${i.quantity}× ${i.name}${i.variant ? ` (${i.variant})` : ""}`).join(", ")}>
                    {row.items.map(i => `${i.quantity}× ${i.name}${i.variant ? ` (${i.variant})` : ""}`).join(", ")}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Deleted {ago(row.deletedAt)} · {row.restocked ? "its items were put back in stock" : "stock wasn't changed"} ·{" "}
                    <span className={cn(daysLeft(row.deletedAt) <= 3 && "font-semibold text-amber-600 dark:text-amber-400")}>gone for good in {daysLeft(row.deletedAt)} day{daysLeft(row.deletedAt) === 1 ? "" : "s"}</span>
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    onClick={() => (row.restocked ? (setTakeStock(true), setRestoring(row)) : void restore(row, false))}
                    loading={busy === row.id && !purging}
                    disabled={busy !== null}
                    className="px-3 py-1.5 text-xs rounded-lg"
                  >
                    <RotateCcw size={13} /> Restore
                  </Button>
                  <Button variant="secondary" onClick={() => setPurging(row)} disabled={busy !== null} aria-label={`Delete ${row.invoiceNumber} for good`} className="px-2.5 py-1.5 text-xs rounded-lg">
                    <Trash2 size={13} />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <ConfirmDialog
        open={restoring !== null}
        onClose={() => setRestoring(null)}
        onConfirm={() => (restoring ? restore(restoring, takeStock) : undefined)}
        title={`Restore ${restoring?.invoiceNumber ?? ""}?`}
        description="When this order was deleted, its items were put back in stock."
        confirmLabel="Restore order"
      >
        <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-foreground">
          <input type="checkbox" checked={takeStock} onChange={e => setTakeStock(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-primary" />
          Take its items out of stock again (they went with this order)
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={purging !== null}
        onClose={() => setPurging(null)}
        onConfirm={() => (purging ? purge(purging) : undefined)}
        title={`Delete ${purging?.invoiceNumber ?? ""} for good?`}
        description="It can't be restored after this."
        confirmLabel="Delete for good"
      />
    </>
  );
}
