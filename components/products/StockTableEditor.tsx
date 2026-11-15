"use client";

import React, { useState } from "react";
import { Check, X } from "lucide-react";
import { setVariantStock } from "@/app/actions";
import { Button } from "@/components/shared/Button";
import { VariantMatrix, type VariantStockRow } from "@/components/shared/VariantStock";
import { mutate } from "@/lib/mutate";
import { cn } from "@/lib/utils";

/**
 * A sized product's size × colour stock table whose cells can be edited in
 * place ("Edit stock" → type the counts → Save). Used under catalog rows.
 */
export function StockTableEditor({
  productId, variants, onSaved, className,
}: {
  productId: string;
  variants: VariantStockRow[];
  onSaved: () => Promise<unknown> | void;
  className?: string;
}) {
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [saving, setSaving] = useState(false);
  const invalid = values !== null && Object.values(values).some(v => v.trim() !== "" && !(Number.isInteger(Number(v)) && Number(v) >= 0));

  async function save() {
    if (!values || invalid) return;
    setSaving(true);
    const result = await mutate(
      () => setVariantStock({
        productId,
        rows: variants.map(v => {
          const typed = values[v.id];
          return { variantId: v.id, quantity: typed === undefined || typed.trim() === "" ? v.quantity : Number(typed) };
        }),
      }),
      { success: r => (r.changed ? `Stock saved (${r.changed} size${r.changed === 1 ? "" : "s"} changed).` : "Nothing changed.") }
    );
    setSaving(false);
    if (result.ok) {
      setValues(null);
      await onSaved();
    }
  }

  return (
    <div className={cn("space-y-2", className)}>
      <VariantMatrix
        variants={variants}
        onEdit={() => setValues({})}
        edit={values === null ? undefined : { values, onChange: (id, value) => setValues(v => ({ ...(v ?? {}), [id]: value })) }}
        className="w-fit max-w-full"
      />
      {values !== null && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => setValues(null)} disabled={saving} className="px-3 py-1.5 text-xs"><X size={12} /> Cancel</Button>
          <Button onClick={save} loading={saving} disabled={invalid} className="px-3 py-1.5 text-xs">{!saving && <Check size={12} />} Save stock</Button>
          <span className={cn("text-[11px]", invalid ? "font-semibold text-red-600" : "text-muted-foreground")}>
            {invalid ? "Use whole numbers of 0 or more." : "Type what's on the shelf. New stock coming in: use Restock."}
          </span>
        </div>
      )}
    </div>
  );
}
