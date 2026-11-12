"use client";

import { loadResources } from "@/lib/actions/resources";
import type { ResourceData, ResourceKey } from "@/lib/types";

/** A failure described by the server in words that are safe to show. */
export class ResourceLoadError extends Error {}

type Waiter = {
  key: ResourceKey;
  resolve: (value: never) => void;
  reject: (reason: unknown) => void;
};

let waiting: Waiter[] = [];

async function flush() {
  const batch = waiting;
  waiting = [];

  try {
    const results = await loadResources(batch.map(w => w.key));
    for (const waiter of batch) {
      const result = results[waiter.key];
      if (result?.ok) waiter.resolve(result.data as never);
      else waiter.reject(new ResourceLoadError(result?.message ?? `Could not load ${waiter.key}.`));
    }
  } catch (err) {
    for (const waiter of batch) waiter.reject(err);
  }
}

/** Requests made in the same tick travel together in one Server Function call. */
export function batchLoad<K extends ResourceKey>(key: K): Promise<ResourceData[K]> {
  return new Promise<ResourceData[K]>((resolve, reject) => {
    if (waiting.length === 0) setTimeout(flush, 0);
    waiting.push({ key, resolve: resolve as Waiter["resolve"], reject });
  });
}
