import { describe, it, expect } from "vitest";
import {
  EXEMPTION_TYPES, exemptionTypeLabel, parseStateList,
  isExemptionExpired, isExemptionExpiringSoon, isExemptionActive, exemptionStatus,
} from "../exemption";

const asOf = "2026-06-27";

describe("parseStateList", () => {
  it("splits on commas/whitespace, uppercases, keeps only 2-letter codes", () => {
    expect(parseStateList("ca, nv  tx")).toEqual(["CA", "NV", "TX"]);
    expect(parseStateList("California, NV")).toEqual(["NV"]); // drops non-2-letter
    expect(parseStateList("")).toEqual([]);
    expect(parseStateList(null)).toEqual([]);
  });
});

describe("exemptionTypeLabel", () => {
  it("maps known values, blank otherwise", () => {
    expect(exemptionTypeLabel("resale")).toBe("Resale");
    expect(exemptionTypeLabel("nope")).toBe("");
    expect(EXEMPTION_TYPES.length).toBe(4);
  });
});

describe("isExemptionExpired", () => {
  it("true only when expiry strictly precedes asOf", () => {
    expect(isExemptionExpired({ exemption_expires_at: "2026-06-26" }, asOf)).toBe(true);
    expect(isExemptionExpired({ exemption_expires_at: "2026-06-27" }, asOf)).toBe(false);
    expect(isExemptionExpired({ exemption_expires_at: "2026-06-28" }, asOf)).toBe(false);
    expect(isExemptionExpired({}, asOf)).toBe(false); // no expiry
  });
});

describe("isExemptionExpiringSoon", () => {
  it("true within the window, false when already expired or far out", () => {
    expect(isExemptionExpiringSoon({ exemption_expires_at: "2026-07-10" }, 30, asOf)).toBe(true);
    expect(isExemptionExpiringSoon({ exemption_expires_at: "2026-09-01" }, 30, asOf)).toBe(false); // far
    expect(isExemptionExpiringSoon({ exemption_expires_at: "2026-06-01" }, 30, asOf)).toBe(false); // expired
    expect(isExemptionExpiringSoon({}, 30, asOf)).toBe(false);
  });
});

describe("isExemptionActive (frontend mirror)", () => {
  it("requires the flag, respects expiry + state scope", () => {
    expect(isExemptionActive({ tax_exempt: false }, { asOf })).toBe(false);
    expect(isExemptionActive({ tax_exempt: true }, { asOf })).toBe(true);
    expect(isExemptionActive({ tax_exempt: true, exemption_expires_at: "2026-06-26" }, { asOf })).toBe(false);
    const scoped = { tax_exempt: true, exemption_states: ["CA"] };
    expect(isExemptionActive(scoped, { asOf, destinationState: "CA" })).toBe(true);
    expect(isExemptionActive(scoped, { asOf, destinationState: "NV" })).toBe(false);
    expect(isExemptionActive(scoped, { asOf })).toBe(true); // unknown destination
  });
});

describe("exemptionStatus", () => {
  it("classifies none / active / expiring / expired", () => {
    expect(exemptionStatus({ tax_exempt: false }, asOf)).toBe("none");
    expect(exemptionStatus({ tax_exempt: true }, asOf)).toBe("active");
    expect(exemptionStatus({ tax_exempt: true, exemption_expires_at: "2026-07-05" }, asOf)).toBe("expiring");
    expect(exemptionStatus({ tax_exempt: true, exemption_expires_at: "2026-06-01" }, asOf)).toBe("expired");
  });
});
