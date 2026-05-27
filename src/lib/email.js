// Email format guard shared across forms that accept email input.
//
// Same minimal regex as the QB sync's _shared/qbInvoice.js isLikelyEmail —
// intentionally lax (something@something.something). Goal is "definitely
// not an email" rejection, not full RFC 822 validation. False positives
// like "a@b.c" still get through — those will be rejected at the QB
// API layer if they reach it, or never matter if the email stays
// internal.
//
// Why duplicate the QB lib's helper instead of importing: the QB version
// lives in supabase/functions/_shared/ (Deno), and this version lives
// in src/lib/ (browser via Vite). Keep them in sync if either changes.

export function isValidEmail(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /^\S+@\S+\.\S+$/.test(trimmed);
}
