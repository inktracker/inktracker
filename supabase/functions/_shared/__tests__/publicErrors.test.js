import { describe, it, expect } from "vitest";
import {
  toPublicMessage,
  publicErrorPage,
  isBrowserNavigation,
  PUBLIC_FALLBACK,
} from "../publicErrors.ts";

describe("toPublicMessage — never leaks raw text to a customer", () => {
  it("replaces raw Postgres errors with the friendly generic", () => {
    expect(toPublicMessage(new Error('duplicate key value violates unique constraint "quotes_pkey"')))
      .toBe(PUBLIC_FALLBACK);
    expect(toPublicMessage(new Error('column "foo" does not exist'))).toBe(PUBLIC_FALLBACK);
  });

  it("replaces raw Stripe/SDK errors with the friendly generic", () => {
    expect(toPublicMessage(new Error("No such customer: 'cus_123'"))).toBe(PUBLIC_FALLBACK);
  });

  it("passes through messages we explicitly wrote for customers", () => {
    expect(toPublicMessage("Quote not found.")).toBe("Quote not found.");
    expect(toPublicMessage(new Error("Order not found."))).toBe("Order not found.");
  });

  it("rewrites terse internal RPC messages into customer copy", () => {
    expect(toPublicMessage("rate limit exceeded — try again later")).toMatch(/wait a minute/i);
    expect(toPublicMessage("payload too large")).toMatch(/too large/i);
    expect(toPublicMessage("unknown shop")).toMatch(/contact the shop/i);
    expect(toPublicMessage("request rejected")).toMatch(/refresh the page/i);
    // None of the rewrites may echo the raw internal wording.
    expect(toPublicMessage("unknown shop")).not.toContain("unknown shop");
  });

  it("handles non-Error throws and empty input", () => {
    expect(toPublicMessage(null)).toBe(PUBLIC_FALLBACK);
    expect(toPublicMessage(undefined)).toBe(PUBLIC_FALLBACK);
    expect(toPublicMessage({})).toBe(PUBLIC_FALLBACK);
    expect(toPublicMessage("")).toBe(PUBLIC_FALLBACK);
  });

  it("never returns text containing raw-error signatures", () => {
    const nasty = [
      '{"statusCode":"404","error":"Bucket not found"}',
      "TypeError: Cannot read properties of undefined (reading 'id')",
      "PGRST116: JSON object requested",
      "new row violates row-level security policy for table \"quotes\"",
    ];
    for (const raw of nasty) {
      const out = toPublicMessage(new Error(raw));
      expect(out).toBe(PUBLIC_FALLBACK);
      expect(out).not.toContain("statusCode");
      expect(out).not.toContain("Bucket not found");
      expect(out).not.toContain("TypeError");
      expect(out).not.toContain("PGRST");
    }
  });

  it("accepts a custom fallback", () => {
    expect(toPublicMessage(new Error("boom"), "Custom friendly copy.")).toBe("Custom friendly copy.");
  });
});

describe("publicErrorPage", () => {
  it("returns styled HTML with the requested status", async () => {
    const res = publicErrorPage(404);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const body = await res.text();
    expect(body).toMatch(/<html/i);
    expect(body).toMatch(/isn.t available/i);
  });

  it("escapes interpolated text so copy can't inject markup", async () => {
    const res = publicErrorPage(404, "<script>alert(1)</script>", "a & b");
    const body = await res.text();
    expect(body).not.toContain("<script>alert(1)</script>");
    expect(body).toContain("&lt;script&gt;");
    expect(body).toContain("a &amp; b");
  });

  it("is not indexable and not cached", async () => {
    const body = await publicErrorPage(404).text();
    expect(body).toContain('name="robots"');
    expect(publicErrorPage(404).headers.get("cache-control")).toBe("no-store");
  });
});

describe("isBrowserNavigation", () => {
  const req = (headers) => new Request("https://x/y", { headers });

  it("detects a top-level navigation via fetch metadata", () => {
    expect(isBrowserNavigation(req({ "sec-fetch-mode": "navigate" }))).toBe(true);
    expect(isBrowserNavigation(req({ "sec-fetch-dest": "document" }))).toBe(true);
  });

  it("treats subresource fetches as NOT navigations", () => {
    expect(isBrowserNavigation(req({ "sec-fetch-mode": "no-cors", "sec-fetch-dest": "image" }))).toBe(false);
    // An <img> request often sends Accept including text/html-ish lists; fetch
    // metadata must win so we don't return an HTML body to an image tag.
    expect(isBrowserNavigation(req({
      "sec-fetch-dest": "image",
      accept: "text/html,image/avif,image/webp,*/*",
    }))).toBe(false);
  });

  it("falls back to Accept when fetch metadata is absent", () => {
    expect(isBrowserNavigation(req({ accept: "text/html,application/xhtml+xml" }))).toBe(true);
    expect(isBrowserNavigation(req({ accept: "image/*" }))).toBe(false);
    expect(isBrowserNavigation(req({}))).toBe(false);
  });
});
