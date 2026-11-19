"use server";

import { db } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { guarded, UserError } from "@/lib/actions/result";

// The Notes page: quick jottings while taking orders in a rush (names, phone
// numbers, sizes), or longer plans. Shared by everyone in the store. A note is
// one block of text whose first line reads as its title.

/** Long enough for a detailed plan, short enough that a paste can't bloat the table. */
const MAX_LENGTH = 20_000;

function cleanBody(body: unknown) {
  // Keep the writer's own line breaks and spacing; only drop blank space at either end.
  const text = typeof body === "string" ? body.replace(/\r\n?/g, "\n").trim() : "";
  if (!text) throw new UserError("Write something first.");
  if (text.length > MAX_LENGTH) throw new UserError(`That's too long for one note (${MAX_LENGTH.toLocaleString()} characters at most). Split it into two.`);
  return text;
}

export async function createNote(input: { body: string }) {
  return guarded("Could not save this note.", async () => {
    const body = cleanBody(input?.body);
    const tenant = await requireTenant();
    return db.note.create({
      data: { storeId: tenant.storeId, body, createdBy: tenant.userId },
      select: { id: true },
    });
  });
}

/** Changes a note's text, pin or done state. Only what's passed is changed. */
export async function updateNote(id: string, changes: { body?: string; pinned?: boolean; done?: boolean }) {
  return guarded("Could not update this note.", async () => {
    const data: { body?: string; pinned?: boolean; doneAt?: Date | null } = {};
    if (changes.body !== undefined) data.body = cleanBody(changes.body);
    if (changes.pinned !== undefined) data.pinned = changes.pinned === true;
    if (changes.done !== undefined) data.doneAt = changes.done === true ? new Date() : null;
    if (Object.keys(data).length === 0) throw new UserError("Nothing to change.");

    const tenant = await requireTenant();
    const { count } = await db.note.updateMany({ where: { id: String(id), storeId: tenant.storeId }, data });
    if (count === 0) throw new UserError("This note was deleted, maybe on another phone. Refresh to see the latest.");
    return { id };
  });
}

export async function deleteNote(id: string) {
  return guarded("Could not delete this note.", async () => {
    const tenant = await requireTenant();
    // Already gone (deleted on another phone) is fine: the outcome is the same.
    await db.note.deleteMany({ where: { id: String(id), storeId: tenant.storeId } });
    return { id };
  });
}

/** Clears out every ticked-off note in the store. Open notes are never touched. */
export async function deleteDoneNotes() {
  return guarded("Could not clear the done notes.", async () => {
    const tenant = await requireTenant();
    const { count } = await db.note.deleteMany({ where: { storeId: tenant.storeId, doneAt: { not: null } } });
    return { count };
  });
}
