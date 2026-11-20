import { UNLOCK_DAYS } from "@/lib/ownerPaths";

// Server side of the owner lock (see lib/ownerPaths.ts): checking the owner
// password and signing/checking the unlock cookie. Used by proxy.ts and the
// owner-access actions, never by pages. Web Crypto only, so it runs wherever
// the proxy does.
//
// The owner password is OWNER_UNLOCK_PASSWORD in the server's environment
// (.env locally, Vercel's settings in production). Without it, nothing unlocks.

const encoder = new TextEncoder();
const DAY_MS = 86_400_000;

/** The owner password from the server's environment, or null when it isn't set. */
export function ownerPassword(): string | null {
  const password = process.env.OWNER_UNLOCK_PASSWORD?.trim();
  return password ? password : null;
}

const sha256 = async (text: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)));

// The key mixes a long server secret with the owner password: a copied cookie
// can't be used to work out the password, and changing the password locks
// every device again.
async function signingKey(): Promise<CryptoKey | null> {
  const secret = process.env.CLERK_SECRET_KEY;
  const password = ownerPassword();
  if (!secret || !password) return null;
  const material = await sha256(`karmify-owner-v1\n${secret}\n${password}`);
  return crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

const toBase64Url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
    return Uint8Array.from(binary, c => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** True when the typed password is the owner password. Compares fixed-length hashes, so timing gives nothing away. */
export async function isOwnerPassword(typed: string): Promise<boolean> {
  const password = ownerPassword();
  if (!password) return false;
  const [a, b] = await Promise.all([sha256(typed.trim()), sha256(password)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** The unlock cookie's value: when it ends, and a signature over that. */
export async function signOwnerToken(until: number): Promise<string> {
  const key = await signingKey();
  if (!key) throw new Error("The owner lock isn't set up on the server.");
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`owner:${until}`));
  return `${until}.${toBase64Url(signature)}`;
}

/** When a valid unlock ends; null when the cookie is missing, altered, expired, or signed under an old password. */
export async function verifyOwnerToken(token: string | null | undefined, now = Date.now()): Promise<number | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !/^\d{1,15}$/.test(parts[0])) return null;
  const until = Number(parts[0]);
  // Expired, or further ahead than an unlock can last (not one this server made).
  if (until <= now || until > now + (UNLOCK_DAYS + 1) * DAY_MS) return null;
  const signature = fromBase64Url(parts[1]);
  const key = await signingKey();
  if (!signature || !key) return null;
  return (await crypto.subtle.verify("HMAC", key, signature, encoder.encode(`owner:${until}`))) ? until : null;
}

/** A new unlock's end time. */
export const unlockEnds = (now = Date.now()) => now + UNLOCK_DAYS * DAY_MS;
