import { describe, it, expect, vi } from "vitest";
import {
  extractStripeEventId,
  extractQbEventId,
  extractBillingEventId,
  claimWebhookEvent,
} from "../webhookIdempotency.js";

// ─────────────────────────────────────────────────────────────────────
// extractStripeEventId
// ─────────────────────────────────────────────────────────────────────

describe("extractStripeEventId (WI1–WI4)", () => {
  it("WI1 — returns event.id for a normal Stripe event", () => {
    expect(extractStripeEventId({ id: "evt_123abc" })).toBe("evt_123abc");
  });

  it("WI2 — returns null when id is missing", () => {
    expect(extractStripeEventId({})).toBe(null);
    expect(extractStripeEventId(null)).toBe(null);
    expect(extractStripeEventId(undefined)).toBe(null);
  });

  it("WI3 — returns null when id is empty string (not a usable dedup key)", () => {
    expect(extractStripeEventId({ id: "" })).toBe(null);
  });

  it("WI4 — returns null when id is non-string", () => {
    expect(extractStripeEventId({ id: 12345 })).toBe(null);
    expect(extractStripeEventId({ id: { nested: "x" } })).toBe(null);
  });
});

// ─────────────────────────────────────────────────────────────────────
// extractQbEventId — synthesized key from notifications
// ─────────────────────────────────────────────────────────────────────

describe("extractQbEventId (WQ1–WQ5)", () => {
  it("WQ1 — single notification + single entity → stable key", () => {
    const payload = {
      eventNotifications: [{
        realmId: "12345",
        dataChangeEvent: {
          entities: [{ name: "Invoice", id: "999", lastUpdated: "2026-05-15T10:00:00Z" }],
        },
      }],
    };
    expect(extractQbEventId(payload))
      .toBe("Invoice:999:2026-05-15T10:00:00Z|r:12345");
  });

  it("WQ2 — same payload, entities in different order → SAME key (sort-normalized)", () => {
    // QB sometimes reorders entity arrays between deliveries.
    // The dedup key must be order-invariant or we'd over-process.
    const a = {
      eventNotifications: [{
        realmId: "1",
        dataChangeEvent: { entities: [
          { name: "Invoice", id: "A", lastUpdated: "2026-05-15T10:00:00Z" },
          { name: "Invoice", id: "B", lastUpdated: "2026-05-15T10:01:00Z" },
        ]},
      }],
    };
    const b = {
      eventNotifications: [{
        realmId: "1",
        dataChangeEvent: { entities: [
          { name: "Invoice", id: "B", lastUpdated: "2026-05-15T10:01:00Z" },
          { name: "Invoice", id: "A", lastUpdated: "2026-05-15T10:00:00Z" },
        ]},
      }],
    };
    expect(extractQbEventId(a)).toBe(extractQbEventId(b));
  });

  it("WQ3 — different lastUpdated → DIFFERENT keys (real event)", () => {
    // The whole point: actual new events must dedup uniquely.
    const a = {
      eventNotifications: [{
        realmId: "1",
        dataChangeEvent: { entities: [
          { name: "Invoice", id: "X", lastUpdated: "2026-05-15T10:00:00Z" },
        ]},
      }],
    };
    const b = {
      eventNotifications: [{
        realmId: "1",
        dataChangeEvent: { entities: [
          { name: "Invoice", id: "X", lastUpdated: "2026-05-15T10:05:00Z" },
        ]},
      }],
    };
    expect(extractQbEventId(a)).not.toBe(extractQbEventId(b));
  });

  it("WQ4 — empty/missing notifications → null", () => {
    expect(extractQbEventId({})).toBe(null);
    expect(extractQbEventId({ eventNotifications: [] })).toBe(null);
    expect(extractQbEventId(null)).toBe(null);
  });

  it("WQ5 — missing realmId on a notification → that notification skipped, others still count", () => {
    const payload = {
      eventNotifications: [
        { /* no realmId */ dataChangeEvent: { entities: [{ name: "x", id: "1" }] } },
        { realmId: "12345", dataChangeEvent: { entities: [{ name: "Invoice", id: "9", lastUpdated: "t" }] } },
      ],
    };
    const id = extractQbEventId(payload);
    expect(id).not.toBe(null);
    expect(id).toContain("r:12345");
  });
});

// ─────────────────────────────────────────────────────────────────────
// extractBillingEventId
// ─────────────────────────────────────────────────────────────────────

describe("extractBillingEventId", () => {
  it("WB1 — billing webhook is a Stripe webhook; uses Stripe id", () => {
    expect(extractBillingEventId({ id: "evt_sub_456" })).toBe("evt_sub_456");
    expect(extractBillingEventId({})).toBe(null);
  });
});

// ─────────────────────────────────────────────────────────────────────
// claimWebhookEvent — atomic INSERT-or-detect-duplicate
// ─────────────────────────────────────────────────────────────────────

describe("claimWebhookEvent (CW1–CW6)", () => {
  function mockSupabase(insertResult) {
    return {
      from() {
        return {
          insert: vi.fn().mockResolvedValue(insertResult),
        };
      },
    };
  }

  it("CW1 — first-time event: insert succeeds, returns TRUE (caller processes)", async () => {
    const supabase = mockSupabase({ error: null, count: 1 });
    const result = await claimWebhookEvent(supabase, "stripe", "evt_new");
    expect(result).toBe(true);
  });

  it("CW2 — duplicate event: unique-violation (23505), returns FALSE (caller skips)", async () => {
    const supabase = mockSupabase({
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
      count: 0,
    });
    const result = await claimWebhookEvent(supabase, "stripe", "evt_dup");
    expect(result).toBe(false);
  });

  it("CW3 — unexpected DB error: returns FALSE (conservative skip)", async () => {
    // Prefer to skip a possibly-real event over running it twice.
    // A DB outage isn't a license to fan out double-emails.
    const supabase = mockSupabase({
      error: { code: "08006", message: "connection failure" },
      count: 0,
    });
    const result = await claimWebhookEvent(supabase, "stripe", "evt_anything");
    expect(result).toBe(false);
  });

  it("CW4 — supabase throws (network): returns FALSE (caught, conservative)", async () => {
    const supabase = {
      from() {
        return {
          insert: vi.fn().mockRejectedValue(new Error("ECONNRESET")),
        };
      },
    };
    const result = await claimWebhookEvent(supabase, "stripe", "evt_x");
    expect(result).toBe(false);
  });

  it("CW5 — eventId missing: returns TRUE (no dedup possible; one-shot is better than zero)", async () => {
    // QB payloads can occasionally be un-keyable (we synthesized
    // null from missing entities). Losing the event entirely is
    // worse than running it once.
    const supabase = mockSupabase({ error: null, count: 1 });
    // null/empty bypasses the insert entirely
    expect(await claimWebhookEvent(supabase, "qb", null)).toBe(true);
    expect(await claimWebhookEvent(supabase, "qb", "")).toBe(true);
  });

  it("CW6 — insert is called with (source, event_id, payload) — wire contract", async () => {
    const insertSpy = vi.fn().mockResolvedValue({ error: null, count: 1 });
    const supabase = {
      from(table) {
        expect(table).toBe("processed_webhook_events");
        return { insert: insertSpy };
      },
    };
    await claimWebhookEvent(supabase, "stripe", "evt_123", { foo: "bar" });
    expect(insertSpy).toHaveBeenCalledWith(
      { source: "stripe", event_id: "evt_123", payload: { foo: "bar" } },
      { count: "exact" },
    );
  });
});
