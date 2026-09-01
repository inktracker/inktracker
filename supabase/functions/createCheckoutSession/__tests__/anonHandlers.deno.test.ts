// Behavioral tests for the anon-facing read handlers — the REAL handler
// bodies run against a fake supabase client (see _shared/testing/
// fakeSupabase.ts). This is the wiring layer where the 2026-08 CRITICAL
// approveArtwork leak lived: the sanitizers were 100% unit-tested, the
// handler that should have called them wasn't. Run: `npm run test:edge`.
//
// Deno.serve is stubbed BEFORE the dynamic import so importing the module
// never starts a listener; the router's own 2-arg calls are untouched.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { fakeSupabase } from "../../_shared/testing/fakeSupabase.ts";

const realServe = Deno.serve;
(Deno as unknown as { serve: unknown }).serve = () => ({});
const { handleGetOrder, handleGetQuote } = await import("../index.ts");
(Deno as unknown as { serve: unknown }).serve = realServe;

const ORDER_UUID = "11111111-2222-4333-8444-555555555555";

function db() {
  return fakeSupabase({
    orders: [{
      id: ORDER_UUID,
      order_id: "ORD-2026-TEST1",
      status: "Printing",
      job_title: "Fall Hoodies",
      date: "2026-08-01",
      due_date: "2026-09-15",
      customer_name: "Jane Customer",
      public_token: "good-token",
      line_items: [{ product_title: "Hoodie", sizes: { M: 10 }, garmentCost: 9.5, partner_source: "subcontractor@example.com", _partner_ppp: 6.25 }],
      // Server-side-only fields that must never reach the anon page:
      total: 1234.56,
      notes: "internal: rush job, comp the setup",
      assigned_operator: "Joe Grennan",
      shop_owner: "owner@example.com",
      wholesale_total: 900,
    }],
    quotes: [{
      id: "q-1",
      quote_id: "Q-2026-TEST1",
      status: "Sent",
      customer_name: "Jane Customer",
      public_token: "good-token",
      shop_owner: "owner@example.com",
      line_items: [],
      total: 500,
      tax_rate: 0,
    }],
    shops: [{
      owner_email: "owner@example.com",
      shop_name: "Test Shop",
      stripe_account_id: "acct_secret",
      stripe_account_status: "active",
    }],
    profiles: [{ email: "owner@example.com", shop_name: "Test Shop", logo_url: null, phone: "555", address: null, city: null, state: null, zip: null, website: null }],
    customers: [],
  });
}

Deno.test("handleGetOrder rejects a missing token as not-found (no existence leak)", async () => {
  const res = await handleGetOrder(ORDER_UUID, undefined, db());
  assertEquals(res, { error: "Order not found." });
});

Deno.test("handleGetOrder rejects a wrong token as not-found", async () => {
  const res = await handleGetOrder(ORDER_UUID, "wrong-token", db());
  assertEquals(res, { error: "Order not found." });
});

Deno.test("handleGetOrder returns only the sanitized allowlist — never internals", async () => {
  const res = await handleGetOrder(ORDER_UUID, "good-token", db());
  assert(res.order, "expected an order payload");
  assertEquals(res.order.order_id, "ORD-2026-TEST1");
  assertEquals(res.order.status, "Printing");
  // The leak class: any of these appearing means a raw row escaped.
  for (const k of ["public_token", "total", "notes", "assigned_operator", "wholesale_total"]) {
    assertEquals(k in res.order, false, `sanitized order must not carry '${k}'`);
  }
  // Line items are scrubbed of the cost family and partner (blind-handoff) keys.
  for (const k of ["garmentCost", "partner_source", "_partner_ppp"]) {
    assertEquals(k in (res.order.line_items?.[0] ?? {}), false, `line item must not carry '${k}'`);
  }
  // Shop payload: Stripe identifiers and owner email stay server-side.
  for (const k of ["stripe_account_id", "stripe_account_status", "owner_email"]) {
    assertEquals(k in (res.shop ?? {}), false, `shop payload must not carry '${k}'`);
  }
});

Deno.test("handleGetOrder resolves by order_id string as well as uuid", async () => {
  const res = await handleGetOrder("ORD-2026-TEST1", "good-token", db());
  assertEquals(res.order?.order_id, "ORD-2026-TEST1");
});

Deno.test("handleGetQuote gates on token and strips public_token from the payload", async () => {
  const denied = await handleGetQuote("q-1", "wrong-token", db());
  assertEquals(denied, { error: "Quote not found." });

  const res = await handleGetQuote("q-1", "good-token", db());
  assert(res.quote, "expected a quote payload");
  assertEquals(res.quote.quote_id, "Q-2026-TEST1");
  assertEquals("public_token" in res.quote, false, "quote must not echo its own token");
  for (const k of ["stripe_account_id", "owner_email"]) {
    assertEquals(k in (res.shop ?? {}), false, `shop payload must not carry '${k}'`);
  }
});
