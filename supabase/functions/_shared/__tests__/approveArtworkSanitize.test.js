// Regression guard for the "raw orders row returned to an anonymous caller"
// leak (F1, 2026-08-31). handleApproveArtwork in createCheckoutSession fetched
// with select("*") and `return { order }` — handing whoever holds the emailed
// approval link (orderId + public_token) the full row: shop_owner,
// public_token, totals, notes, and line items still carrying garmentCost*,
// partner_source (subcontractor email) and _partner_ppp (shop's cost). The
// sibling handleGetOrder sanitized; this handler didn't.
//
// A unit test on sanitizeOrderForCustomer can't catch a handler that never
// CALLS it, so this scans the source: in createCheckoutSession, every
// anonymous handler that returns an order must pass it through
// sanitizeOrderForCustomer. Mirrors shopColumnGuard.test.js.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(
  fileURLToPath(new URL("../../createCheckoutSession/index.ts", import.meta.url)),
  "utf8",
);

describe("createCheckoutSession anonymous order returns are sanitized", () => {
  it("never returns a bare `{ order }` (raw row) to the caller", () => {
    // The raw-return signature the leak had. Only the sanitized form is allowed.
    const bareReturns = [...SRC.matchAll(/return\s*\{\s*order\s*(?:,[^}]*)?\}/g)]
      .map((m) => m[0])
      .filter((s) => !/sanitizeOrderForCustomer/.test(s));
    expect(bareReturns).toEqual([]);
  });

  it("handleApproveArtwork returns through sanitizeOrderForCustomer", () => {
    const start = SRC.indexOf("async function handleApproveArtwork");
    // Up to the next top-level `async function`, or a generous window.
    const nextFn = SRC.indexOf("\nasync function", start + 1);
    const fn = SRC.slice(start, nextFn === -1 ? start + 5000 : nextFn);
    // Its customer-facing return must sanitize.
    expect(/return\s*\{\s*order:\s*sanitizeOrderForCustomer\(/.test(fn)).toBe(true);
  });

  it("the sanitizer is actually imported", () => {
    expect(/import\s*\{[^}]*sanitizeOrderForCustomer[^}]*\}\s*from/.test(SRC)).toBe(true);
  });
});
