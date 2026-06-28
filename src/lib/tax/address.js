// Structured ship-to helpers for sales-tax sourcing (Phase 1 of multi-state
// tax — docs/qb-multistate-tax-scope.md). Shape: { street, city, state, zip,
// country }. `state` is the 2-letter USPS code, `country` defaults to "US".
//
// QuickBooks AST sources the tax jurisdiction from state + ZIP, so those two
// are the fields that matter; street/city are nice-to-have.

const BLANK_SHIP_TO = { street: "", city: "", state: "", zip: "", country: "US" };

/** A fresh, empty ship-to object (country pre-filled to US). */
export function emptyShipTo() {
  return { ...BLANK_SHIP_TO };
}

/** Trim/normalize a ship-to: uppercase state + country, default country US. */
export function normalizeShipTo(obj) {
  const s = obj && typeof obj === "object" ? obj : {};
  return {
    street:  String(s.street ?? "").trim(),
    city:    String(s.city ?? "").trim(),
    state:   String(s.state ?? "").trim().toUpperCase(),
    zip:     String(s.zip ?? "").trim(),
    country: String(s.country ?? "").trim().toUpperCase() || "US",
  };
}

/**
 * True when the ship-to has the minimum AST needs (state + zip). When false,
 * QuickBooks sources tax from the shop's home address — the Phase-0 hold then
 * catches any resulting mismatch.
 */
export function isShipToComplete(obj) {
  const s = normalizeShipTo(obj);
  return Boolean(s.state && s.zip);
}

/** True when every structured field is empty (treat as "no ship-to set"). */
export function isShipToEmpty(obj) {
  const s = normalizeShipTo(obj);
  return !s.street && !s.city && !s.state && !s.zip;
}

const US_TAIL = /,?\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/; // ", ST 12345"

/**
 * Best-effort parse of a US free-text address into a structured ship-to. Used
 * only as a UI pre-fill ("Fill from address") — never a blind DB write, since
 * a wrong ZIP yields wrong tax. Conservative: returns null unless it can find
 * a trailing 2-letter state + 5-digit ZIP, and never guesses those.
 *
 * Handles: "100 Liberty St, Reno, NV 89501" and "100 Liberty St\nReno NV 89501".
 */
export function parseUsAddress(text) {
  const raw = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return null;

  const m = raw.match(US_TAIL);
  if (!m) return null; // no confident state+zip — don't guess

  const state = m[1].toUpperCase();
  const zip = m[2];
  const head = raw.slice(0, m.index).replace(/[,\s]+$/, ""); // everything before ", ST zip"

  // Split the head into street + city on the last comma when present.
  let street = head;
  let city = "";
  const lastComma = head.lastIndexOf(",");
  if (lastComma !== -1) {
    street = head.slice(0, lastComma).trim();
    city = head.slice(lastComma + 1).trim();
  }

  return normalizeShipTo({ street, city, state, zip, country: "US" });
}
