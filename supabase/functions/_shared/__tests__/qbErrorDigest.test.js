import { describe, it, expect } from "vitest";
import {
  summarizeQbErrors,
  shouldSendErrorDigest,
  buildQbErrorDigestText,
  buildQbErrorDigestHtml,
  QB_ERROR_DIGEST_THRESHOLD,
} from "../qbErrorDigest.js";

function row(overrides = {}) {
  return {
    shop_owner: "joe@biotamfg.co",
    action: "create_invoice",
    error_message: "boom",
    created_at: "2026-06-09T05:00:00Z",
    status: "error",
    ...overrides,
  };
}

describe("summarizeQbErrors", () => {
  it("returns empty totals for empty / non-array input", () => {
    expect(summarizeQbErrors([]).total).toBe(0);
    expect(summarizeQbErrors(null).total).toBe(0);
    expect(summarizeQbErrors(undefined).total).toBe(0);
    expect(summarizeQbErrors({}).total).toBe(0);
  });

  it("counts total + groups by shop", () => {
    const s = summarizeQbErrors([
      row({ shop_owner: "a@x.com" }),
      row({ shop_owner: "a@x.com" }),
      row({ shop_owner: "b@y.com" }),
    ]);
    expect(s.total).toBe(3);
    expect(s.shopCount).toBe(2);
    const a = s.byShop.find((x) => x.shop_owner === "a@x.com");
    expect(a.count).toBe(2);
  });

  it("sorts shops by count desc, then alphabetically", () => {
    const s = summarizeQbErrors([
      row({ shop_owner: "z@x.com" }),
      row({ shop_owner: "a@x.com" }),
      row({ shop_owner: "a@x.com" }),
      row({ shop_owner: "z@x.com" }),
      row({ shop_owner: "m@x.com" }),
      row({ shop_owner: "m@x.com" }),
    ]);
    // All three shops tied at 2. Alphabetical tie-break.
    expect(s.byShop.map((x) => x.shop_owner)).toEqual([
      "a@x.com",
      "m@x.com",
      "z@x.com",
    ]);
  });

  it("groups by action", () => {
    const s = summarizeQbErrors([
      row({ action: "create_invoice" }),
      row({ action: "create_invoice" }),
      row({ action: "mint_link" }),
    ]);
    expect(s.byAction).toEqual({ create_invoice: 2, mint_link: 1 });
  });

  it("keeps only 3 sample rows per shop, oldest-first by insertion order", () => {
    const samples = Array.from({ length: 5 }, (_, i) => row({
      action: `action_${i}`,
      error_message: `msg_${i}`,
    }));
    const s = summarizeQbErrors(samples);
    expect(s.byShop[0].recentSamples.length).toBe(3);
    expect(s.byShop[0].recentSamples.map((x) => x.action)).toEqual([
      "action_0",
      "action_1",
      "action_2",
    ]);
  });

  it("handles missing shop_owner / action fields by falling back to (unknown)", () => {
    const s = summarizeQbErrors([
      row({ shop_owner: null, action: null }),
    ]);
    expect(s.byShop[0].shop_owner).toBe("(unknown)");
    expect(s.byAction["(unknown)"]).toBe(1);
  });

  it("ignores rows with non-error status", () => {
    const s = summarizeQbErrors([
      row({ status: "success" }),
      row({ status: "skipped" }),
      row({ status: "error" }),
    ]);
    // Only the error row counted; success+skipped filtered out.
    expect(s.byShop[0].count).toBe(1);
  });
});

describe("shouldSendErrorDigest", () => {
  it(`is true when total >= ${QB_ERROR_DIGEST_THRESHOLD}`, () => {
    const high = summarizeQbErrors(Array.from({ length: QB_ERROR_DIGEST_THRESHOLD }, () => row()));
    expect(shouldSendErrorDigest(high)).toBe(true);
  });

  it(`is false when total < ${QB_ERROR_DIGEST_THRESHOLD}`, () => {
    const low = summarizeQbErrors(Array.from({ length: QB_ERROR_DIGEST_THRESHOLD - 1 }, () => row()));
    expect(shouldSendErrorDigest(low)).toBe(false);
  });

  it("is false when summary is null/undefined", () => {
    expect(shouldSendErrorDigest(null)).toBe(false);
    expect(shouldSendErrorDigest(undefined)).toBe(false);
  });
});

describe("buildQbErrorDigestText", () => {
  it("includes total + per-shop + per-action lines", () => {
    const s = summarizeQbErrors([
      row({ shop_owner: "a@x.com", action: "create_invoice" }),
      row({ shop_owner: "a@x.com", action: "mint_link" }),
      row({ shop_owner: "b@y.com", action: "create_invoice" }),
    ]);
    const t = buildQbErrorDigestText(s);
    expect(t).toContain("3 QuickBooks error event(s)");
    expect(t).toContain("2 shop(s)");
    expect(t).toContain("a@x.com (2)");
    expect(t).toContain("b@y.com (1)");
    expect(t).toContain("create_invoice: 2");
    expect(t).toContain("mint_link: 1");
  });

  it("uses the custom window label when provided", () => {
    const s = summarizeQbErrors([row()]);
    expect(buildQbErrorDigestText(s, { windowLabel: "last hour" })).toContain("last hour");
  });

  it("truncates extremely long error messages to keep the digest skimmable", () => {
    const huge = "x".repeat(500);
    const s = summarizeQbErrors([row({ error_message: huge })]);
    const t = buildQbErrorDigestText(s);
    // 160 + a little for the prefix; nowhere near 500.
    expect(t).not.toContain("x".repeat(500));
    expect(t.length).toBeLessThan(1000);
  });
});

describe("buildQbErrorDigestHtml", () => {
  it("escapes HTML in shop_owner and error_message", () => {
    const s = summarizeQbErrors([row({
      shop_owner: "<script>alert(1)</script>",
      error_message: "<img src=x onerror=alert(2)>",
    })]);
    const h = buildQbErrorDigestHtml(s);
    expect(h).not.toContain("<script>");
    expect(h).not.toContain("<img src=x");
    expect(h).toContain("&lt;script&gt;");
  });
});
