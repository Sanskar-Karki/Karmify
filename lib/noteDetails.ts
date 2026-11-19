import { nameProblem } from "@/lib/customerIdentity";

// Reading a jotted-down order ("Asha Rai 98123 45678, hoodie M black…") for the
// customer details the POS can fill in. Only suggestions: staff tap to use them.

const toLatinDigits = (text: string) => text.replace(/[०-९]/g, d => String(d.charCodeAt(0) - 0x0966));

// A 10-digit Nepali mobile (96…, 97…, 98…), optionally after +977, with spaces
// or dashes inside it (never a line break). Not part of a longer run of digits.
const MOBILE = /(?<![\d+])(?:\+?977[ -]?)?(9[678]\d(?:[ -]?\d){7})(?!\d)/g;

const PUNCTUATION = "[\\s.,;:|/()-]";
/** Words written right before a number that aren't part of the name ("Asha ph: 98…"). */
const TRAILING_LABEL = new RegExp(`${PUNCTUATION}*(?:\\b(?:ph|phone|mob|mobile|no|num|number|contact|cell|tel)\\b)?${PUNCTUATION}*$`, "i");
/** A first word that starts an instruction, not a name ("Call 98…", "Msg back 98…"). */
const NOT_A_NAME = /^(?:call|ring|msg|message|text|sms|whatsapp|viber|contact|phone|number|mobile|order|cod|deliver|delivery|send|pay|paid)\b/i;
/** Small words that show it's a phrase, not a name ("Sale plan for Dashain"). */
const PHRASE_WORD = /\b(?:for|the|and|in|of|to|with|at|on|is|from|wants?|needs?|after|before)\b/i;

const digitsOf = (match: string) => match.replace(/\D/g, "");

/** The mobile numbers in a note, as plain 10 digits, first seen first, no repeats. */
export function phonesIn(text: string): string[] {
  const found: string[] = [];
  for (const m of toLatinDigits(text).matchAll(MOBILE)) {
    const phone = digitsOf(m[1]);
    if (!found.includes(phone)) found.push(phone);
  }
  return found;
}

/** Looks like a person's name: letters only, one to three words, not a phrase. */
function asName(raw: string): string | null {
  const name = raw
    .replace(TRAILING_LABEL, "") // "Asha Rai ph:" → "Asha Rai"
    .replace(/^[^:]*:/, "") // "Name: Asha Rai" → "Asha Rai"
    .replace(/^[\s,;:|/()-]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (name.length < 2 || name.length > 40 || name.split(" ").length > 3) return null;
  if (NOT_A_NAME.test(name) || PHRASE_WORD.test(name) || nameProblem(name)) return null;
  return name;
}

/**
 * The customer a jotted-down order is for: the first mobile number, and the
 * name written just before it ("Asha Rai 98123 45678") or alone on the line above.
 */
export function noteCustomer(text: string): { name: string | null; phone: string | null } {
  const lines = toLatinDigits(text).split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = new RegExp(MOBILE.source).exec(lines[i]);
    if (!m) continue;
    // What's before the number on its line, after the last comma ("Order: Asha Rai, 98…"),
    // leaving out a label ("Asha Rai, ph: 98…"). Nothing there: the line above.
    const before = lines[i].slice(0, m.index).split(/[,;|]/).map(part => part.replace(TRAILING_LABEL, "")).filter(part => part.trim()).pop();
    const name = before ? asName(before) : i > 0 ? asName(lines[i - 1]) : null;
    return { name, phone: digitsOf(m[1]) };
  }
  return { name: null, phone: null };
}

/** "98123 45678": a mobile number spaced the way people read it out. */
export const spacedPhone = (phone: string) => (phone.length === 10 ? `${phone.slice(0, 5)} ${phone.slice(5)}` : phone);
