"use client";

import { useEffect, useEffectEvent } from "react";
import { NotebookPen, Phone, User, X } from "lucide-react";
import { Pulse } from "@/components/shared/Pulse";
import { normalizePhone } from "@/lib/customerIdentity";
import { noteCustomer, spacedPhone } from "@/lib/noteDetails";
import { timeAgo } from "@/lib/notifications";
import { resources } from "@/lib/resources";
import { useResources } from "@/lib/useResources";

/**
 * The note an order is being entered from (Notes → Enter as order), shown
 * above the POS customer details. The name and number written in it are
 * offered as one-tap fills; the POS ticks the note off once the order is saved.
 */
export function NoteReference({ noteId, customer, onFill, onClose }: {
  noteId: string;
  customer: { name: string; phone: string };
  onFill: (field: "name" | "phone", value: string) => void;
  onClose: () => void;
}) {
  const { notes, loading } = useResources({ notes: resources.notes });
  const note = notes.find(n => n.id === noteId);

  // Deleted meanwhile (maybe on another phone): nothing to show or tick off.
  const onMissing = useEffectEvent(onClose);
  useEffect(() => {
    if (!loading && !note) onMissing();
  }, [loading, note]);

  if (!note) {
    return loading ? (
      <div className="mb-3 space-y-2 rounded-2xl border border-amber-200/70 bg-amber-50/60 p-3 dark:border-amber-900/40 dark:bg-amber-950/20">
        <Pulse className="h-3 w-1/3" />
        <Pulse className="h-3 w-4/5" />
      </div>
    ) : null;
  }

  const found = noteCustomer(note.body);
  const name = found.name && found.name.toLowerCase() !== customer.name.trim().toLowerCase() ? found.name : null;
  const phone = found.phone && found.phone !== normalizePhone(customer.phone) ? found.phone : null;
  const chip =
    "inline-flex h-8 max-w-full items-center gap-1.5 rounded-lg border border-amber-300/80 bg-card px-2.5 text-xs font-semibold text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 dark:border-amber-800/60";

  return (
    <section
      aria-label="The note this order is from"
      className="mb-3 rounded-2xl border border-amber-200 bg-amber-50/80 p-3 shadow-sm dark:border-amber-900/50 dark:bg-amber-950/25"
    >
      <div className="flex items-center gap-2">
        <NotebookPen size={14} className="shrink-0 text-amber-700 dark:text-amber-400" />
        <p className="min-w-0 truncate text-[12px] text-amber-900 dark:text-amber-100">
          <span className="font-bold">From a note</span>
          <span className="text-amber-800 dark:text-amber-200/80"> · {note.author ?? "Someone"} · {timeAgo(note.createdAt)}</span>
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Put the note away"
          title="Put the note away (it stays open in Notes)"
          className="-my-1 -mr-1 ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-amber-800/70 hover:bg-amber-100 hover:text-amber-950 dark:text-amber-200/70 dark:hover:bg-amber-900/40 dark:hover:text-amber-50"
        >
          <X size={15} />
        </button>
      </div>

      <p className="mt-1.5 max-h-28 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground">
        {note.body}
      </p>

      {(name || phone) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium text-amber-900 dark:text-amber-100/80">Fill in:</span>
          {name && (
            <button type="button" onClick={() => onFill("name", name)} className={chip} title="Use as the customer name">
              <User size={12} className="shrink-0" /> <span className="truncate">{name}</span>
            </button>
          )}
          {phone && (
            <button type="button" onClick={() => onFill("phone", phone)} className={chip} title="Use as the phone number">
              <Phone size={12} className="shrink-0" /> {spacedPhone(phone)}
            </button>
          )}
        </div>
      )}

      <p className="mt-2 text-[11px] text-amber-800 dark:text-amber-100/70">Ticked off in Notes once this order is saved.</p>
    </section>
  );
}
