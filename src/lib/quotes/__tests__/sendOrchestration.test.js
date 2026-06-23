import { describe, it, expect } from "vitest";
import {
  parseRecipients,
  decidePublicToken,
  shouldClearQbPaymentLink,
  nextStatusOnSend,
  buildSendQuoteEmailRequest,
  buildPostSendQuotePatch,
  extractProofImageUrls,
} from "../sendOrchestration.js";

describe("extractProofImageUrls", () => {
  const base = "https://x.supabase.co/storage/v1/object/public/artwork";
  it("returns [] when no artwork", () => {
    expect(extractProofImageUrls({})).toEqual([]);
    expect(extractProofImageUrls({ selected_artwork: null })).toEqual([]);
  });
  it("keeps image urls, drops PDFs and non-https", () => {
    const out = extractProofImageUrls({
      selected_artwork: [
        { url: `${base}/a.png`, name: "Front" },
        { url: `${base}/b.pdf`, name: "Spec" },        // pdf dropped
        { file_url: `${base}/c.jpg` },                  // file_url fallback
        { url: "http://insecure/d.png" },               // non-https dropped
        { url: "javascript:alert(1)" },                 // dropped
      ],
    });
    expect(out).toEqual([
      { url: `${base}/a.png`, name: "Front" },
      { url: `${base}/c.jpg`, name: "Art proof" },
    ]);
  });
  it("caps at 6", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ url: `${base}/${i}.png` }));
    expect(extractProofImageUrls({ selected_artwork: many })).toHaveLength(6);
  });
  it("buildSendQuoteEmailRequest includes proofImages", () => {
    const req = buildSendQuoteEmailRequest({
      quote: { quote_id: "Q1", selected_artwork: [{ url: `${base}/a.png`, name: "Front" }] },
      recipients: ["c@x.test"],
      taggedSubject: "s",
      body: "b",
      paymentLink: "https://pay",
      shopName: "Shop",
    });
    expect(req.proofImages).toEqual([{ url: `${base}/a.png`, name: "Front" }]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// parseRecipients
// ─────────────────────────────────────────────────────────────────────

describe("parseRecipients (R1–R4)", () => {
  it("R1 — comma + whitespace tolerant", () => {
    expect(parseRecipients("a@x.test,b@x.test , c@x.test"))
      .toEqual(["a@x.test", "b@x.test", "c@x.test"]);
  });

  it("R1 — empty / null / undefined input → []", () => {
    expect(parseRecipients("")).toEqual([]);
    expect(parseRecipients(null)).toEqual([]);
    expect(parseRecipients(undefined)).toEqual([]);
  });

  it("R2 — dedupe is case-insensitive but keeps the first-seen casing", () => {
    expect(parseRecipients("Joe@Example.test, joe@example.test, JOE@example.test"))
      .toEqual(["Joe@Example.test"]);
  });

  it("R2 — preserves order (first recipient is the one we persist as customer_email)", () => {
    expect(parseRecipients("third@x.test, first@x.test, second@x.test"))
      .toEqual(["third@x.test", "first@x.test", "second@x.test"]);
  });

  it("R3 — single-recipient string without comma still works", () => {
    expect(parseRecipients("only@x.test")).toEqual(["only@x.test"]);
  });

  it("R4 — drops obviously-malformed entries (no '@', '@' alone, no dot)", () => {
    expect(parseRecipients("ok@x.test, not-an-email, @x.test, lhs@, no-dot@x"))
      .toEqual(["ok@x.test"]);
  });

  it("R2 — trailing commas + empty slots are tolerated", () => {
    expect(parseRecipients(",,a@x.test,,,b@x.test,,"))
      .toEqual(["a@x.test", "b@x.test"]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// decidePublicToken
// ─────────────────────────────────────────────────────────────────────

describe("decidePublicToken (T1–T5)", () => {
  it("T1 — reuses existing public_token, no persist", () => {
    expect(decidePublicToken({ public_token: "abc123" }))
      .toEqual({ token: "abc123", needsPersist: false });
  });

  it("T2 — mints new token when quote has no public_token, flags persist", () => {
    const result = decidePublicToken({}, () => "minted");
    expect(result).toEqual({ token: "minted", needsPersist: true });
  });

  it("T3 — empty-string token is treated as missing", () => {
    expect(decidePublicToken({ public_token: "" }, () => "minted"))
      .toEqual({ token: "minted", needsPersist: true });
  });

  it("T3 — whitespace-only token is treated as missing", () => {
    expect(decidePublicToken({ public_token: "   " }, () => "minted"))
      .toEqual({ token: "minted", needsPersist: true });
  });

  it("T4 — generator is injectable so tests are deterministic", () => {
    const gen = () => "test-token-xyz";
    expect(decidePublicToken({}, gen).token).toBe("test-token-xyz");
  });

  it("T5 — resending an already-sent quote NEVER rotates the token", () => {
    // Critical contract: old email links must keep working when the
    // shop resends a quote. If we minted a fresh token here, every
    // previously-emailed link would 404.
    const quote = { public_token: "original-token", status: "Sent", sent_to: "buyer@x.test" };
    expect(decidePublicToken(quote, () => "REROLLED")).toEqual({
      token: "original-token",
      needsPersist: false,
    });
  });

  it("T1 — handles null quote defensively", () => {
    const result = decidePublicToken(null, () => "minted");
    expect(result).toEqual({ token: "minted", needsPersist: true });
  });
});

// ─────────────────────────────────────────────────────────────────────
// shouldClearQbPaymentLink
// ─────────────────────────────────────────────────────────────────────

describe("shouldClearQbPaymentLink (C1–C5)", () => {
  it("C1 — Stripe + has QB link → true (route customer to Stripe)", () => {
    expect(shouldClearQbPaymentLink("stripe", "https://qb.test/pay/123", null))
      .toBe(true);
  });

  it("C2 — Stripe + no QB link → false (nothing to clear)", () => {
    expect(shouldClearQbPaymentLink("stripe", null, null)).toBe(false);
    expect(shouldClearQbPaymentLink("stripe", "", "")).toBe(false);
  });

  it("C3 — QB + has QB link → false (we WANT to keep the QB link)", () => {
    expect(shouldClearQbPaymentLink("qb", "https://qb.test/pay/123", null))
      .toBe(false);
  });

  it("C4 — QB + no QB link → false (nothing to clear)", () => {
    expect(shouldClearQbPaymentLink("qb", null, null)).toBe(false);
  });

  it("C5 — Stripe + local link (no row link) → true (within-session Create-then-switch)", () => {
    // The "user clicked Create QB Invoice then switched to Stripe"
    // case: local state has the link but the DB might not yet. We
    // need to clear it on the row too.
    expect(shouldClearQbPaymentLink("stripe", null, "https://qb.test/pay/123"))
      .toBe(true);
  });

  it("C5 — Stripe + both row + local link → true", () => {
    expect(shouldClearQbPaymentLink("stripe", "row-link", "local-link"))
      .toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// nextStatusOnSend
// ─────────────────────────────────────────────────────────────────────

describe("nextStatusOnSend (S1–S6)", () => {
  it("S1 — Draft → Sent", () => {
    expect(nextStatusOnSend("Draft")).toBe("Sent");
  });

  it("S1 — null / undefined / empty → Sent (defensive default)", () => {
    expect(nextStatusOnSend(null)).toBe("Sent");
    expect(nextStatusOnSend(undefined)).toBe("Sent");
    expect(nextStatusOnSend("")).toBe("Sent");
  });

  it("S2 — Pending → Pending (manual marker, don't override)", () => {
    expect(nextStatusOnSend("Pending")).toBe("Pending");
  });

  it("S3 — Sent → Sent (resend doesn't break)", () => {
    expect(nextStatusOnSend("Sent")).toBe("Sent");
  });

  it("S4 — Approved → Approved (resend doesn't downgrade)", () => {
    // Critical: a shop resending a quote that the customer already
    // approved must NOT flip the status back to Sent. The dashboard
    // would lose the won-deal signal.
    expect(nextStatusOnSend("Approved")).toBe("Approved");
  });

  it("S5 — Approved and Paid → Approved and Paid (re-send is harmless)", () => {
    expect(nextStatusOnSend("Approved and Paid")).toBe("Approved and Paid");
  });

  it("S6 — Declined → Declined (re-send exists to nudge, status sticks)", () => {
    expect(nextStatusOnSend("Declined")).toBe("Declined");
  });
});

// ─────────────────────────────────────────────────────────────────────
// buildSendQuoteEmailRequest
// ─────────────────────────────────────────────────────────────────────

describe("buildSendQuoteEmailRequest (E1–E5)", () => {
  const baseArgs = {
    quote: {
      quote_id: "Q-2026-ABCDE",
      customer_name: "Acme",
      total: 250.0,
      shop_owner: "shop@example.test",
    },
    recipients: ["buyer@acme.test"],
    taggedSubject: "Your Quote [Ref: SHOP-Q-2026-ABCDE]",
    body: "Hi Acme, your quote is ready.",
    paymentLink: "https://www.inktracker.app/quotepayment?id=...&token=...",
    shopName: "Print Shop",
    pdfBase64: "JVBERi0xLjQK...",
  };

  it("E1 — always includes paymentLink (and approveLink as alias)", () => {
    const req = buildSendQuoteEmailRequest(baseArgs);
    expect(req.paymentLink).toBe(baseArgs.paymentLink);
    expect(req.approveLink).toBe(baseArgs.paymentLink);
  });

  it("E2 — passes through the caller-tagged subject (with Ref tag)", () => {
    expect(buildSendQuoteEmailRequest(baseArgs).subject)
      .toBe("Your Quote [Ref: SHOP-Q-2026-ABCDE]");
  });

  it("E3 — passes through pdfBase64 + pdfFilename", () => {
    const req = buildSendQuoteEmailRequest(baseArgs);
    expect(req.pdfBase64).toBe("JVBERi0xLjQK...");
    expect(req.pdfFilename).toBe("Quote-Q-2026-ABCDE.pdf");
  });

  it("E3 — pdfBase64 = null when PDF generation failed (still sends email)", () => {
    const req = buildSendQuoteEmailRequest({ ...baseArgs, pdfBase64: null });
    expect(req.pdfBase64).toBe(null);
  });

  it("E3 — pdfFilename falls back to 'draft' when no quote_id", () => {
    const req = buildSendQuoteEmailRequest({
      ...baseArgs,
      quote: { ...baseArgs.quote, quote_id: undefined },
    });
    expect(req.pdfFilename).toBe("Quote-draft.pdf");
  });

  it("E4 — broker fields pass through when present", () => {
    const req = buildSendQuoteEmailRequest({
      ...baseArgs,
      quote: {
        ...baseArgs.quote,
        broker_name: "Broker Bob",
        broker_id: "bob@broker.test",
      },
    });
    expect(req.brokerName).toBe("Broker Bob");
    expect(req.brokerEmail).toBe("bob@broker.test");
  });

  it("E4 — broker_id wins over broker_email when both set (canonical address)", () => {
    const req = buildSendQuoteEmailRequest({
      ...baseArgs,
      quote: {
        ...baseArgs.quote,
        broker_id: "id@broker.test",
        broker_email: "email@broker.test",
      },
    });
    expect(req.brokerEmail).toBe("id@broker.test");
  });

  it("E4 — falls back to broker_email when broker_id is absent", () => {
    const req = buildSendQuoteEmailRequest({
      ...baseArgs,
      quote: { ...baseArgs.quote, broker_email: "fallback@broker.test" },
    });
    expect(req.brokerEmail).toBe("fallback@broker.test");
  });

  it("E5 — shopOwnerEmail is always carried (Resend uses it as Reply-To)", () => {
    expect(buildSendQuoteEmailRequest(baseArgs).shopOwnerEmail)
      .toBe("shop@example.test");
  });

  it("E5 — shopName defaults to 'Your Shop' when missing/empty AND not a broker quote", () => {
    const req = buildSendQuoteEmailRequest({ ...baseArgs, shopName: "" });
    expect(req.shopName).toBe("Your Shop");
  });

  // ── Broker-quote brand resolution ────────────────────────────────
  // End clients of broker quotes must see the BROKER as the merchant,
  // not the print shop and definitely not the "Your Shop" placeholder.
  // The 2026-05-31 regression that screenshotted "YOUR SHOP" as the
  // email header was a broker quote where shopName came through empty
  // (shop record had no shop_name set) — the helper used to fall back
  // to the literal "Your Shop". These tests fence the fix.

  it("E6 — broker quote uses broker_company in shopName (highest priority)", () => {
    const req = buildSendQuoteEmailRequest({
      ...baseArgs,
      quote: {
        ...baseArgs.quote,
        broker_id: "b1",
        broker_email: "broker@example.com",
        broker_company: "BrokerCo",
        broker_name: "Jane Doe",
      },
      shopName: "Print Shop",
    });
    expect(req.shopName).toBe("BrokerCo");
  });

  it("E7 — broker quote without broker_company falls back to broker_name", () => {
    const req = buildSendQuoteEmailRequest({
      ...baseArgs,
      quote: {
        ...baseArgs.quote,
        broker_id: "b1",
        broker_name: "Jane Doe",
      },
      shopName: "Print Shop",
    });
    expect(req.shopName).toBe("Jane Doe");
  });

  it("E8 — broker quote with empty broker fields falls to shopName, NOT Your Shop", () => {
    // Defensive: broker entity exists (id/email set) but somehow
    // company AND name are blank. We still prefer the configured
    // shopName over the dead-air "Your Shop" placeholder.
    const req = buildSendQuoteEmailRequest({
      ...baseArgs,
      quote: {
        ...baseArgs.quote,
        broker_id: "b1",
        broker_email: "broker@example.com",
        broker_company: "",
        broker_name: "",
      },
      shopName: "Print Shop",
    });
    expect(req.shopName).toBe("Print Shop");
  });

  it("E9 — broker quote with empty broker fields AND empty shopName → 'Your Shop' fallback (last resort)", () => {
    const req = buildSendQuoteEmailRequest({
      ...baseArgs,
      quote: { ...baseArgs.quote, broker_id: "b1" },
      shopName: "",
    });
    expect(req.shopName).toBe("Your Shop");
  });

  it("E10 — non-broker quote ignores broker_* fields entirely", () => {
    // Defensive: a quote with stale broker_company leftover but no
    // broker_id/broker_email shouldn't accidentally surface the broker
    // name on a direct shop send.
    const req = buildSendQuoteEmailRequest({
      ...baseArgs,
      quote: {
        ...baseArgs.quote,
        broker_company: "Stale BrokerCo",
        broker_name: "Stale Name",
      },
      shopName: "Print Shop",
    });
    expect(req.shopName).toBe("Print Shop");
  });

  it("E11 — broker gate uses broker_email alone (no broker_id needed)", () => {
    const req = buildSendQuoteEmailRequest({
      ...baseArgs,
      quote: {
        ...baseArgs.quote,
        broker_email: "broker@example.com",
        broker_name: "Jane Doe",
      },
      shopName: "Print Shop",
    });
    expect(req.shopName).toBe("Jane Doe");
  });
});

// ─────────────────────────────────────────────────────────────────────
// buildPostSendQuotePatch
// ─────────────────────────────────────────────────────────────────────

describe("buildPostSendQuotePatch (P1–P7)", () => {
  const NOW = "2026-05-15T20:00:00.000Z";

  const baseArgs = {
    currentStatus: "Draft",
    recipients: ["first@x.test", "second@x.test"],
    totals: { sub: 200, tax: 16.5, total: 216.5 },
    isBrokerQuote: false,
    currentTaxRate: 8.25,
    nowIso: () => NOW,
  };

  it("P1 — status flips per nextStatusOnSend (Draft → Sent here)", () => {
    expect(buildPostSendQuotePatch(baseArgs).status).toBe("Sent");
  });

  it("P1 — Approved stays Approved (resend doesn't downgrade)", () => {
    const patch = buildPostSendQuotePatch({ ...baseArgs, currentStatus: "Approved" });
    expect(patch.status).toBe("Approved");
  });

  it("P2 — sent_to is comma-joined recipients in order", () => {
    expect(buildPostSendQuotePatch(baseArgs).sent_to)
      .toBe("first@x.test, second@x.test");
  });

  it("P3 — sent_date uses the injected clock (deterministic)", () => {
    expect(buildPostSendQuotePatch(baseArgs).sent_date).toBe(NOW);
  });

  it("P4 — totals from the editor are persisted as sub / tax / total", () => {
    const patch = buildPostSendQuotePatch(baseArgs);
    expect(patch.subtotal).toBe(200);
    expect(patch.tax).toBe(16.5);
    expect(patch.total).toBe(216.5);
  });

  it("P5 — broker quote forces tax_rate to 0 even if currentTaxRate is non-zero", () => {
    // Brokers don't collect tax through us — the shop bills the
    // broker net of tax, broker bills the customer separately. Any
    // tax_rate that snuck onto the quote row must NOT persist.
    const patch = buildPostSendQuotePatch({
      ...baseArgs,
      isBrokerQuote: true,
      currentTaxRate: 8.25,
    });
    expect(patch.tax_rate).toBe(0);
  });

  it("P6 — non-broker quote preserves currentTaxRate", () => {
    expect(buildPostSendQuotePatch(baseArgs).tax_rate).toBe(8.25);
  });

  it("P7 — customer_email is the FIRST recipient (canonical address)", () => {
    expect(buildPostSendQuotePatch(baseArgs).customer_email).toBe("first@x.test");
  });

  it("P7 — empty recipients list → customer_email is empty string (defensive)", () => {
    const patch = buildPostSendQuotePatch({ ...baseArgs, recipients: [] });
    expect(patch.customer_email).toBe("");
    expect(patch.sent_to).toBe("");
  });

  it("P4 — null totals object → all amounts default to null (don't blow up the patch)", () => {
    const patch = buildPostSendQuotePatch({ ...baseArgs, totals: null });
    expect(patch.subtotal).toBe(null);
    expect(patch.tax).toBe(null);
    expect(patch.total).toBe(null);
  });
});

describe("extractProofImageUrls — edge cases", () => {
  const base = "https://x.supabase.co/storage/v1/object/public/artwork";
  it("accepts uppercase extensions and ignores query strings", () => {
    const out = extractProofImageUrls({ selected_artwork: [
      { url: `${base}/A.PNG` },
      { url: `${base}/b.JPG?token=abc&v=2` },
    ] });
    expect(out.map((p) => p.url)).toEqual([`${base}/A.PNG`, `${base}/b.JPG?token=abc&v=2`]);
  });
  it("excludes SVG and other non-raster types", () => {
    expect(extractProofImageUrls({ selected_artwork: [{ url: `${base}/logo.svg` }] })).toEqual([]);
    expect(extractProofImageUrls({ selected_artwork: [{ url: `${base}/doc.pdf` }] })).toEqual([]);
  });
  it("skips items with no usable url and non-string urls", () => {
    const out = extractProofImageUrls({ selected_artwork: [
      { name: "no url" },
      { url: 12345 },
      { url: `${base}/ok.png`, name: "Front" },
    ] });
    expect(out).toEqual([{ url: `${base}/ok.png`, name: "Front" }]);
  });
});
