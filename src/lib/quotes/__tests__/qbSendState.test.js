import { describe, it, expect } from "vitest";
import { deriveQbSendState } from "../qbSendState.js";

describe("deriveQbSendState", () => {
  describe("needs_create — no QB invoice yet", () => {
    it("returns needs_create + send-disabled when neither field is set", () => {
      expect(deriveQbSendState({ qbInvoiceId: null, qbPaymentLink: null })).toEqual({
        status: "needs_create",
        sendDisabledByQb: true,
        warning: null,
      });
    });

    it("returns needs_create when called with no args (defensive default)", () => {
      // Avoids a crash if the modal renders before state is hydrated.
      expect(deriveQbSendState()).toEqual({
        status: "needs_create",
        sendDisabledByQb: true,
        warning: null,
      });
    });

    it("treats empty string as 'no invoice' (some upstreams return '' instead of null)", () => {
      expect(deriveQbSendState({ qbInvoiceId: "", qbPaymentLink: null }).status)
        .toBe("needs_create");
    });
  });

  describe("send_failed — invoice exists, /send didn't return a payment link", () => {
    // Post-PR #174 (which switched to POST /invoice/{id}/send for minting
    // the share link), the only way to land here is if our /send call
    // failed transiently. The previous "QB Payments isn't enabled" framing
    // was a misdiagnosis. The Retry UX re-invokes createInvoice → the
    // backend's UPDATE path runs /send again on the existing invoice id,
    // never creating a duplicate.
    it("returns send_failed + send-DISABLED when only the id is set", () => {
      const state = deriveQbSendState({ qbInvoiceId: "qb-123", qbPaymentLink: null });
      expect(state.status).toBe("send_failed");
      expect(state.sendDisabledByQb).toBe(true);
    });

    it("surfaces a retryable warning that doesn't blame QB Payments setup", () => {
      const { warning } = deriveQbSendState({ qbInvoiceId: "qb-123", qbPaymentLink: null });
      expect(warning).toMatch(/Couldn't get the payment link/i);
      expect(warning).toMatch(/Try again/i);
      // Don't lie to the user about why — pre-#174 we wrongly told them
      // QB Payments wasn't enabled.
      expect(warning).not.toMatch(/QB Payments isn't enabled/i);
    });

    it("treats empty-string paymentLink as missing", () => {
      expect(deriveQbSendState({ qbInvoiceId: "qb-123", qbPaymentLink: "" }).status)
        .toBe("send_failed");
    });
  });

  describe("ready — full QB flow available", () => {
    it("returns ready + send-enabled + no warning when both fields are set", () => {
      expect(deriveQbSendState({ qbInvoiceId: "qb-123", qbPaymentLink: "https://qb.example/pay/abc" })).toEqual({
        status: "ready",
        sendDisabledByQb: false,
        warning: null,
      });
    });
  });

  describe("state-machine invariants", () => {
    // Cross-state property checks to lock in the contract.

    const cases = [
      { qbInvoiceId: null,   qbPaymentLink: null,           expectStatus: "needs_create" },
      { qbInvoiceId: null,   qbPaymentLink: "url",          expectStatus: "needs_create" },
      { qbInvoiceId: "id",   qbPaymentLink: null,           expectStatus: "send_failed"  },
      { qbInvoiceId: "id",   qbPaymentLink: "url",          expectStatus: "ready"        },
    ];

    it.each(cases)(
      "invoiceId=$qbInvoiceId, paymentLink=$qbPaymentLink → status=$expectStatus",
      ({ qbInvoiceId, qbPaymentLink, expectStatus }) => {
        expect(deriveQbSendState({ qbInvoiceId, qbPaymentLink }).status).toBe(expectStatus);
      },
    );

    it("sendDisabledByQb is true UNLESS status === ready", () => {
      // Send needs BOTH the invoice and the link. Either one missing
      // blocks send.
      for (const { qbInvoiceId, qbPaymentLink, expectStatus } of cases) {
        const { sendDisabledByQb } = deriveQbSendState({ qbInvoiceId, qbPaymentLink });
        expect(sendDisabledByQb).toBe(expectStatus !== "ready");
      }
    });

    it("warning is non-null IF AND ONLY IF status === send_failed", () => {
      for (const { qbInvoiceId, qbPaymentLink, expectStatus } of cases) {
        const { warning } = deriveQbSendState({ qbInvoiceId, qbPaymentLink });
        if (expectStatus === "send_failed") expect(warning).toBeTruthy();
        else expect(warning).toBeNull();
      }
    });
  });
});
