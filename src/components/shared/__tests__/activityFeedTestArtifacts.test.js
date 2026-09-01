import { describe, it, expect } from "vitest";
import { isTestArtifact } from "../ActivityFeed";

// The activity feed hides change_log rows for documents created under the
// reserved TEST/DEMO code namespace used by live-testing sessions. Real
// codes are ORD-<year>-<base36>, so the filter must never match them.
describe("isTestArtifact", () => {
  it("matches reserved test/demo codes", () => {
    for (const ref of ["ORD-TEST-PREFS", "ORD-DEMO-E2E", "Q-TEST-1", "INV-DEMO-X", "ord-test-lower"]) {
      expect(isTestArtifact({ entity_ref: ref })).toBe(true);
    }
  });

  it("never matches real document codes", () => {
    for (const ref of ["ORD-2026-USKJZ", "Q-2026-331CF", "ORD-2026-TESTY", "ORD-2027-DEMOX", ""]) {
      expect(isTestArtifact({ entity_ref: ref })).toBe(false);
    }
  });

  it("tolerates missing refs", () => {
    expect(isTestArtifact({})).toBe(false);
    expect(isTestArtifact(null)).toBe(false);
  });
});
