import { describe, it, expect } from "vitest";
import { escapeHtml, sanitizeEmailBody, asBareEmail } from "../emailSanitize.js";

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

describe("asBareEmail", () => {
  it("passes a plain valid email through", () => {
    expect(asBareEmail("kato@thunder-house.com")).toBe("kato@thunder-house.com");
  });
  it("strips the broker tenancy sentinel (the Resend-422 bug)", () => {
    expect(asBareEmail("broker:ethan@ttrsupply.com")).toBe("ethan@ttrsupply.com");
  });
  it("rejects non-emails as null instead of poisoning the send", () => {
    expect(asBareEmail("unknown")).toBeNull();
    expect(asBareEmail("")).toBeNull();
    expect(asBareEmail(null)).toBeNull();
    expect(asBareEmail("broker:")).toBeNull();
    expect(asBareEmail("no-at-sign.com")).toBeNull();
  });
  it("trims whitespace", () => {
    expect(asBareEmail("  joe@biotamfg.co  ")).toBe("joe@biotamfg.co");
  });
});
