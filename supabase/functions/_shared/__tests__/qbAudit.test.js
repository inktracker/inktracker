import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildStartedRow,
  buildCompletionPatch,
  buildOneShotRow,
  redactForAudit,
  logEventStarted,
  logEventCompleted,
  logEvent,
  withQbAudit,
} from "../qbAudit.js";

// ─────────────────────────────────────────────────────────────────────
// Pure builders
// ─────────────────────────────────────────────────────────────────────

describe("buildStartedRow (BSR)", () => {
  it("BSR1 — defaults direction to outbound and status to started", () => {
    const row = buildStartedRow({
      shop_owner: "shop@x.com",
      action: "create_invoice",
    });
    expect(row.direction).toBe("outbound");
    expect(row.status).toBe("started");
    expect(row.shop_owner).toBe("shop@x.com");
    expect(row.action).toBe("create_invoice");
  });

  it("BSR2 — passes through all optional ids", () => {
    const row = buildStartedRow({
      shop_owner: "x",
      action: "a",
      quote_id: "q1",
      invoice_id: "i1",
      qb_invoice_id: "999",
      qb_customer_id: "42",
      idempotency_key: "k1",
      direction: "inbound",
      request_body: { hello: "world" },
    });
    expect(row).toMatchObject({
      quote_id: "q1",
      invoice_id: "i1",
      qb_invoice_id: "999",
      qb_customer_id: "42",
      idempotency_key: "k1",
      direction: "inbound",
      request_body: { hello: "world" },
    });
  });

  it("BSR3 — null-fills missing optional fields (not undefined — JSONB cols reject undefined)", () => {
    const row = buildStartedRow({ shop_owner: "x", action: "a" });
    expect(row.quote_id).toBe(null);
    expect(row.invoice_id).toBe(null);
    expect(row.qb_invoice_id).toBe(null);
    expect(row.qb_customer_id).toBe(null);
    expect(row.idempotency_key).toBe(null);
    expect(row.request_body).toBe(null);
  });
});

describe("buildCompletionPatch (BCP)", () => {
  it("BCP1 — minimal success", () => {
    const patch = buildCompletionPatch({ status: "success" });
    expect(patch.status).toBe("success");
    expect(patch.response_body).toBe(null);
    expect(patch.error_message).toBe(null);
  });

  it("BCP2 — includes qb ids when known after the call", () => {
    const patch = buildCompletionPatch({
      status: "success",
      response_body: { ok: true },
      qb_invoice_id: "1234",
      qb_customer_id: "9",
      duration_ms: 412,
    });
    expect(patch).toMatchObject({
      response_body: { ok: true },
      qb_invoice_id: "1234",
      qb_customer_id: "9",
      duration_ms: 412,
    });
  });

  it("BCP3 — error_message present on status='error'", () => {
    const patch = buildCompletionPatch({ status: "error", error_message: "boom" });
    expect(patch.status).toBe("error");
    expect(patch.error_message).toBe("boom");
  });
});

describe("buildOneShotRow (BOR)", () => {
  it("BOR1 — defaults direction to inbound (one-shot is typically a webhook)", () => {
    const row = buildOneShotRow({
      shop_owner: "x",
      action: "webhook_received",
      status: "success",
    });
    expect(row.direction).toBe("inbound");
    expect(row.status).toBe("success");
  });
});

describe("redactForAudit (RA)", () => {
  it("RA1 — passes small payloads through unchanged", () => {
    const small = { qbInvoiceId: "1234", paymentLink: "https://qb.../link" };
    expect(redactForAudit(small)).toBe(small);
  });

  it("RA2 — null/undefined → null (jsonb-friendly)", () => {
    expect(redactForAudit(null)).toBe(null);
    expect(redactForAudit(undefined)).toBe(null);
  });

  it("RA3 — truncates payloads over 32KB to a preview marker", () => {
    const big = { lines: Array(5000).fill({ description: "x".repeat(200) }) };
    const out = redactForAudit(big);
    expect(out.__truncated).toBe(true);
    expect(out.__original_size).toBeGreaterThan(32 * 1024);
    expect(typeof out.preview).toBe("string");
    expect(out.preview.length).toBeLessThanOrEqual(32 * 1024);
  });

  it("RA4 — non-serializable values caught", () => {
    const circ = {};
    circ.self = circ;
    const out = redactForAudit(circ);
    expect(out).toEqual({ __unserializable: true });
  });
});

// ─────────────────────────────────────────────────────────────────────
// DB-touching helpers (mocked supabase)
// ─────────────────────────────────────────────────────────────────────

function makeSupabase(behavior = {}) {
  // behavior.insertResult / insertSelect / updateResult control returns.
  const calls = { insert: [], update: [] };
  const sb = {
    from(table) {
      return {
        insert(row) {
          calls.insert.push({ table, row });
          if (behavior.insertSelect) {
            return {
              select() {
                return {
                  single: vi.fn().mockResolvedValue(behavior.insertSelect),
                };
              },
            };
          }
          return Promise.resolve(behavior.insertResult ?? { error: null });
        },
        update(patch) {
          calls.update.push({ table, patch });
          return {
            eq: vi.fn().mockResolvedValue(behavior.updateResult ?? { error: null }),
          };
        },
      };
    },
  };
  return { sb, calls };
}

