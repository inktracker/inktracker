// Completeness rules for saving AS Colour credentials, extracted from
// SupplierKeysSection so the matrix is unit-testable.
//
// Why completeness matters: credential resolution in the edge layer is
// all-or-nothing (supabase/functions/_shared/ascolour.ts) — the moment a
// shop saves a subscription key, platform fallback stops and ALL calls run
// on the shop's creds. Catalog browsing works on the key alone, but the
// pricelist needs a Bearer token minted from email + password. A key-only
// save therefore produces a shop that sees styles with NO prices, silently.
// This validator makes that state unsaveable.

/**
 * @param {object} typed   what the user entered this save (already trimmed):
 *                         { key, email, password } — empty string = untouched
 * @param {object} server  what's already stored (from getFlags):
 *                         { hasKey, hasEmail, hasPassword }
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateAcCredsSave(typed, server = {}) {
  const touched = Boolean(typed.key || typed.email || typed.password);
  if (!touched) return { ok: true }; // no AC change in this save

  // Effective post-save state: a typed value replaces the stored one;
  // save-never-wipes means an empty input keeps whatever the server has.
  const effective = {
    key: Boolean(typed.key || server.hasKey),
    email: Boolean(typed.email || server.hasEmail),
    password: Boolean(typed.password || server.hasPassword),
  };

  if (!effective.key) {
    return {
      ok: false,
      error:
        "AS Colour needs your Subscription Key too — email and password alone can't connect. Nothing was saved.",
    };
  }
  if (!effective.email || !effective.password) {
    const missing = [
      !effective.email && "email",
      !effective.password && "password",
    ]
      .filter(Boolean)
      .join(" and ");
    return {
      ok: false,
      error:
        `AS Colour pricing needs your account ${missing} as well — with only a subscription key ` +
        `you'd see styles but no prices. Add the missing field${missing.includes("and") ? "s" : ""} and save again. Nothing was saved.`,
    };
  }
  return { ok: true };
}

// Card-level warning for shops whose SAVED state is already incomplete
// (connected before this validation existed). Returns null when healthy.
export function acConnectionWarning(server = {}) {
  if (!server.hasKey) return null;
  if (server.hasEmail && server.hasPassword) return null;
  const missing = [
    !server.hasEmail && "email",
    !server.hasPassword && "password",
  ]
    .filter(Boolean)
    .join(" and ");
  return (
    `Connected, but prices can't load: AS Colour pricing requires your account ${missing}. ` +
    `Click Edit, add the missing field${missing.includes("and") ? "s" : ""}, then re-sync your wizard styles so garment prices update.`
  );
}
