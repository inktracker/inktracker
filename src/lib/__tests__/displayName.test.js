import { describe, it, expect } from "vitest";
import { displayFirstName, displayFullName } from "../displayName.js";

describe("displayFirstName", () => {
  it("DF1 — prefers first_name when present", () => {
    expect(displayFirstName({ first_name: "Joe", full_name: "Not Used", email: "x@y.com" })).toBe("Joe");
  });

  it("DF2 — trims whitespace from first_name", () => {
    expect(displayFirstName({ first_name: "  Joe  " })).toBe("Joe");
  });

  it("DF3 — falls back to first token of full_name", () => {
    expect(displayFirstName({ full_name: "Joe Grennan" })).toBe("Joe");
  });

  it("DF4 — handles three-token names (takes first)", () => {
    expect(displayFirstName({ full_name: "Mary Ann Smith" })).toBe("Mary");
  });

  it("DF5 — single-token full_name returns whole thing", () => {
    expect(displayFirstName({ full_name: "Madonna" })).toBe("Madonna");
  });

  it("DF6 — falls back to capitalized email local-part", () => {
    expect(displayFirstName({ email: "joe@biotamfg.co" })).toBe("Joe");
  });

  it("DF7 — handles dotted email local-part as-is (no surname inference)", () => {
    // Don't try to parse "jane.smith@..." into "Jane Smith" — too unreliable.
    expect(displayFirstName({ email: "jane.smith@x.com" })).toBe("Jane.smith");
  });

  it("DF8 — null/undefined user returns null", () => {
    expect(displayFirstName(null)).toBeNull();
    expect(displayFirstName(undefined)).toBeNull();
  });

  it("DF9 — empty strings treated as absent", () => {
    expect(displayFirstName({ first_name: "", full_name: "", email: "joe@x.co" })).toBe("Joe");
  });

  it("DF10 — whitespace-only strings treated as absent", () => {
    expect(displayFirstName({ first_name: "   ", full_name: "  ", email: "joe@x.co" })).toBe("Joe");
  });

  it("DF11 — no signals at all returns null", () => {
    expect(displayFirstName({})).toBeNull();
    expect(displayFirstName({ first_name: "", full_name: "", email: "" })).toBeNull();
  });
});

describe("displayFullName", () => {
  it("FN1 — combines first + last", () => {
    expect(displayFullName({ first_name: "Joe", last_name: "Grennan" })).toBe("Joe Grennan");
  });

  it("FN2 — first_name only when last is missing", () => {
    expect(displayFullName({ first_name: "Joe" })).toBe("Joe");
  });

  it("FN3 — falls back to legacy full_name field", () => {
    expect(displayFullName({ full_name: "Joe Grennan" })).toBe("Joe Grennan");
  });

  it("FN4 — falls back to email if no name fields", () => {
    expect(displayFullName({ email: "joe@biotamfg.co" })).toBe("joe@biotamfg.co");
  });

  it("FN5 — null user returns null", () => {
    expect(displayFullName(null)).toBeNull();
  });
});
