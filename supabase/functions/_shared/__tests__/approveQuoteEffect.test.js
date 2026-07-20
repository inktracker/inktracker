import { describe, it, expect } from "vitest";
import {
  resolveApproveQuoteUpdate,
  APPROVE_LOCKED_STATUSES,
  APPROVE_GUARD_OR,
} from "../approveQuoteEffect.js";
import { SACRED_STATUSES } from "../../../../src/lib/quotes/editPolicy.js";
import { quoteAlreadyApproved } from "../../../../src/lib/quotes/approvalState.js";

const NOW = "2026-07-02T16:00:00.000Z";

describe("resolveApproveQuoteUpdate — direct shop quotes", () => {
  it.each(["Draft", "Sent", "Pending", "Declined", "Expired", undefined, null, ""])(
    "approves from pre-approval status %j",
    (status) => {
      const { update, isBroker } = resolveApproveQuoteUpdate({ status }, { nowISO: NOW });
      expect(update).toEqual({ status: "Approved" });
      expect(isBroker).toBe(false);
    },
  );

  it.each(APPROVE_LOCKED_STATUSES)(
    "refuses to write when status is already %j",
    (status) => {
      const { update } = resolveApproveQuoteUpdate({ status }, { nowISO: NOW });
      expect(update).toBeNull();
    },
  );

  it("refuses the zombie shape — converted_order_id set but status regressed (the Q-2026-I0B6 bug)", () => {
    const { update } = resolveApproveQuoteUpdate(
      { status: "Approved", converted_order_id: "ORD-2026-XYZ" },
      { nowISO: NOW },
    );
    expect(update).toBeNull();
  });

  it("refuses on converted_order_id even when status looks approvable", () => {
    const { update } = resolveApproveQuoteUpdate(
      { status: "Sent", converted_order_id: "ORD-1" },
      { nowISO: NOW },
    );
    expect(update).toBeNull();
  });

  it("handles a missing pre row without throwing (defaults to a plain approve)", () => {
    expect(resolveApproveQuoteUpdate(undefined, { nowISO: NOW }).update)
      .toEqual({ status: "Approved" });
    expect(resolveApproveQuoteUpdate({}, { nowISO: NOW }).update)
      .toEqual({ status: "Approved" });
  });
});

describe("resolveApproveQuoteUpdate — broker quotes", () => {
  it("routes to Client Approved (client-first workflow), stamping client_approved_at", () => {
    const { update, isBroker } = resolveApproveQuoteUpdate(
      { status: "Sent", broker_id: "b-1" },
      { nowISO: NOW },
    );
    expect(update).toEqual({
      status: "Client Approved",
      client_status: "Approved",
      client_approved_at: NOW,
    });
    expect(isBroker).toBe(true);
  });

  it("detects broker-ness from broker_email alone", () => {
    const { update, isBroker } = resolveApproveQuoteUpdate(
      { status: "Sent", broker_email: "broker@x.com" },
      { nowISO: NOW },
    );
    expect(isBroker).toBe(true);
    expect(update.status).toBe("Client Approved");
  });

  it("does not restamp client_approved_at on a replayed link", () => {
    const { update } = resolveApproveQuoteUpdate(
      { status: "Client Approved", client_status: "Approved", broker_id: "b-1" },
      { nowISO: NOW },
    );
    expect(update).toBeNull();
  });

  it("never yanks a submitted-to-shop broker quote back to Client Approved (client_status lock)", () => {
    // After the broker submits, top-level status moves on but
    // client_status stays "Approved" — a re-clicked end-client link must
    // not rewind the shop-side pipeline.
    const { update } = resolveApproveQuoteUpdate(
      { status: "Submitted to Shop", client_status: "Approved", broker_id: "b-1" },
      { nowISO: NOW },
    );
    expect(update).toBeNull();
  });

  it("refuses on a converted broker quote", () => {
    const { update } = resolveApproveQuoteUpdate(
      { status: "Converted to Order", broker_id: "b-1", converted_order_id: "ORD-2" },
      { nowISO: NOW },
    );
    expect(update).toBeNull();
  });
});

describe("APPROVE_GUARD_OR — the PostgREST race guard", () => {
  it("matches the exact filter string the update ships with", () => {
    // Frozen deliberately: this string is PostgREST syntax, not JS — a
    // typo (missing quotes around multi-word statuses, dropped null arm)
    // silently turns the guard into "matches nothing" and every approve
    // becomes a no-op. If APPROVE_LOCKED_STATUSES changes, update this
    // expectation consciously.
    expect(APPROVE_GUARD_OR).toBe(
      'status.is.null,status.not.in.("Approved","Client Approved","Converted to Order","Approved and Paid","Paid")',
    );
  });

  it("keeps NULL-status rows updatable via the is.null arm", () => {
    expect(APPROVE_GUARD_OR.startsWith("status.is.null,")).toBe(true);
  });

  it("quotes every locked status (all contain spaces or must survive commas)", () => {
    for (const s of APPROVE_LOCKED_STATUSES) {
      expect(APPROVE_GUARD_OR).toContain(`"${s}"`);
    }
  });
});

describe("cross-layer contracts", () => {
  it("locks every SACRED status from editPolicy (order/payment is source of truth)", () => {
    for (const s of SACRED_STATUSES) {
      expect(APPROVE_LOCKED_STATUSES).toContain(s);
    }
  });

  it("agrees with the payment page's quoteAlreadyApproved for every locked status", () => {
    // If the server refuses the write, the page must already render the
    // approved state — otherwise it offers a button that does nothing.
    for (const status of APPROVE_LOCKED_STATUSES) {
      expect(quoteAlreadyApproved({ status })).toBe(true);
    }
    // And the converse for the normal approvable path:
    for (const status of ["Draft", "Sent", "Pending", "Declined"]) {
      expect(quoteAlreadyApproved({ status })).toBe(false);
      expect(resolveApproveQuoteUpdate({ status }, { nowISO: NOW }).update).not.toBeNull();
    }
  });

  it("agrees with the payment page on the desync signals too", () => {
    const zombie = { status: "Approved", converted_order_id: "ORD-1" };
    expect(quoteAlreadyApproved(zombie)).toBe(true);
    expect(resolveApproveQuoteUpdate(zombie, { nowISO: NOW }).update).toBeNull();

    const brokerMidFlow = { status: "Submitted to Shop", client_status: "Approved" };
    expect(quoteAlreadyApproved(brokerMidFlow)).toBe(true);
    expect(resolveApproveQuoteUpdate(brokerMidFlow, { nowISO: NOW }).update).toBeNull();
  });
});
