"use client";

import { toast } from "sonner";
import type { ActionResult } from "@/lib/types";

// Failures stay up longer: they usually need reading and acting on.
const ERROR_TOAST_MS = 7000;

type Messages<T> = {
  /** Shown while the action runs and replaced in place by the outcome. */
  loading?: string;
  success?: string | ((data: T) => string);
};

/**
 * Runs a Server Function and reports the outcome with one toast. Covers both
 * failure paths: an `{ ok: false }` result from the server, and the call itself
 * failing (offline, deploy in progress). Always resolves, so callers only need
 * to check `result.ok`.
 */
export async function mutate<T>(
  action: () => Promise<ActionResult<T>>,
  messages: Messages<T> = {}
): Promise<ActionResult<T>> {
  const id = messages.loading ? toast.loading(messages.loading) : undefined;

  try {
    const result = await action();
    if (!result.ok) {
      toast.error(result.message, { id, duration: ERROR_TOAST_MS });
      return result;
    }

    const { success } = messages;
    if (success) toast.success(typeof success === "function" ? success(result.data) : success, { id });
    else if (id !== undefined) toast.dismiss(id);
    return result;
  } catch (err) {
    console.error("Server request failed", err);
    const message = typeof navigator !== "undefined" && !navigator.onLine
      ? "You're offline. Reconnect and try again."
      : "Something went wrong. Please try again.";
    toast.error(message, { id, duration: ERROR_TOAST_MS });
    return { ok: false, message };
  }
}
