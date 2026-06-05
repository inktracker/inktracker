import { describe, it, expect } from "vitest";
import {
  classifyLinkInput,
  chooseInvoiceCandidate,
  buildLinkPatch,
  LINK_INPUT_KIND,
  LINK_OUTCOMES,
} from "../qbLinkLogic.js";

// ─────────────────────────────────────────────────────────────────────
// classifyLinkInput
// ─────────────────────────────────────────────────────────────────────

describe("classifyLinkInput (CLI)", () => {
  it("CLI1 — all-numeric → ID", () => {
    expect(classifyLinkInput("12345")).toEqual({ kind: LINK_INPUT_KIND.ID, value: "12345" });
  });

  it("CLI2 — alphanumeric (Q-2026-115) → DOCNUMBER", () => {
    expect(classifyLinkInput("Q-2026-115"))
      .toEqual({ kind: LINK_INPUT_KIND.DOCNUMBER, value: "Q-2026-115" });
  });

  it("CLI3 — empty / whitespace → INVALID", () => {
    expect(classifyLinkInput("").kind).toBe(LINK_INPUT_KIND.INVALID);
    expect(classifyLinkInput("   ").kind).toBe(LINK_INPUT_KIND.INVALID);
  });

  it("CLI4 — non-string → INVALID", () => {
    expect(classifyLinkInput(null).kind).toBe(LINK_INPUT_KIND.INVALID);
    expect(classifyLinkInput(12345).kind).toBe(LINK_INPUT_KIND.INVALID);
    expect(classifyLinkInput(undefined).kind).toBe(LINK_INPUT_KIND.INVALID);
  });

  it("CLI5 — pads/trims surrounding whitespace before classifying", () => {
    expect(classifyLinkInput("  12345  ")).toEqual({ kind: LINK_INPUT_KIND.ID, value: "12345" });
    expect(classifyLinkInput("\tQ-1\n")).toEqual({ kind: LINK_INPUT_KIND.DOCNUMBER, value: "Q-1" });
  });
});

// ─────────────────────────────────────────────────────────────────────
// chooseInvoiceCandidate
// ─────────────────────────────────────────────────────────────────────

describe("chooseInvoiceCandidate (CIC)", () => {
  it("CIC1 — empty hits → NOT_FOUND", () => {
    expect(chooseInvoiceCandidate(LINK_INPUT_KIND.ID, []).outcome).toBe(LINK_OUTCOMES.NOT_FOUND);
    expect(chooseInvoiceCandidate(LINK_INPUT_KIND.ID, null).outcome).toBe(LINK_OUTCOMES.NOT_FOUND);
  });

  it("CIC2 — single hit → OK with that invoice", () => {
    const inv = { Id: "1042", DocNumber: "Q-2026-115" };
    const out = chooseInvoiceCandidate(LINK_INPUT_KIND.DOCNUMBER, [inv]);
    expect(out.outcome).toBe(LINK_OUTCOMES.OK);
    expect(out.invoice).toBe(inv);
  });

  it("CIC3 — DocNumber matches multiple invoices → AMBIGUOUS (refuse to guess)", () => {
    const hits = [
      { Id: "1", DocNumber: "Q-1" },
      { Id: "2", DocNumber: "Q-1" }, // QB allows duplicate DocNumbers
    ];
    const out = chooseInvoiceCandidate(LINK_INPUT_KIND.DOCNUMBER, hits);
    expect(out.outcome).toBe(LINK_OUTCOMES.AMBIGUOUS);
    expect(out.count).toBe(2);
    expect(out.candidateIds).toEqual(["1", "2"]);
  });

  it("CIC4 — Id lookup with one hit → OK (Id is a PK)", () => {
    const inv = { Id: "9", DocNumber: "Whatever" };
    const out = chooseInvoiceCandidate(LINK_INPUT_KIND.ID, [inv]);
    expect(out.outcome).toBe(LINK_OUTCOMES.OK);
    expect(out.invoice).toBe(inv);
  });
});

// ─────────────────────────────────────────────────────────────────────
// buildLinkPatch
// ─────────────────────────────────────────────────────────────────────

describe("buildLinkPatch (BLP)", () => {
  it("BLP1 — throws on missing invoice", () => {
    expect(() => buildLinkPatch(null)).toThrow();
  });

  it("BLP1b — throws when qbInvoice.Id is missing (don't silently write empty qb_invoice_id)", () => {
    expect(() => buildLinkPatch({ DocNumber: "Q-1", TotalAmt: 100 })).toThrow(/Id/);
  });

  it("BLP2 — writes qb_invoice_id + totals + timestamp", () => {
    const patch = buildLinkPatch({
      Id: "1042",
      DocNumber: "Q-1",
      TotalAmt: 250,
      Balance: 250,
      TxnTaxDetail: { TotalTax: 20 },
    });
    expect(patch.qb_invoice_id).toBe("1042");
    expect(patch.qb_total).toBe(250);
    expect(patch.qb_tax_amount).toBe(20);
    expect(patch.qb_subtotal).toBe(230);
    expect(typeof patch.qb_synced_at).toBe("string");
  });

  it("BLP3 — linking to already-paid invoice flips paid + paid_date", () => {
    const patch = buildLinkPatch({
      Id: "1042",
      TotalAmt: 250,
      Balance: 0,
    });
    expect(patch.paid).toBe(true);
    expect(patch.paid_date).toBe(patch.qb_synced_at);
  });

  it("BLP4 — linking to unpaid invoice does NOT include paid", () => {
    const patch = buildLinkPatch({
      Id: "1042",
      TotalAmt: 250,
      Balance: 250,
    });
    expect(patch.paid).toBeUndefined();
    expect(patch.paid_date).toBeUndefined();
  });

  it("BLP5 — extractPaymentLink hit → payment link included", () => {
    const patch = buildLinkPatch({
      Id: "1042",
      TotalAmt: 100,
      Balance: 100,
      InvoiceLink: "https://qb.example/pay/zzz",
    });
    expect(patch.qb_payment_link).toBe("https://qb.example/pay/zzz");
  });

  it("BLP6 — no payment link in invoice → patch omits qb_payment_link (don't overwrite existing)", () => {
    const patch = buildLinkPatch({ Id: "1042", TotalAmt: 100, Balance: 100 });
    expect(patch.qb_payment_link).toBeUndefined();
  });
});
