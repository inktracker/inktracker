import { describe, it, expect } from "vitest";
import {
  decideInputAction,
  formatDisplayValue,
} from "../numericInputState.js";

// ─────────────────────────────────────────────────────────────────────
// decideInputAction — the per-keystroke decision
// ─────────────────────────────────────────────────────────────────────

describe("decideInputAction — saves clean numbers", () => {
  it("DI1 — clean integer → save", () => {
    expect(decideInputAction("5", { label: "X" }))
      .toEqual({ kind: "save", value: 5 });
  });

  it("DI2 — clean decimal → save", () => {
    expect(decideInputAction("5.25", { label: "X" }))
      .toEqual({ kind: "save", value: 5.25 });
  });

  it("DI3 — zero is a valid saved value", () => {
    // Pricing fields like rushRate/digitizingFee legitimately accept 0.
    expect(decideInputAction("0", { label: "X" }))
      .toEqual({ kind: "save", value: 0 });
  });
});

describe("decideInputAction — empty-field handling", () => {
  it("DI4 — empty + clearOnEmpty:false → ignore (preserves saved value)", () => {
    // The canonical fix for the "user clears field mid-edit, saved
    // value gets clobbered to 0" bug. With clearOnEmpty:false the
    // saved value stays whatever it was before they started typing.
    expect(decideInputAction("", { clearOnEmpty: false }))
      .toEqual({ kind: "ignore" });
  });

  it("DI5 — empty + clearOnEmpty:true → clear (user intentionally cleared)", () => {
    // For fields like clientPpp where empty means "no override."
    expect(decideInputAction("", { clearOnEmpty: true }))
      .toEqual({ kind: "clear" });
  });

  it("DI6 — empty defaults to ignore (safer default for pricing inputs)", () => {
    expect(decideInputAction("")).toEqual({ kind: "ignore" });
  });
});

describe("decideInputAction — invalid input never saves", () => {
  it("DI7 — letters → invalid (the canonical 'abc in price field' case)", () => {
    const r = decideInputAction("abc", { label: "Rush rate" });
    expect(r.kind).toBe("invalid");
    expect(r.error).toMatch(/Rush rate/);
    expect(r.error).toMatch(/abc/);
  });

  it("DI8 — symbols ($, %, ,) → invalid", () => {
    expect(decideInputAction("$5", { label: "X" }).kind).toBe("invalid");
    expect(decideInputAction("5%", { label: "X" }).kind).toBe("invalid");
    expect(decideInputAction("1,000", { label: "X" }).kind).toBe("invalid");
  });

  it("DI9 — scientific notation rejected (would otherwise silently 100x prices)", () => {
    // parseFloat("5e10") = 50000000000. A typo destroys the pricing
    // chart. STRICT_NUMERIC catches it.
    expect(decideInputAction("5e10", { label: "X" }).kind).toBe("invalid");
  });

  it("DI10 — partial-decimal intermediate ('1.') → invalid (no save mid-edit)", () => {
    // While typing "1.25", user passes through "1.". STRICT_NUMERIC
    // requires digits after the dot, so "1." returns invalid and the
    // saved value stays at the last good number until they finish.
    expect(decideInputAction("1.", { label: "X" }).kind).toBe("invalid");
  });

  it("DI11 — out of range (below min) → invalid", () => {
    const r = decideInputAction("-1", { label: "Price", min: 0 });
    expect(r.kind).toBe("invalid");
    expect(r.error).toMatch(/at least 0/);
  });

  it("DI12 — out of range (above max) → invalid", () => {
    const r = decideInputAction("150", { label: "Tax", min: 0, max: 100 });
    expect(r.kind).toBe("invalid");
    expect(r.error).toMatch(/can't exceed 100/);
  });

  it("DI13 — integer flag rejects decimals", () => {
    const r = decideInputAction("5.5", { label: "Tier", integer: true });
    expect(r.kind).toBe("invalid");
    expect(r.error).toMatch(/whole number/);
  });

  it("DI14 — integer flag accepts integers", () => {
    expect(decideInputAction("5", { label: "Tier", integer: true }))
      .toEqual({ kind: "save", value: 5 });
  });

  it("DI15 — mid-typing '-' alone → invalid, no save", () => {
    // User types "-5" — passes through "-" first. We don't want to
    // commit "-" as anything; just ignore until valid number forms.
    expect(decideInputAction("-", { label: "X" }).kind).toBe("invalid");
  });
});

// ─────────────────────────────────────────────────────────────────────
// formatDisplayValue — defensive prop → string
// ─────────────────────────────────────────────────────────────────────

describe("formatDisplayValue — robust prop-to-display conversion", () => {
  it("FD1 — null → empty string", () => {
    expect(formatDisplayValue(null)).toBe("");
  });

  it("FD2 — undefined → empty string", () => {
    expect(formatDisplayValue(undefined)).toBe("");
  });

  it("FD3 — number passes through", () => {
    expect(formatDisplayValue(5)).toBe("5");
    expect(formatDisplayValue(5.25)).toBe("5.25");
    expect(formatDisplayValue(0)).toBe("0");
  });

  it("FD4 — NaN → empty (don't show 'NaN' in the field)", () => {
    // Defensive — if upstream feeds us NaN (e.g. from a broken
    // parseFloat elsewhere), don't pollute the input with "NaN".
    expect(formatDisplayValue(NaN)).toBe("");
  });

  it("FD5 — Infinity → empty", () => {
    expect(formatDisplayValue(Infinity)).toBe("");
    expect(formatDisplayValue(-Infinity)).toBe("");
  });

  it("FD6 — numeric string coerces and formats", () => {
    expect(formatDisplayValue("5.25")).toBe("5.25");
  });

  it("FD7 — non-numeric string → empty", () => {
    expect(formatDisplayValue("abc")).toBe("");
  });
});
