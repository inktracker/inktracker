// Resolve a user-facing display name with sensible fallbacks.
//
// Greeting copy ("Hi, Joe") should never fall back to the raw email
// ("Hi, joe@biotamfg.co") — that feels robotic. This helper picks
// the best available source:
//
//   1. user.first_name        — explicit, preferred
//   2. user.full_name         — legacy field, split on first whitespace
//   3. email local-part       — capitalized so "joe@..." becomes "Joe"
//   4. null                   — caller should hide the greeting
//
// Pure function, no React/Supabase coupling — easy to test in node.

/**
 * Best-effort first name for greeting display.
 *
 * @param {object|null} user — profile-shaped object (first_name, full_name, email)
 * @returns {string|null}    — first-name to display, or null if no signal
 */
export function displayFirstName(user) {
  if (!user) return null;

  const first = trimmed(user.first_name);
  if (first) return first;

  const full = trimmed(user.full_name);
  if (full) {
    // Take the first whitespace-separated token. "Mary Ann Smith"
    // returns "Mary"; "Madonna" returns "Madonna".
    return full.split(/\s+/)[0];
  }

  const email = trimmed(user.email);
  if (email && email.includes("@")) {
    const local = email.split("@")[0];
    if (local) return capitalize(local);
  }

  return null;
}

/**
 * Best-effort full name. Prefer first + last; fall back to full_name;
 * then email; then null.
 */
export function displayFullName(user) {
  if (!user) return null;

  const first = trimmed(user.first_name);
  const last  = trimmed(user.last_name);
  if (first && last) return `${first} ${last}`;
  if (first) return first;

  const full = trimmed(user.full_name);
  if (full) return full;

  const email = trimmed(user.email);
  if (email) return email;

  return null;
}

function trimmed(s) {
  return typeof s === "string" && s.trim() ? s.trim() : null;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
