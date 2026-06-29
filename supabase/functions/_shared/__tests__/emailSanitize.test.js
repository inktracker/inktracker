import { describe, it, expect } from "vitest";
import { escapeHtml, sanitizeEmailBody } from "../emailSanitize.js";

describe("escapeHtml", () => {
  it("escapes all five HTML-significant chars, incl. quotes (INT-04)", () => {
    expect(escapeHtml(`<img src="x" onerror='y'>&`)).toBe(
      "&lt;img src=&quot;x&quot; onerror=&#39;y&#39;&gt;&amp;",
    );
  });
  it("handles null/undefined/numbers without throwing", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
    expect(escapeHtml(42)).toBe("42");
  });
});

describe("sanitizeEmailBody", () => {
  it("escapes a script/img injection attempt — no raw tag survives", () => {
    const out = sanitizeEmailBody(`Hi <script>alert(1)</script> "ok"`);
    expect(out).not.toMatch(/<script>/);
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("&quot;ok&quot;"); // quotes escaped (the INT-04 gap)
  });
  it("converts newlines to <br> AFTER escaping (our <br> stays literal)", () => {
    const out = sanitizeEmailBody("line1\nline2");
    expect(out).toBe("line1<br>line2");
    expect(out).not.toContain("&lt;br&gt;"); // the <br> we add isn't escaped
  });
  it("empty/falsey body → empty string", () => {
    expect(sanitizeEmailBody("")).toBe("");
    expect(sanitizeEmailBody(null)).toBe("");
    expect(sanitizeEmailBody(undefined)).toBe("");
  });
});
