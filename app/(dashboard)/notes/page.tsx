"use client";

import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Clock, Copy, NotebookPen, Phone, Pin, Search, ShoppingCart, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { createNote, deleteDoneNotes, deleteNote, updateNote } from "@/app/actions";
import { Button } from "@/components/shared/Button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { Modal } from "@/components/shared/Modal";
import { Pulse } from "@/components/shared/Pulse";
import { mutate } from "@/lib/mutate";
import { phonesIn, spacedPhone } from "@/lib/noteDetails";
import { timeAgo } from "@/lib/notifications";
import { fetchResource } from "@/lib/resourceCache";
import { resources } from "@/lib/resources";
import { useResources } from "@/lib/useResources";
import type { Note } from "@/lib/types";
import { cn } from "@/lib/utils";

// What's typed in the quick box is kept on this phone until it's saved, so a
// failed save (no connection) or a reload never loses a jotted-down order.
const DRAFT_KEY = "karmify_note_draft";
const subscribeNothing = () => () => {};
function readDraft() {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}
function writeDraft(text: string) {
  try {
    if (text.trim()) localStorage.setItem(DRAFT_KEY, text);
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Storage blocked (private browsing): the draft just isn't kept.
  }
}

/** Notes are shared, so the page checks for ones added on other phones while it's open. */
const POLL_MS = 30_000;
/** An open jotting older than this is flagged, so a rush order isn't forgotten. */
const WAITING_MS = 24 * 60 * 60_000;
const isWaiting = (note: View) => !note.done && !note.pinned && Date.now() - new Date(note.createdAt).getTime() > WAITING_MS;

/** Ctrl+Enter (Cmd+Enter on a Mac) saves, from the quick box and the editor. */
// Text boxes here are 16px on phones: anything smaller makes an iPhone zoom in on tap.
const isSaveKey = (e: React.KeyboardEvent) => e.key === "Enter" && (e.ctrlKey || e.metaKey);

