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

  describe("created_no_link — invoice exists, no QB Payments URL", () => {
    // This is the case that produced the duplicate bug. Before the
    // fix, qbPaymentLink === null was treated as "not created" and
    // the Create button kept rendering → re-clicks → duplicate QB
    // invoices.
    it("returns created_no_link + send-ENABLED when only the id is set", () => {
      const state = deriveQbSendState({ qbInvoiceId: "qb-123", qbPaymentLink: null });
      expect(state.status).toBe("created_no_link");
      expect(state.sendDisabledByQb).toBe(false);
    });

    it("surfaces a warning explaining the QB Payments fallback to Stripe", () => {
      const { warning } = deriveQbSendState({ qbInvoiceId: "qb-123", qbPaymentLink: null });
      expect(warning).toMatch(/QB Payments isn't enabled/i);
      expect(warning).toMatch(/Stripe/);
    });

    it("treats empty-string paymentLink as missing", () => {
      expect(deriveQbSendState({ qbInvoiceId: "qb-123", qbPaymentLink: "" }).status)
        .toBe("created_no_link");
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
    // Cross-state property checks to lock in the contract — these
    // would have caught the original bug at PR time.

    const cases = [
      { qbInvoiceId: null,   qbPaymentLink: null,           expectStatus: "needs_create"    },
      { qbInvoiceId: null,   qbPaymentLink: "url",          expectStatus: "needs_create"    },
      { qbInvoiceId: "id",   qbPaymentLink: null,           expectStatus: "created_no_link" },
      { qbInvoiceId: "id",   qbPaymentLink: "url",          expectStatus: "ready"           },
    ];

    it.each(cases)(
      "invoiceId=$qbInvoiceId, paymentLink=$qbPaymentLink → status=$expectStatus",
      ({ qbInvoiceId, qbPaymentLink, expectStatus }) => {
        expect(deriveQbSendState({ qbInvoiceId, qbPaymentLink }).status).toBe(expectStatus);
      },
    );

    it("sendDisabledByQb is true IF AND ONLY IF status === needs_create", () => {
      // The Create button gates Send. Once an invoice exists in QB
      // (even without a payment URL), Send can fire.
      for (const { qbInvoiceId, qbPaymentLink, expectStatus } of cases) {
        const { sendDisabledByQb } = deriveQbSendState({ qbInvoiceId, qbPaymentLink });
        expect(sendDisabledByQb).toBe(expectStatus === "needs_create");
      }
    });

    it("warning is non-null IF AND ONLY IF status === created_no_link", () => {
      for (const { qbInvoiceId, qbPaymentLink, expectStatus } of cases) {
        const { warning } = deriveQbSendState({ qbInvoiceId, qbPaymentLink });
        if (expectStatus === "created_no_link") expect(warning).toBeTruthy();
        else expect(warning).toBeNull();
      }
    });
  });
});
