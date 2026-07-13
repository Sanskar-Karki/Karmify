import "server-only";

import { cache } from "react";
import { auth, currentUser } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";

export type Tenant = {
  userId: string;
  storeId: string;
  storeName: string;
};

// Resolve the current Clerk user to their tenant (user row + store), creating
// both on first login. `cache()` dedupes this per request, so a server action
// that logs activity, adjusts stock, and notifies only hits auth + DB once.
export const getTenant = cache(async (): Promise<Tenant | null> => {
  const { userId } = await auth();
  if (!userId) return null;

  const existing = await db.user.findUnique({
    where: { id: userId },
    include: { store: { select: { id: true, name: true } } },
  });

  if (existing?.store) {
    return { userId, storeId: existing.store.id, storeName: existing.store.name };
  }

  // First login (or a legacy user without a store): provision their store.
  const clerkUser = existing ? null : await currentUser();
  const email = existing?.email
    ?? clerkUser?.emailAddresses[0]?.emailAddress
    ?? `clerk_${userId}@karmify.com`;
  const name = existing?.name
    ?? (`${clerkUser?.firstName || ""} ${clerkUser?.lastName || ""}`.trim() || "Karmify User");

  const store = await db.store.upsert({
    where: { ownerId: userId },
    update: {},
    create: { name: `${name}'s Store`, ownerId: userId },
  });

  await db.user.upsert({
    where: { id: userId },
    update: { storeId: store.id },
    create: { id: userId, email, name, role: Role.ADMIN, storeId: store.id },
  });

  return { userId, storeId: store.id, storeName: store.name };
});

// Like getTenant but throws — use inside server actions where an
// unauthenticated caller is a bug, not a state to handle.
export async function requireTenant(): Promise<Tenant> {
  const tenant = await getTenant();
  if (!tenant) throw new Error("Not authenticated.");
  return tenant;
}