/** Grows a text box with its text, up to its max height. */
function autoGrow(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

/** The first line reads as the title; the rest is the body. */
function splitNote(body: string) {
  const lines = body.split("\n");
  const first = lines.findIndex(l => l.trim());
  return { title: (lines[first] ?? "").trim(), rest: lines.slice(first + 1).join("\n").trim() };
}

const newestFirst = (a: Note, b: Note) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

type View = Note & { done: boolean };
type Tab = "open" | "done";

export default function NotesPage() {
  const { notes, loading, refetch } = useResources({ notes: resources.notes });
  const wantsNew = useSearchParams().get("new") !== null;

  // Quick box
  const storedDraft = useSyncExternalStore(subscribeNothing, readDraft, () => "");
  const [typed, setTyped] = useState<string | null>(null);
  const text = typed ?? storedDraft;
  const [saving, setSaving] = useState(false);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  // "New note" (the app icon's shortcut) opens straight into the box.
  useEffect(() => {
    if (wantsNew) boxRef.current?.focus();
  }, [wantsNew]);
  // A draft kept from last time: size the box to it.
  useEffect(() => autoGrow(boxRef.current), [storedDraft]);

  // Pick up notes written on other phones while this page stays open.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void fetchResource(resources.notes.key, resources.notes.fetcher, { force: true }).catch(() => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, []);

  const [tab, setTab] = useState<Tab>("open");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<View | null>(null);
  const [deleting, setDeleting] = useState<View | null>(null);
  const [clearing, setClearing] = useState(false);
  // Ticks and pins show at once; the server's answer replaces them after the reload.
  const [overrides, setOverrides] = useState<Record<string, { pinned?: boolean; done?: boolean }>>({});

  const views = useMemo<View[]>(
    () => notes.map(n => ({ ...n, pinned: overrides[n.id]?.pinned ?? n.pinned, done: overrides[n.id]?.done ?? Boolean(n.doneAt) })),
    [notes, overrides]
  );
  const openCount = views.filter(n => !n.done).length;
  const doneCount = views.length - openCount;

  const shown = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    // Who wrote it counts too: "priya" finds Priya's notes.
    const matches = (n: View) => words.every(w => n.body.toLowerCase().includes(w) || (n.author ?? "").toLowerCase().includes(w));
    const list = views.filter(n => (tab === "done" ? n.done : !n.done) && matches(n));
    if (tab === "open") return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || newestFirst(a, b));
    return [...list].sort((a, b) => new Date(b.doneAt ?? b.updatedAt).getTime() - new Date(a.doneAt ?? a.updatedAt).getTime());
  }, [views, tab, query]);

  // Open notes: the pinned ones in a group of their own at the top.
  const pinned = tab === "open" ? shown.filter(n => n.pinned) : [];
  const others = tab === "open" ? shown.filter(n => !n.pinned) : shown;
  const grouped = pinned.length > 0 && others.length > 0;

  function type(value: string) {
    setTyped(value);
    writeDraft(value);
  }

  async function add() {
    const body = text.trim();
    if (!body || saving) return;
    setSaving(true);
    const result = await mutate(() => createNote({ body }), { success: "Note saved." });
    setSaving(false);
    if (!result.ok) return; // the text stays, and is kept on this phone
    type("");
    requestAnimationFrame(() => autoGrow(boxRef.current));
    setTab("open");
    setQuery("");
    await refetch({ quiet: true });
  }

  function override(id: string, change: { pinned?: boolean; done?: boolean } | null) {
    setOverrides(current => {
      const next = { ...current };
      if (change) next[id] = { ...next[id], ...change };
      else delete next[id];
      return next;
    });
  }

  async function setDone(note: View, done: boolean) {
    override(note.id, { done });
    const result = await mutate(() => updateNote(note.id, { done }));
    if (result.ok) {
      await refetch({ quiet: true });
      toast.success(done ? "Ticked off. It's under Done now." : "Back with the open notes.", {
        id: `note-done-${note.id}`,
        action: done ? { label: "Undo", onClick: () => void setDone(note, false) } : undefined,
      });
    }
    override(note.id, null);
  }

  async function setPinned(note: View, pinned: boolean) {
    override(note.id, { pinned });
    const result = await mutate(() => updateNote(note.id, { pinned }));
    if (result.ok) await refetch({ quiet: true });
    override(note.id, null);
  }

  async function remove(note: View) {
    const result = await mutate(() => deleteNote(note.id), { success: "Note deleted." });
    if (!result.ok) return;
    setDeleting(null);
    setEditing(null);
    await refetch({ quiet: true });
  }

  async function clearDone() {
    const result = await mutate(() => deleteDoneNotes(), {
      success: r => (r.count === 1 ? "1 done note deleted." : `${r.count} done notes deleted.`),
    });
    if (!result.ok) return;
    setClearing(false);
    await refetch({ quiet: true });
  }

  const cards = (list: View[]) => (
    <ul className="grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
      {list.map(note => (
        <li key={note.id}>
          <NoteCard note={note} onOpen={() => setEditing(note)} onDone={done => setDone(note, done)} onPin={pinned => setPinned(note, pinned)} />
        </li>
      ))}
    </ul>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Notes</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">Jot things down .</p>
      </div>

      {/* Quick box */}
      <section aria-label="New note" className="rounded-2xl border border-border/80 bg-card p-3 shadow-sm focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/15">
        <textarea
          ref={boxRef}
          value={text}
          onChange={e => {
            type(e.target.value);
            autoGrow(e.target);
          }}
          onKeyDown={e => {
            if (isSaveKey(e)) {
              e.preventDefault();
              void add();
            }
          }}
          rows={3}
          aria-label="New note"
          placeholder={"Jot it down: a name, phone number, sizes…\nOr write out a longer plan."}
          className="block max-h-[50vh] min-h-[4.5rem] w-full resize-none overflow-y-auto bg-transparent px-1 py-1 text-base leading-relaxed text-foreground placeholder:text-muted-foreground/70 focus:outline-none sm:text-sm"
        />
        <div className="mt-2 flex items-center justify-end gap-3">
          {/* The shortcut is for keyboards: shown on computers only. */}
          <span className="mr-auto hidden text-[11px] text-muted-foreground lg:inline">
            <kbd className="rounded bg-muted px-1.5 py-0.5 font-sans font-semibold">Ctrl</kbd> + <kbd className="rounded bg-muted px-1.5 py-0.5 font-sans font-semibold">Enter</kbd> to save
          </span>
          {text.trim() && !saving && (
            <button type="button" onClick={() => type("")} className="h-9 rounded-lg px-3 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground">
              Clear
            </button>
          )}
          <Button onClick={add} loading={saving} disabled={!text.trim()} className="h-9 px-4 text-xs">
            Save note
          </Button>
        </div>
      </section>

      {/* Search and Open / Done */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1 min-w-0">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search notes or who wrote them"
            aria-label="Search notes"
            className="w-full rounded-xl border border-border bg-card py-2.5 pl-8 pr-9 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
              <X size={14} />
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1 sm:w-64" role="tablist" aria-label="Which notes">
          {([
            { value: "open", label: "Open", count: openCount },
            { value: "done", label: "Done", count: doneCount },
          ] as const).map(option => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={tab === option.value}
              onClick={() => setTab(option.value)}
              className={cn(
                "flex h-9 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition-colors",
                tab === option.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {option.label}
              <span className={cn("tabular-nums", tab === option.value ? "text-primary" : "text-muted-foreground")}>{option.count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Done: clear them out once they've piled up */}
      {tab === "done" && doneCount > 0 && !loading && (
        <div className="flex items-center justify-between gap-3 px-1">
          <p className="text-[12px] text-muted-foreground">Ticked off, newest first. Tick again to bring one back.</p>
          <button
            type="button"
            onClick={() => setClearing(true)}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
          >
            <Trash2 size={14} /> Clear done
          </button>
        </div>
      )}

      {/* The list */}
      {loading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="space-y-2 rounded-2xl border border-border/60 bg-card p-4">
              <Pulse className="h-4 w-2/3" />
              <Pulse className="h-3 w-full" />
              <Pulse className="h-3 w-4/5" />
            </div>
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50">
          {query.trim() ? (
            <EmptyState icon={Search} title={`No ${tab === "done" ? "done " : ""}notes match "${query.trim()}".`} />
          ) : tab === "done" ? (
            <EmptyState icon={Check} title="Nothing ticked off yet." description="Tick a note once it's dealt with, like an order that's been entered. It moves here." />
          ) : (
            <EmptyState icon={NotebookPen} title={doneCount ? "No open notes." : "No notes yet."} description="Whatever you write in the box above is saved here for everyone in the shop." />
          )}
        </div>
      ) : grouped ? (
        <div className="space-y-5">
          <section aria-labelledby="notes-pinned" className="space-y-2">
            <h2 id="notes-pinned" className="flex items-center gap-1.5 px-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              <Pin size={12} className="fill-current" /> Pinned
            </h2>
            {cards(pinned)}
          </section>
          <section aria-labelledby="notes-others" className="space-y-2">
            <h2 id="notes-others" className="px-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Other notes</h2>
            {cards(others)}
          </section>
        </div>
      ) : (
        cards(shown)
      )}

      {editing && (
        <NoteEditor
          key={editing.id}
          note={editing}
          onClose={() => setEditing(null)}
          onSaved={() => refetch({ quiet: true })}
          onDelete={() => setDeleting(editing)}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => (deleting ? remove(deleting) : undefined)}
        title="Delete this note?"
        description={deleting ? <>&ldquo;{splitNote(deleting.body).title}&rdquo; is deleted for everyone in the shop. This can&apos;t be undone.</> : null}
        confirmLabel="Delete note"
      />

      <ConfirmDialog
        open={clearing}
        onClose={() => setClearing(false)}
        onConfirm={clearDone}
        title="Clear the done notes?"
        description={<>Every ticked-off note is deleted for everyone in the shop. Open notes stay. This can&apos;t be undone.</>}
        confirmLabel="Clear done notes"
      />
    </div>
  );
}

function NoteCard({ note, onOpen, onDone, onPin }: {
  note: View;
  onOpen: () => void;
  onDone: (done: boolean) => void;
  onPin: (pinned: boolean) => void;
}) {
  const { title, rest } = splitNote(note.body);
  const waiting = isWaiting(note);

  return (
    <article
      className={cn(
        "flex gap-2.5 rounded-2xl border bg-card p-3 pr-1.5 shadow-sm transition-colors hover:border-primary/40",
        note.pinned && !note.done ? "border-primary/30" : "border-border/80",
        note.done && "bg-card/60"
      )}
    >
      {/* Tick off: a finger-sized target around a small box */}
      <button
        type="button"
        role="checkbox"
        aria-checked={note.done}
        aria-label={note.done ? `Mark "${title}" as not done` : `Mark "${title}" as done`}
        onClick={() => onDone(!note.done)}
        className="-m-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg hover:bg-muted"
      >
        <span
          className={cn(
            "flex h-5 w-5 items-center justify-center rounded-md border-2 transition-colors",
            note.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-muted-foreground/40"
          )}
        >
          {note.done && <Check size={13} strokeWidth={3} />}
        </span>
      </button>

      <button type="button" onClick={onOpen} className="min-w-0 flex-1 py-1 text-left" aria-label={`Open note: ${title}`}>
        <p className={cn("line-clamp-2 break-words text-sm font-semibold text-foreground", note.done && "text-muted-foreground line-through decoration-muted-foreground/50")}>
          {title}
        </p>
        {rest && (
          <p className={cn("mt-1 line-clamp-6 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-muted-foreground")}>
            {rest}
          </p>
        )}
        <p className="mt-2 flex flex-wrap items-center gap-x-1 text-[11px] text-muted-foreground">
          <span>{note.author ?? "Someone"}</span>
          <span aria-hidden>·</span>
          {/* Open for over a day: easy to spot, so a jotted-down order isn't forgotten. */}
          <span
            className={cn(waiting && "inline-flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-400")}
            title={waiting ? "Still open after more than a day" : undefined}
          >
            {waiting && <Clock size={11} />}
            {timeAgo(note.createdAt)}
          </span>
          {note.done && note.doneAt && (
            <>
              <span aria-hidden>·</span>
              <span>done {timeAgo(note.doneAt).toLowerCase()}</span>
            </>
          )}
        </p>
      </button>

      {!note.done && (
        <button
          type="button"
          onClick={() => onPin(!note.pinned)}
          aria-pressed={note.pinned}
          aria-label={note.pinned ? `Unpin "${title}"` : `Pin "${title}" to the top`}
          title={note.pinned ? "Unpin" : "Pin to the top"}
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-muted",
            note.pinned ? "text-primary" : "text-muted-foreground/60 hover:text-foreground"
          )}
        >
          <Pin size={15} className={cn(note.pinned && "fill-current")} />
        </button>
      )}
    </article>
  );
}

function NoteEditor({ note, onClose, onSaved, onDelete }: {
  note: View;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
  onDelete: () => void;
}) {
  const router = useRouter();
  const [text, setText] = useState(note.body);
  const [saving, setSaving] = useState(false);
  const dirty = text.trim() !== note.body.trim();
  const phones = useMemo(() => phonesIn(text).slice(0, 2), [text]);

  /** Saves the text if it changed. True when there's nothing left unsaved. */
  async function saveText() {
    if (!dirty) return true;
    if (!text.trim()) {
      toast.error("A note can't be empty. Delete it instead.");
      return false;
    }
    setSaving(true);
    const result = await mutate(() => updateNote(note.id, { body: text }), { success: "Note saved." });
    setSaving(false);
    if (!result.ok) return false;
    await onSaved();
    return true;
  }

  async function save() {
    if (await saveText()) onClose();
  }

  // The POS opens with this note beside the order, and ticks it off once the order is saved.
  async function enterOrder() {
    if (!(await saveText())) return;
    router.push(`/sales?note=${encodeURIComponent(note.id)}`);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text.trim());
      toast.success("Copied.", { id: "note-copied" });
    } catch {
      toast.error("Couldn't copy here. Select the text and copy it instead.");
    }
  }

  const written = new Date(note.createdAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const chip = "inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50";

  return (
    <Modal
      open
      onClose={onClose}
      title="Note"
      description={`${note.author ?? "Someone"} · ${written}${note.done ? " · done" : ""}`}
      icon={NotebookPen}
      size="lg"
      busy={saving}
      dirty={dirty}
      footer={
        <>
          <Button variant="secondary" onClick={onDelete} disabled={saving} aria-label="Delete note" title="Delete note" className="shrink-0 px-3 text-red-600 dark:text-red-400">
            <Trash2 size={15} />
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={saving} className="flex-1">Cancel</Button>
          <Button onClick={save} loading={saving} disabled={!dirty} className="flex-1">{saving ? "Saving…" : "Save"}</Button>
        </>
      }
    >
      <div className="space-y-3 p-4 sm:p-5">
        {/* What to do with it: enter it as an order, copy it, or ring the number in it */}
        <div className="flex flex-wrap items-center gap-2">
          {!note.done && (
            <button type="button" onClick={enterOrder} disabled={saving} className={cn(chip, "border-primary/30 bg-primary/5 text-primary hover:border-primary/50 hover:bg-primary/5 dark:text-pink-300")}>
              <ShoppingCart size={14} /> Enter as order
            </button>
          )}
          <button type="button" onClick={copy} className={chip}>
            <Copy size={14} /> Copy
          </button>
          {/* Calling is for phones: computers don't have a dialler to open. */}
          {phones.map(phone => (
            <a key={phone} href={`tel:${phone}`} className={cn(chip, "hidden pointer-coarse:inline-flex")}>
              <Phone size={14} /> {spacedPhone(phone)}
            </a>
          ))}
        </div>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (isSaveKey(e)) {
              e.preventDefault();
              void save();
            }
          }}
          aria-label="Note text"
          className="block min-h-[40vh] w-full resize-y rounded-xl border border-border/60 bg-background px-3 py-2.5 text-base leading-relaxed text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 sm:text-sm"
        />
        {!note.done && (
          <p className="text-[11px] text-muted-foreground">
            Enter as order opens the POS with this note beside it, and ticks the note off once the order is saved.
          </p>
        )}
      </div>
    </Modal>
  );
}
