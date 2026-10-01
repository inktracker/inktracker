import { describe, it, expect } from "vitest";
import { escapeLikeLiteral } from "../likeEscape.js";

describe("escapeLikeLiteral — kills LIKE wildcard semantics in user input", () => {
  it("escapes % (the enumeration vector)", () => {
    expect(escapeLikeLiteral("%@gmail.com")).toBe("\\%@gmail.com");
    expect(escapeLikeLiteral("a%b%c")).toBe("a\\%b\\%c");
  });

  it("escapes _ (single-char wildcard — and a legal email character)", () => {
    expect(escapeLikeLiteral("john_doe@x.com")).toBe("john\\_doe@x.com");
  });

  it("escapes backslash FIRST so input can't un-escape our escapes", () => {
    // Raw input \% must become \\\% (literal backslash + literal percent),
    // never \\% (escaped backslash followed by a LIVE wildcard).
    expect(escapeLikeLiteral("\\%")).toBe("\\\\\\%");
  });

  it("passes ordinary emails through unchanged", () => {
    expect(escapeLikeLiteral("joe@biotamfg.co")).toBe("joe@biotamfg.co");
  });

  it("coerces null/undefined to empty string (matches nothing, throws nothing)", () => {
    expect(escapeLikeLiteral(null)).toBe("");
    expect(escapeLikeLiteral(undefined)).toBe("");
  });
});
