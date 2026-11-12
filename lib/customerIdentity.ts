import type { Prisma } from "@prisma/client";

// How an order is matched to a customer, and how customer IDs are issued.
// Imported by the app and by prisma/backfill-customers.ts, so it can only have
// type imports and must use syntax Node can run directly.

const WALK_IN_NAME = "walk-in customer";

/**
 * Reduces a phone number to one comparable form, so "+977 984-1000000",
 * "९८४१००००००" and "9841000000" are the same person. Placeholders like "N/A"
 * aren't phone numbers.
 */
export function normalizePhone(raw?: string | null): string | null {
  let digits = (raw ?? "")
    .replace(/[०-९]/g, d => String(d.charCodeAt(0) - 0x0966))
    .replace(/\D/g, "")
    .replace(/^00/, "");
  if (digits.length === 13 && digits.startsWith("977")) digits = digits.slice(3);
  if (digits.length === 11 && digits.startsWith("09")) digits = digits.slice(1);
  return digits.length >= 7 ? digits : null;
}

/** The value that identifies a customer: phone first, then email, then name. Null for anonymous orders. */
export function customerIdentityKey(details: {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
}): string | null {
  const phone = normalizePhone(details.phone);
  if (phone) return `phone:${phone}`;

  const email = details.email?.trim().toLowerCase();
  if (email) return `email:${email}`;

  const name = details.name?.trim().replace(/\s+/g, " ").toLowerCase();
  return name && name !== WALK_IN_NAME ? `name:${name}` : null;
}

export const formatCustomerCode = (sequence: number) => `CUS-${String(sequence).padStart(6, "0")}`;

/** The canonical customer ID in what someone typed or scanned, or null if it isn't one. */
export function parseCustomerCode(input: string): string | null {
  const match = /^CUS-?(\d{6,})$/.exec(input.trim().toUpperCase());
  return match ? `CUS-${match[1]}` : null;
}

type CustomerClient = Pick<Prisma.TransactionClient, "customer" | "store">;

/**
 * Finds the customer for an identity, issuing a new ID if this is their first
 * order. Call it inside the transaction that saves the order.
 *
 * IDs come from a counter on the store rather than the highest existing code,
 * so a number printed on an old label is never given to someone else.
 */
export async function findOrCreateCustomerId(
  tx: CustomerClient,
  storeId: string,
  identityKey: string | null
): Promise<string | null> {
  if (!identityKey) return null;
  const where = { storeId_identityKey: { storeId, identityKey } };

  const existing = await tx.customer.findUnique({ where, select: { id: true } });
  if (existing) return existing.id;

  // The increment locks the store row, so a second request for this same new
  // customer waits here and then finds the row the first one created.
  const { customerSeq } = await tx.store.update({
    where: { id: storeId },
    data: { customerSeq: { increment: 1 } },
    select: { customerSeq: true },
  });

  const raced = await tx.customer.findUnique({ where, select: { id: true } });
  if (raced) return raced.id;

  const created = await tx.customer.create({
    data: { storeId, identityKey, code: formatCustomerCode(customerSeq) },
    select: { id: true },
  });
  return created.id;
}

/**
 * Nepal phone numbers: a 10-digit mobile (starting with 9) or a 7-digit
 * landline. Spaces, dashes, Nepali digits and a +977 prefix are fine.
 * Returns what's wrong, or null when the number is fine.
 */
export function phoneProblem(raw: string): string | null {
  const digits = raw
    .replace(/[०-९]/g, d => String(d.charCodeAt(0) - 0x0966))
    .replace(/\D/g, "")
    .replace(/^00/, "")
    .replace(/^977(?=\d{10}$)/, "");
  if (digits.length === 10 && digits.startsWith("9")) return null;
  if (digits.length === 7) return null;
  if (digits.length === 10) return "A 10-digit mobile number starts with 9.";
  return "Phone must be 10 digits (mobile) or 7 digits (landline).";
}

/** A customer name has letters and no digits. Returns what's wrong, or null. */
export function nameProblem(raw: string): string | null {
  if (/[0-9०-९]/.test(raw)) return "Name can't contain numbers.";
  if (!/\p{L}/u.test(raw)) return "Enter the customer's name.";
  return null;
}
