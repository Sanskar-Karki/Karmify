import "server-only";

import { cache } from "react";
import { auth, currentUser } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";
import { UserError } from "@/lib/actions/result";

export type Tenant = {
  userId: string;
  storeId: string;
  storeName: string;
};

// Running locally (`next dev`) signs in through Clerk's development instance,
// whose user IDs differ from production's. KARMIFY_DEV_USER_ID maps that login
// to a production user so a local copy opens the same store. Never applies to
// a production build.
function localUserId(clerkUserId: string) {
  const mapped = process.env.KARMIFY_DEV_USER_ID?.trim();
  return process.env.NODE_ENV === "development" && mapped ? mapped : clerkUserId;
}

// Resolve the current Clerk user to their tenant (user row + store), creating
// both on first login. `cache()` dedupes this per request, so a server action
// that logs activity, adjusts stock, and notifies only hits auth + DB once.
export const getTenant = cache(async (): Promise<Tenant | null> => {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return null;
  const userId = localUserId(clerkUserId);

  const existing = await db.user.findUnique({
    where: { id: userId },
    include: { store: { select: { id: true, name: true } } },
  });

  if (existing?.store) {
    return { userId, storeId: existing.store.id, storeName: existing.store.name };
  }

  // A login with no store. Karmify is the shop's own back office, so a stranger
  // who signs up gets nothing unless KARMIFY_OPEN_SIGNUP=true (for setting up a
  // brand-new shop). Clerk's sign-up should also be set to Restricted.
  if (process.env.KARMIFY_OPEN_SIGNUP !== "true") return null;

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
  if (!tenant) {
    const { userId } = await auth();
    throw new UserError(
      userId
        ? "This account doesn't have access to Karmify. Ask the shop owner to add you."
        : "Your session has expired. Please sign in again."
    );
  }
  return tenant;
}
