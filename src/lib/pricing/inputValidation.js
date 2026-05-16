// Pure validation for pricing config inputs in the Account page.
//
// The bug this defends against: every `parseFloat(value) || 0`
// handler silently coerces bad input to 0. Type "abc" in the print
// price for tier 100 → save → every 100+ piece quote bills $0 for
// that color count. Shop owner doesn't notice until a customer
// asks why their quote is half-price.
//
// This module rejects input that doesn't fully parse as a positive
// number in the expected range, and returns a human-readable error
// the UI can surface instead of silently saving garbage.

// Rejects strings that contain anything beyond an optional leading
// sign, digits, and a single decimal point. Catches:
//   - letters ("3abc", "abc")
//   - mixed garbage ("3.14.15", "1+1")
//   - scientific notation ("5e10" → would parse to 50 billion otherwise)
//   - symbols ("$", "%", ",")
const STRICT_NUMERIC = /^-?\d+(\.\d+)?$/;

/**
 * Parse a pricing input value. Strict — rejects partial parses.
 *
 * @param {string|number} input — the value to parse (typically from an input field)
 * @param {object} opts
 * @param {string} opts.label   — human-readable label for error messages ("Print price for 1 color at tier 100")
 * @param {number} [opts.min]   — inclusive minimum (default 0)
 * @param {number} [opts.max]   — inclusive maximum (no default)
 * @param {boolean} [opts.integer]    — when true, decimals are rejected
 * @param {boolean} [opts.allowEmpty] — when true, empty string returns { ok: true, value: undefined }
 *
 * @returns {{ ok: true, value: number } | { ok: false, error: string }}
 */
export function parsePricingNumber(input, opts = {}) {
  const {
    label = "Value",
    min = 0,
    max = Infinity,
    integer = false,
    allowEmpty = false,
  } = opts;

  // Normalize: numbers pass through as their string repr; everything
  // else trims to a string.
  const str = typeof input === "number" && Number.isFinite(input)
    ? String(input)
    : String(input ?? "").trim();

  if (str === "") {
    if (allowEmpty) return { ok: true, value: undefined };
    return { ok: false, error: `${label} can't be empty.` };
  }

  if (!STRICT_NUMERIC.test(str)) {
    return {
      ok: false,
      error: `${label} must be a number (got "${input}").`,
    };
  }

  const n = Number(str);
  if (!Number.isFinite(n)) {
    // Belt-and-suspenders — STRICT_NUMERIC should already catch this.
    return { ok: false, error: `${label} is not a valid number.` };
  }

  if (integer && !Number.isInteger(n)) {
    return { ok: false, error: `${label} must be a whole number (got ${n}).` };
  }

  if (n < min) {
    return { ok: false, error: `${label} must be at least ${min} (got ${n}).` };
  }

  if (n > max) {
    return { ok: false, error: `${label} can't exceed ${max} (got ${n}).` };
  }

  return { ok: true, value: n };
}

// ── Field-specific shortcuts ────────────────────────────────────────
//
// Each one fixes the right shape for a known config field. The label
// flows into the error message verbatim so the shop owner sees the
// exact field that's wrong.

/** Money input — price per piece, extra rate, etc. ≥ 0, decimals allowed. */
export function validateMoney(input, label) {
  return parsePricingNumber(input, { label, min: 0, max: 100000 });
}

/** Markup multiplier — must be ≥ 1 (selling below cost is almost never intentional). */
export function validateMarkup(input, label) {
  return parsePricingNumber(input, { label, min: 1, max: 10 });
}

/** Tax rate — percent, 0..100. */
export function validateTaxRate(input, label) {
  return parsePricingNumber(input, { label, min: 0, max: 100 });
}

/** Quantity tier — integer ≥ 1. Tier 0 makes no sense for pricing. */
export function validateTierQty(input, label) {
  return parsePricingNumber(input, { label, min: 1, max: 1_000_000, integer: true });
}

// ── Full-config validator ────────────────────────────────────────────
//
// Walks an entire pricing_config object and returns the list of
// problems. The Save handler calls this BEFORE writing to DB — if
// anything is wrong, it shows the user the full list rather than
// scattering inline errors they have to hunt for.

/**
 * Validate a pricing_config JSONB shape. Returns an array of error
 * strings; empty array means valid.
 *
 * Checks:
 *   - tiers: each is a positive integer
 *   - firstPrint[colors][tier]: each is money ≥ 0
 *   - addlPrint[colors][tier]: each is money ≥ 0
 *   - garmentMarkup[i].above + .markup
 *   - extras[name]: each is money ≥ 0
 *   - embroidery.qtyTiers: each is a positive integer
 *   - embroidery.pricing[stitchTier][qtyTier]: each is money ≥ 0
 *
 * Defaults are skipped — if a field isn't present in the config, we
 * don't error (the live code falls back to the hardcoded defaults).
 */
export function validatePricingConfig(config) {
  const errors = [];
  if (!config || typeof config !== "object") return errors;

  // tiers
  if (Array.isArray(config.tiers)) {
    config.tiers.forEach((tier, i) => {
      const r = validateTierQty(tier, `Tier #${i + 1}`);
      if (!r.ok) errors.push(r.error);
    });
  }

  // firstPrint / addlPrint
  for (const tableName of ["firstPrint", "addlPrint"]) {
    const table = config[tableName];
    if (!table || typeof table !== "object") continue;
    const tableLabel = tableName === "firstPrint" ? "First print" : "Additional print";
    for (const colors of Object.keys(table)) {
      const row = table[colors];
      if (!row || typeof row !== "object") continue;
      for (const tier of Object.keys(row)) {
        const r = validateMoney(row[tier], `${tableLabel}, ${colors} color × ${tier} pcs`);
        if (!r.ok) errors.push(r.error);
      }
    }
  }

  // garmentMarkup
  if (Array.isArray(config.garmentMarkup)) {
    config.garmentMarkup.forEach((entry, i) => {
      if (!entry || typeof entry !== "object") return;
      const aboveR = parsePricingNumber(entry.above, { label: `Garment markup tier #${i + 1} "above"`, min: 0 });
      if (!aboveR.ok) errors.push(aboveR.error);
      const markupR = validateMarkup(entry.markup, `Garment markup tier #${i + 1} multiplier`);
      if (!markupR.ok) errors.push(markupR.error);
    });
  }

  // extras
  if (config.extras && typeof config.extras === "object") {
    for (const key of Object.keys(config.extras)) {
      const r = validateMoney(config.extras[key], `Extras → ${key}`);
      if (!r.ok) errors.push(r.error);
    }
  }

  // embroidery
  const emb = config.embroidery;
  if (emb && typeof emb === "object") {
    if (Array.isArray(emb.qtyTiers)) {
      emb.qtyTiers.forEach((tier, i) => {
        const r = validateTierQty(tier, `Embroidery qty tier #${i + 1}`);
        if (!r.ok) errors.push(r.error);
      });
    }
    if (emb.pricing && typeof emb.pricing === "object") {
      for (const stitchTier of Object.keys(emb.pricing)) {
        const row = emb.pricing[stitchTier];
        if (!row || typeof row !== "object") continue;
        for (const qty of Object.keys(row)) {
          const r = validateMoney(row[qty], `Embroidery "${stitchTier}" × ${qty} pcs`);
          if (!r.ok) errors.push(r.error);
        }
      }
    }
  }

  return errors;
}
