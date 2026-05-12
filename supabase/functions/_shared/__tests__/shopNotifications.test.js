import { describe, it, expect, vi } from "vitest";
import {
  buildNotificationRow,
  buildQbDriftNotification,
  recordShopNotification,
} from "../shopNotifications.js";

describe("buildNotificationRow — strict input validation", () => {
  const valid = {
    shopOwner: "shop@example.com",
    eventType: "qb_reconciliation_drift",
    severity: "warning",
    title: "Test title",
  };

  it("returns a well-formed row for the minimum valid input", () => {
    const row = buildNotificationRow(valid);
    expect(row.shop_owner).toBe("shop@example.com");
    expect(row.event_type).toBe("qb_reconciliation_drift");
    expect(row.severity).toBe("warning");
    expect(row.title).toBe("Test title");
    expect(row.body).toBe("");          // default
    expect(row.metadata).toEqual({});   // default
  });

  it("includes optional related_entity and related_id when provided", () => {
    const row = buildNotificationRow({ ...valid, relatedEntity: "quote", relatedId: "q-123" });
    expect(row.related_entity).toBe("quote");
    expect(row.related_id).toBe("q-123");
  });

  it("preserves a metadata object when provided", () => {
    const row = buildNotificationRow({ ...valid, metadata: { foo: "bar", n: 1 } });
    expect(row.metadata).toEqual({ foo: "bar", n: 1 });
  });

  it("falls back to {} for non-object metadata", () => {
    expect(buildNotificationRow({ ...valid, metadata: "not an object" }).metadata).toEqual({});
    expect(buildNotificationRow({ ...valid, metadata: null }).metadata).toEqual({});
    expect(buildNotificationRow({ ...valid, metadata: undefined }).metadata).toEqual({});
  });

  it("throws when input is not an object", () => {
    expect(() => buildNotificationRow(null)).toThrow(/input required/);
    expect(() => buildNotificationRow(undefined)).toThrow(/input required/);
    expect(() => buildNotificationRow("string")).toThrow(/input required/);
  });

  it("throws when shopOwner is missing/empty/non-string", () => {
    expect(() => buildNotificationRow({ ...valid, shopOwner: "" })).toThrow(/shopOwner required/);
    expect(() => buildNotificationRow({ ...valid, shopOwner: undefined })).toThrow(/shopOwner required/);
    expect(() => buildNotificationRow({ ...valid, shopOwner: 42 })).toThrow(/shopOwner required/);
  });

  it("throws when eventType is missing/empty/non-string", () => {
    expect(() => buildNotificationRow({ ...valid, eventType: "" })).toThrow(/eventType required/);
    expect(() => buildNotificationRow({ ...valid, eventType: undefined })).toThrow(/eventType required/);
  });

  it("throws when severity isn't one of info/warning/alert (matches the DB CHECK constraint)", () => {
    expect(() => buildNotificationRow({ ...valid, severity: "critical" })).toThrow(/severity/);
    expect(() => buildNotificationRow({ ...valid, severity: "" })).toThrow(/severity/);
    expect(() => buildNotificationRow({ ...valid, severity: undefined })).toThrow(/severity/);
  });

  it("throws when title is missing/empty/non-string", () => {
    expect(() => buildNotificationRow({ ...valid, title: "" })).toThrow(/title required/);
    expect(() => buildNotificationRow({ ...valid, title: undefined })).toThrow(/title required/);
  });

  it("never produces a row with NaN/null shop_owner — guard against silent corruption", () => {
    // Belt-and-suspenders: even if a caller manages to bypass the
    // string check, the row must be schema-clean.
    expect(() => buildNotificationRow({ ...valid, shopOwner: NaN })).toThrow();
  });
});