describe("logEventStarted (LES)", () => {
  it("LES1 — refuses when shop_owner or action is missing (no DB call)", async () => {
    const { sb, calls } = makeSupabase();
    expect(await logEventStarted(sb, { action: "a" })).toBe(null);
    expect(await logEventStarted(sb, { shop_owner: "x" })).toBe(null);
    expect(calls.insert.length).toBe(0);
  });

  it("LES2 — returns inserted row id on success", async () => {
    const { sb } = makeSupabase({
      insertSelect: { data: { id: "evt-abc" }, error: null },
    });
    const id = await logEventStarted(sb, { shop_owner: "s", action: "create_invoice" });
    expect(id).toBe("evt-abc");
  });

  it("LES3 — DB error → returns null (best-effort, caller continues)", async () => {
    const { sb } = makeSupabase({
      insertSelect: { data: null, error: { message: "boom" } },
    });
    const id = await logEventStarted(sb, { shop_owner: "s", action: "a" });
    expect(id).toBe(null);
  });

  it("LES4 — supabase throws → returns null", async () => {
    const sb = {
      from() {
        return {
          insert: () => { throw new Error("network"); },
        };
      },
    };
    const id = await logEventStarted(sb, { shop_owner: "s", action: "a" });
    expect(id).toBe(null);
  });
});

describe("logEventCompleted (LEC)", () => {
  it("LEC1 — null eventId is a no-op", async () => {
    const { sb, calls } = makeSupabase();
    await logEventCompleted(sb, null, { status: "success" });
    expect(calls.update.length).toBe(0);
  });

  it("LEC2 — issues an UPDATE on qb_event_log when eventId present", async () => {
    const { sb, calls } = makeSupabase();
    await logEventCompleted(sb, "evt-1", { status: "success", response_body: { ok: 1 } });
    expect(calls.update.length).toBe(1);
    expect(calls.update[0].table).toBe("qb_event_log");
    expect(calls.update[0].patch.status).toBe("success");
  });
});

describe("withQbAudit (WA)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("WA1 — runs fn, writes started + completed(success), returns fn's result", async () => {
    const { sb, calls } = makeSupabase({
      insertSelect: { data: { id: "evt-1" }, error: null },
    });
    const result = await withQbAudit(sb, {
      shop_owner: "x", action: "create_invoice", quote_id: "q1",
    }, async () => ({ qbInvoiceId: "9000", paymentLink: "https://l" }));
    expect(result).toEqual({ qbInvoiceId: "9000", paymentLink: "https://l" });
    expect(calls.insert.length).toBe(1);
    expect(calls.update.length).toBe(1);
    expect(calls.update[0].patch.status).toBe("success");
    expect(calls.update[0].patch.qb_invoice_id).toBe("9000");
  });

  it("WA2 — fn throws → completed(error) row written, original error rethrown", async () => {
    const { sb, calls } = makeSupabase({
      insertSelect: { data: { id: "evt-2" }, error: null },
    });
    await expect(
      withQbAudit(sb, { shop_owner: "x", action: "a" }, async () => {
        throw new Error("QB 500");
      }),
    ).rejects.toThrow("QB 500");
    expect(calls.update.length).toBe(1);
    expect(calls.update[0].patch.status).toBe("error");
    expect(calls.update[0].patch.error_message).toBe("QB 500");
  });

  it("WA3 — duration_ms is recorded on completion", async () => {
    const { sb, calls } = makeSupabase({
      insertSelect: { data: { id: "evt-3" }, error: null },
    });
    await withQbAudit(sb, { shop_owner: "x", action: "a" }, async () => {
      await new Promise((r) => setTimeout(r, 25));
      return { ok: true };
    });
    expect(calls.update[0].patch.duration_ms).toBeGreaterThanOrEqual(20);
  });

  it("WA4 — even if started write fails (null eventId), fn still runs and result is returned", async () => {
    const { sb } = makeSupabase({
      insertSelect: { data: null, error: { message: "boom" } },
    });
    const result = await withQbAudit(
      sb,
      { shop_owner: "x", action: "a" },
      async () => ({ qbInvoiceId: "z" }),
    );
    expect(result).toEqual({ qbInvoiceId: "z" });
  });
});

describe("logEvent (LE)", () => {
  it("LE1 — inserts a one-shot row with all fields populated", async () => {
    const { sb, calls } = makeSupabase();
    await logEvent(sb, {
      shop_owner: "x",
      action: "webhook_received",
      status: "success",
      response_body: { converted: true },
      qb_invoice_id: "111",
    });
    expect(calls.insert[0].table).toBe("qb_event_log");
    expect(calls.insert[0].row.status).toBe("success");
    expect(calls.insert[0].row.direction).toBe("inbound");
    expect(calls.insert[0].row.qb_invoice_id).toBe("111");
  });

  it("LE2 — refuses when status is missing", async () => {
    const { sb, calls } = makeSupabase();
    await logEvent(sb, { shop_owner: "x", action: "a" });
    expect(calls.insert.length).toBe(0);
  });
});
