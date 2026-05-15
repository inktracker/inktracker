import { describe, it, expect, vi } from "vitest";
import { buildWizardQuotePayload, submitWizardQuote } from "../wizardSubmit.js";

describe("buildWizardQuotePayload", () => {
  const wizardQuote = {
    quote_id: "Q-2026-ABCDE",
    customer_name: "Acme Co",
    customer_email: "buyer@acme.test",
    phone: "555-0100",
    company: "Acme",
    date: "2026-05-15",
    due_date: "2026-06-15",
    notes: "Rush job",
    rush_rate: 0.20,
    extras: { colorMatch: false },
    line_items: [{ id: "li-1", style: "Heavy Tee", sizes: { M: 24 } }],
    selected_artwork: [{ id: "a1", name: "front.png", url: "https://..." }],
    tax_exempt: false,
    tax_id: "",
    discount: 0,
    tax_rate: 0,
    deposit_pct: 0,
    deposit_paid: false,
  };

  it("sets shop_owner from the function argument, not the payload", () => {
    // Critical: the wizard URL carries the shop_owner (?shop=...) but a
    // hostile client could try to set it in the payload too. The function
    // arg is authoritative.
    const out = buildWizardQuotePayload(
      { ...wizardQuote, shop_owner: "attacker@evil.test" },
      "shop@example.test",
    );
    expect(out.shop_owner).toBe("shop@example.test");
  });

  it("throws when shopOwner is missing or empty", () => {
    expect(() => buildWizardQuotePayload(wizardQuote, undefined)).toThrow("shopOwner is required");
    expect(() => buildWizardQuotePayload(wizardQuote, null)).toThrow("shopOwner is required");
    expect(() => buildWizardQuotePayload(wizardQuote, "")).toThrow("shopOwner is required");
    expect(() => buildWizardQuotePayload(wizardQuote, "   ")).toThrow("shopOwner is required");
  });

  it("trims whitespace on shop_owner so a hand-typed url query param doesn't bite", () => {
    const out = buildWizardQuotePayload(wizardQuote, "  shop@example.test  ");
    expect(out.shop_owner).toBe("shop@example.test");
  });

  it("forces status = 'Pending' regardless of what caller sent", () => {
    // Defense-in-depth: SQL function also forces this, but stripping
    // it client-side means the wire payload doesn't even claim it.
    const out = buildWizardQuotePayload(
      { ...wizardQuote, status: "Approved" }, // anon trying to elevate
      "shop@example.test",
    );
    expect(out.status).toBe("Pending");
  });

  it("forces source = 'wizard' regardless of what caller sent", () => {
    const out = buildWizardQuotePayload(
      { ...wizardQuote, source: "shopify_admin" },
      "shop@example.test",
    );
    expect(out.source).toBe("wizard");
  });

  it("strips broker_id / broker_email / broker_name (anon can't claim broker)", () => {
    const out = buildWizardQuotePayload(
      {
        ...wizardQuote,
        broker_id: "broker@steal.test",
        broker_email: "broker@steal.test",
        broker_name: "Stealy McStealface",
      },
      "shop@example.test",
    );
    expect(out.broker_id).toBeUndefined();
    expect(out.broker_email).toBeUndefined();
    expect(out.broker_name).toBeUndefined();
  });

  it("strips public_token so anon can't pre-set the security gate", () => {
    // public_token is the token the shop emails to customers. If anon
    // could set it, they could later guess the URL or pre-poison the
    // value. Server controls this when the shop sends the quote.
    const out = buildWizardQuotePayload(
      { ...wizardQuote, public_token: "attacker-chosen-value" },
      "shop@example.test",
    );
    expect(out.public_token).toBeUndefined();
  });

  it("strips sent_to / sent_date so anon can't fake a 'this was sent' history", () => {
    const out = buildWizardQuotePayload(
      { ...wizardQuote, sent_to: "fake@destination.test", sent_date: "2020-01-01" },
      "shop@example.test",
    );
    expect(out.sent_to).toBeUndefined();
    expect(out.sent_date).toBeUndefined();
  });

  it("preserves the wizard's actual fields", () => {
    const out = buildWizardQuotePayload(wizardQuote, "shop@example.test");
    expect(out.quote_id).toBe("Q-2026-ABCDE");
    expect(out.customer_name).toBe("Acme Co");
    expect(out.customer_email).toBe("buyer@acme.test");
    expect(out.line_items).toEqual([{ id: "li-1", style: "Heavy Tee", sizes: { M: 24 } }]);
    expect(out.rush_rate).toBe(0.20);
    expect(out.due_date).toBe("2026-06-15");
  });

  it("handles a null quote without throwing (defensive)", () => {
    const out = buildWizardQuotePayload(null, "shop@example.test");
    expect(out.shop_owner).toBe("shop@example.test");
    expect(out.status).toBe("Pending");
    expect(out.source).toBe("wizard");
  });
});

describe("submitWizardQuote", () => {
  function makeMockClient(rpcResult) {
    return {
      rpc: vi.fn().mockResolvedValue(rpcResult),
    };
  }

  it("calls supabase.rpc('submit_wizard_quote', ...) with the built payload", async () => {
    const client = makeMockClient({ data: "new-quote-uuid", error: null });
    await submitWizardQuote(client, { quote_id: "Q-1" }, "shop@example.test");
    expect(client.rpc).toHaveBeenCalledWith(
      "submit_wizard_quote",
      expect.objectContaining({
        payload: expect.objectContaining({
          shop_owner: "shop@example.test",
          status: "Pending",
          source: "wizard",
          quote_id: "Q-1",
        }),
      }),
    );
  });

  it("returns the inserted UUID on success", async () => {
    const client = makeMockClient({ data: "abc-123", error: null });
    const id = await submitWizardQuote(client, {}, "shop@example.test");
    expect(id).toBe("abc-123");
  });

  it("throws when the RPC returns an error", async () => {
    const client = makeMockClient({ data: null, error: { message: "shop_owner is required" } });
    await expect(submitWizardQuote(client, {}, "shop@example.test"))
      .rejects.toMatchObject({ message: "shop_owner is required" });
  });

  it("propagates buildWizardQuotePayload's validation throws BEFORE calling supabase", async () => {
    const client = makeMockClient({ data: null, error: null });
    await expect(submitWizardQuote(client, {}, "")).rejects.toThrow("shopOwner is required");
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
