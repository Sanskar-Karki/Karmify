import "server-only";

import { Prisma } from "@prisma/client";
import type { ActionResult } from "@/lib/types";

/**
 * An error whose message is safe and useful to show the person using the app.
 * Next.js strips the message from anything thrown across a Server Function in
 * production, so failures have to come back as data to reach a toast.
 */
export class UserError extends Error {}

function isPrismaError(err: unknown, code: string) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === code;
}

export const isUniqueConflict = (err: unknown) => isPrismaError(err, "P2002");

/** Includes Postgres 18's restrict_violation (23001), which Prisma 6 doesn't map to P2003. */
export const isForeignKeyConflict = (err: unknown) =>
  isPrismaError(err, "P2003") ||
  (err instanceof Prisma.PrismaClientUnknownRequestError && err.message.includes('code: "23001"'));

/**
 * Runs a mutation and turns any failure into `{ ok: false, message }`.
 * Unexpected errors are logged server-side and replaced with `fallback`, so
 * internals such as SQL or stack traces never reach the browser.
 */
export async function guarded<T>(fallback: string, fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof UserError) return { ok: false, message: err.message };
    if (isPrismaError(err, "P2025")) {
      return { ok: false, message: "That record no longer exists. Refresh the page and try again." };
    }
    console.error(`[action] ${fallback}`, err);
    return { ok: false, message: fallback };
  }
}

/** Retries `fn` when two requests race for the same generated unique number. */
export async function retryOnUniqueConflict<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isUniqueConflict(err) || attempt >= attempts) throw err;
    }
  }
}
