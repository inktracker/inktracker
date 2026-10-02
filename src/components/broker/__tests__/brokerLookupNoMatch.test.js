import { describe, it, expect } from "vitest";
import { getResultCandidates } from "../BrokerLineItemEditor";
import { cleanText } from "@/lib/quotes/lineItemText";

// The no-match guard in handleStyleBlur relies on: an empty lookup still
// produces a candidate (the synthetic "single-result"), but one with NO real
// identifying fields — so applying it would stamp a phantom $0 / blank-brand
// garment. These pin that premise so the guard can't silently rot.
const hasRealMatch = (matches) =>
  matches.some(
    (m) => cleanText(m.styleNumber) || cleanText(m.brandName) || cleanText(m.resolvedTitle) || cleanText(m.title),
  );

describe("getResultCandidates — no-match detection for the broker editor", () => {
  it("an empty lookup yields candidates with NO real identifying fields", () => {
    const matches = getResultCandidates({ matches: [] });
    // It does return something (a synthetic candidate), but nothing identifying,
    // so the guard treats it as "not found".
    expect(hasRealMatch(matches)).toBe(false);
  });

  it("a real supplier match IS detected as a real match", () => {
    const matches = getResultCandidates({
      matches: [{ styleNumber: "1717", brandName: "Comfort Colors", title: "Ring Spun Tee", _supplier: "SanMar" }],
    });
    expect(hasRealMatch(matches)).toBe(true);
    expect(cleanText(matches[0].styleNumber)).toBe("1717");
  });

  it("a single-object result (not a matches array) with real fields is a real match", () => {
    const matches = getResultCandidates({ styleNumber: "5000", brandName: "Gildan" });
    expect(hasRealMatch(matches)).toBe(true);
  });
});
