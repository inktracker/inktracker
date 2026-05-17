// Pure decision logic for the NumericInput React component.
//
// React component logic is hard to test in our node-only vitest
// setup. Extracting the decision here lets us cover every branch
// without React Testing Library. The component just renders and
// dispatches whatever this function returns.

import { parsePricingNumber } from "./inputValidation.js";

/**
 * Decide what NumericInput should do when the user types `rawInput`.
 *
 * @param {string} rawInput — exactly what's in the input field
 * @param {object} opts
 * @param {boolean} [opts.clearOnEmpty=false] — when true, an empty
 *   field is treated as an intentional clear (e.g. clientPpp
 *   override); when false, empty is an intermediate typing state and
 *   the saved value is preserved (e.g. pricing config fields).
 * @param {string} [opts.label]    — used in error messages
 * @param {number} [opts.min]      — inclusive
 * @param {number} [opts.max]      — inclusive
 * @param {boolean} [opts.integer] — when true, decimals are rejected
 *
 * @returns {{ kind: "save", value: number }
 *         | { kind: "clear" }
 *         | { kind: "ignore" }
 *         | { kind: "invalid", error: string }}
 *
 *   "save"    — push the parsed number to parent state
 *   "clear"   — push null/undefined to parent state (field cleared)
 *   "ignore"  — leave parent state alone (intermediate typing)
 *   "invalid" — leave parent state alone AND flag the field
 */
export function decideInputAction(rawInput, opts = {}) {
  const { clearOnEmpty = false, ...parseOpts } = opts;

  if (rawInput === "") {
    return clearOnEmpty ? { kind: "clear" } : { kind: "ignore" };
  }

  const r = parsePricingNumber(rawInput, parseOpts);
  if (!r.ok) return { kind: "invalid", error: r.error };
  return { kind: "save", value: r.value };
}

/**
 * Format a saved value for display in the input field.
 *
 * Defensive: null, undefined, and non-finite numbers (NaN, Infinity)
 * all render as the empty string. Anything else gets `String()`'d.
 *
 * @param {*} value
 * @returns {string}
 */
export function formatDisplayValue(value) {
  if (value === null || value === undefined) return "";
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? String(n) : "";
}
