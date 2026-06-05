import { describe, it, expect } from "vitest";
import { resolveJobLabel } from "../resolveJobLabel.js";

describe("resolveJobLabel (RJL)", () => {
  const customers = {
    "cust-1": { id: "cust-1", company: "Acme Co", name: "Joe Customer" },
    "cust-2": { id: "cust-2", name: "Jane Customer" }, // no company
  };

  // ─── Direct shop work — pre-existing semantics ──────────────────────

  it("RJL1 — linked customer company wins over record's denormalized fields", () => {
    expect(resolveJobLabel({ customer_id: "cust-1", customer_name: "Other" }, customers))
      .toBe("Acme Co");
  });

  it("RJL2 — record.company used when linked customer has none", () => {
    expect(resolveJobLabel({ customer_id: "cust-2", company: "Stale Co" }, customers))
      .toBe("Stale Co");
  });

  it("RJL3 — falls back to customer name when no company", () => {
    expect(resolveJobLabel({ customer_id: "cust-2" }, customers))
      .toBe("Jane Customer");
  });

  it("RJL4 — falls back to record.customer_name when no linked customer", () => {
    expect(resolveJobLabel({ customer_name: "Walk-in Wally" }, customers))
      .toBe("Walk-in Wally");
  });

  it("RJL5 — em-dash when nothing matches", () => {
    expect(resolveJobLabel({}, customers)).toBe("—");
    expect(resolveJobLabel(null, customers)).toBe("—");
  });

  it("RJL6 — null/missing customers map doesn't crash", () => {
    expect(resolveJobLabel({ customer_name: "Walk-in" }))
      .toBe("Walk-in");
  });

  // ─── Broker work — the new contract ─────────────────────────────────

  it("RJL7 — broker quote shows BROKER company, not end-client name", () => {
    // The Jun-31 calendar regression: "TEST CLIENT · Quote Sent"
    // sitting next to "Jane Doe · Order Goods" for the SAME job.
    // Shop-facing surfaces always show the broker; end-client name
    // is for the broker portal only.
    const r = resolveJobLabel({
      broker_id: "broker-uuid",
      broker_email: "jane@brokerco.com",
      broker_company: "BrokerCo",
      broker_name: "Jane Doe",
      customer_name: "TEST CLIENT", // end client — must NOT win
    }, customers);
    expect(r).toBe("BrokerCo");
  });

  it("RJL8 — broker quote without broker_company falls back to broker_name", () => {
    const r = resolveJobLabel({
      broker_id: "broker-uuid",
      broker_name: "Jane Doe",
      customer_name: "TEST CLIENT",
    }, customers);
    expect(r).toBe("Jane Doe");
  });

  it("RJL9 — broker gate uses broker_id OR broker_email (matches isBrokerQuote)", () => {
    // Email alone is enough to trigger the broker branch.
    const r = resolveJobLabel({
      broker_email: "jane@brokerco.com",
      broker_name: "Jane Doe",
      customer_name: "End Client",
    }, customers);
    expect(r).toBe("Jane Doe");
  });

  it("RJL10 — broker quote with all broker fields blank falls through to customer logic", () => {
    // Defensive — shouldn't happen in practice (an entity with
    // broker_id should also have broker_name) but a stale row shouldn't
    // render as an em-dash when there's a customer_name available.
    const r = resolveJobLabel({
      broker_id: "broker-uuid",
      broker_name: "",
      broker_company: "  ",
      customer_name: "Fallback Name",
    }, customers);
    expect(r).toBe("Fallback Name");
  });

  it("RJL11 — non-broker quote with broker_name leftover does NOT use it", () => {
    // After unlinking a quote from a broker, broker_id is null but
    // broker_name might linger. The broker-gate check on id/email
    // prevents stale names from misleading the chip label.
    const r = resolveJobLabel({
      broker_name: "Was A Broker",
      customer_id: "cust-1",
    }, customers);
    expect(r).toBe("Acme Co"); // resolved through customer, not stale broker_name
  });

  it("RJL12 — order with broker_id (synthesized from buildOrderInsertFromQuote) still resolves to broker", () => {
    // For broker orders, buildOrderInsertFromQuote sets
    // customer_name = broker_name and broker_client_name = end client.
    // The broker branch returns the broker, which matches what
    // customer_name already is — so behavior is unchanged for orders
    // (which is the test name's point: no regression).
    const order = {
      broker_id: "b1",
      broker_name: "Jane Doe",
      broker_company: "BrokerCo",
      customer_name: "Jane Doe",           // already the broker (set by builder)
      broker_client_name: "TEST CLIENT",   // end client
    };
    expect(resolveJobLabel(order, customers)).toBe("BrokerCo");
  });
});
