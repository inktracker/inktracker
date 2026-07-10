import { describe, it, expect } from "vitest";
import { normalizeImprint } from "../LineItemEditor";

// Regression for the "Custom… location does nothing" bug. PlacementSelect
// enters custom (free-text) mode by setting the location to an empty string.
// normalizeImprint runs on every render/update, and `location || "Front"`
// coerced that "" straight back to "Front" — so the text input never appeared
// and editing any other field while in custom mode reset the location too.
describe("normalizeImprint — location handling", () => {
  it("preserves an explicit empty-string location (PlacementSelect custom mode)", () => {
    expect(normalizeImprint({ location: "" }).location).toBe("");
  });

  it("keeps a typed custom location", () => {
    expect(normalizeImprint({ location: "Nape" }).location).toBe("Nape");
  });

  it("defaults a truly-absent location to Front", () => {
    expect(normalizeImprint({}).location).toBe("Front");
    expect(normalizeImprint({ location: null }).location).toBe("Front");
    expect(normalizeImprint({ location: undefined }).location).toBe("Front");
    expect(normalizeImprint(null).location).toBe("Front");
  });
});