describe("buildQbDriftNotification — formats the user-facing message", () => {
  const baseReconciliation = {
    severity: "drift",
    issues: ["Line-amount drift 2.50 exceeds tolerance 0.01 (sent subtotal 100.00, QB subtotal 102.50)"],
    sentSubtotal: 100,
    qbSubtotal: 102.5,
    subtotalDrift: 2.5,
    sentTotal: 108.75,
    qbTotal: 111.25,
    totalDrift: 2.5,
    sentTax: 8.75,
    qbTax: 8.75,
    taxDrift: 0,
  };

  it("produces a message that includes both totals and the drift amount", () => {
    const row = buildQbDriftNotification({
      shopOwner: "shop@example.com",
      quoteId: "Q-2026-115",
      quoteRowId: "uuid-quote-115",
      qbInvoiceId: "qb-inv-42",
      reconciliation: baseReconciliation,
    });
    expect(row.title).toBe("QuickBooks invoice doesn't match");
    expect(row.body).toContain("Q-2026-115");
    expect(row.body).toContain("$108.75");
    expect(row.body).toContain("$111.25");
    expect(row.body).toContain("+$2.50");
    expect(row.body).toContain("This should never happen");
  });

  it("uses a minus sign for negative drift (QB lower than expected)", () => {
    const row = buildQbDriftNotification({
      shopOwner: "shop@example.com",
      quoteId: "Q-001",
      quoteRowId: "uuid-1",
      reconciliation: { ...baseReconciliation, sentTotal: 100, qbTotal: 95, totalDrift: -5 },
    });
    expect(row.body).toContain("-$5.00");
  });

  it("attaches the full reconciliation result to metadata for later analysis", () => {
    const row = buildQbDriftNotification({
      shopOwner: "shop@example.com",
      quoteId: "Q-115",
      quoteRowId: "uuid-115",
      qbInvoiceId: "qb-42",
      reconciliation: baseReconciliation,
    });
    expect(row.metadata).toMatchObject({
      quote_id: "Q-115",
      qb_invoice_id: "qb-42",
      sent_subtotal: 100,
      qb_subtotal: 102.5,
      subtotal_drift: 2.5,
      sent_total: 108.75,
      qb_total: 111.25,
      total_drift: 2.5,
    });
    expect(row.metadata.issues).toHaveLength(1);
  });

  it("links the notification to the quote (entity + id)", () => {
    const row = buildQbDriftNotification({
      shopOwner: "shop@example.com",
      quoteId: "Q-115",
      quoteRowId: "uuid-115",
      reconciliation: baseReconciliation,
    });
    expect(row.related_entity).toBe("quote");
    expect(row.related_id).toBe("uuid-115");
  });

  it("uses severity='alert' when reconciliation severity is 'fatal'", () => {
    const row = buildQbDriftNotification({
      shopOwner: "shop@example.com",
      quoteId: "Q-1",
      quoteRowId: "uuid-1",
      reconciliation: { ...baseReconciliation, severity: "fatal" },
    });
    expect(row.severity).toBe("alert");
  });

  it("uses severity='warning' when reconciliation severity is 'drift'", () => {
    const row = buildQbDriftNotification({
      shopOwner: "shop@example.com",
      quoteId: "Q-1",
      quoteRowId: "uuid-1",
      reconciliation: { ...baseReconciliation, severity: "drift" },
    });
    expect(row.severity).toBe("warning");
  });

  it("handles non-finite money values without producing NaN in the body", () => {
    const row = buildQbDriftNotification({
      shopOwner: "shop@example.com",
      quoteId: "Q-1",
      quoteRowId: "uuid-1",
      reconciliation: { ...baseReconciliation, sentTotal: NaN, qbTotal: NaN, totalDrift: NaN },
    });
    expect(row.body).not.toMatch(/NaN/);
  });

  it("throws when reconciliation is missing", () => {
    expect(() =>
      buildQbDriftNotification({
        shopOwner: "shop@example.com",
        quoteId: "Q-1",
        quoteRowId: "uuid-1",
      }),
    ).toThrow(/reconciliation required/);
  });
});

describe("recordShopNotification — never throws even when DB fails", () => {
  function mockSupabase({ insertResult, throws }) {
    return {
      from(table) {
        return {
          insert: vi.fn(async (row) => {
            if (throws) throw new Error("connection lost");
            return insertResult ?? { data: row, error: null };
          }),
        };
      },
    };
  }

  it("returns ok=true on a clean insert", async () => {
    const sb = mockSupabase({});
    const r = await recordShopNotification(sb, {
      shopOwner: "shop@example.com",
      eventType: "qb_reconciliation_drift",
      severity: "warning",
      title: "x",
    });
    expect(r.ok).toBe(true);
  });

  it("returns ok=false when validation fails — does not throw", async () => {
    const sb = mockSupabase({});
    const r = await recordShopNotification(sb, { shopOwner: "" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/eventType|shopOwner|severity|title/);
  });

  it("returns ok=false when the DB returns an error — does not throw", async () => {
    const sb = mockSupabase({ insertResult: { data: null, error: { message: "rls denied" } } });
    const r = await recordShopNotification(sb, {
      shopOwner: "shop@example.com",
      eventType: "x",
      severity: "info",
      title: "y",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("rls denied");
  });

  it("returns ok=false when the insert call throws — does not propagate", async () => {
    // The whole point: a network failure on a notification must NEVER
    // cause the originating QB sync to error out.
    const sb = mockSupabase({ throws: true });
    const r = await recordShopNotification(sb, {
      shopOwner: "shop@example.com",
      eventType: "x",
      severity: "info",
      title: "y",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("connection lost");
  });
});
