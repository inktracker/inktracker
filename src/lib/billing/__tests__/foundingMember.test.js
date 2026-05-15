import { describe, it, expect } from "vitest";
import {
  decidePriceTier,
  PRICE_TIER,
  FOUNDING_MEMBER_CAP,
} from "../foundingMember";

describe("FOUNDING_MEMBER_CAP", () => {
  it("is exported as 50 — must match the cap inside claim_founding_slot SQL function", () => {
    // If you change this, also change v_cap in
    // 20260520_founding_member_program.sql.
    expect(FOUNDING_MEMBER_CAP).toBe(50);
  });
});

describe("decidePriceTier — founding path", () => {
  it("maps status='claimed' to FOUNDING", () => {
    const r = decidePriceTier({ status: "claimed", cap: 50 });
    expect(r.tier).toBe(PRICE_TIER.FOUNDING);
    expect(r.reason).toBe("claimed");
    expect(r.isError).toBe(false);
  });

  it("maps status='already_member' to FOUNDING (idempotent re-call)", () => {
    const r = decidePriceTier({ status: "already_member", cap: 50, claimed_at: "2026-05-12T00:00:00Z" });
    expect(r.tier).toBe(PRICE_TIER.FOUNDING);
    expect(r.reason).toBe("already_member");
    expect(r.isError).toBe(false);
  });
});

describe("decidePriceTier — standard path", () => {
  it("maps status='cap_reached' to STANDARD — slot 50+1 pays $99", () => {
    const r = decidePriceTier({ status: "cap_reached", cap: 50 });
    expect(r.tier).toBe(PRICE_TIER.STANDARD);
    expect(r.reason).toBe("cap_reached");
    expect(r.isError).toBe(false);
  });

  it("maps status='forfeited' to STANDARD — prior canceler pays $99 forever", () => {
    const r = decidePriceTier({ status: "forfeited", cap: 50 });
    expect(r.tier).toBe(PRICE_TIER.STANDARD);
    expect(r.reason).toBe("forfeited");
    expect(r.isError).toBe(false);
  });
});

describe("decidePriceTier — error path", () => {
  it("flags status='no_profile' as error — caller bug, abort checkout", () => {
    const r = decidePriceTier({ status: "no_profile" });
    expect(r.tier).toBeNull();
    expect(r.isError).toBe(true);
  });

  it("flags status='bad_input' as error", () => {
    const r = decidePriceTier({ status: "bad_input" });
    expect(r.tier).toBeNull();
    expect(r.isError).toBe(true);
  });

  it("flags unknown status as error — never silently default a customer to a wrong price", () => {
    const r = decidePriceTier({ status: "huh_what" });
    expect(r.tier).toBeNull();
    expect(r.isError).toBe(true);
    expect(r.reason).toMatch(/unknown/);
  });

  it("flags null/undefined/non-object data as error", () => {
    expect(decidePriceTier(null).isError).toBe(true);
    expect(decidePriceTier(undefined).isError).toBe(true);
    expect(decidePriceTier("not an object").isError).toBe(true);
    expect(decidePriceTier(42).isError).toBe(true);
  });
});

describe("PRICE_TIER constants — exact strings to avoid drift", () => {
  it("FOUNDING is exactly 'founding'", () => {
    expect(PRICE_TIER.FOUNDING).toBe("founding");
  });
  it("STANDARD is exactly 'standard'", () => {
    expect(PRICE_TIER.STANDARD).toBe("standard");
  });
});

describe("decidePriceTier — invariant: never returns BOTH a tier AND an error", () => {
  // Belt-and-suspenders contract test — when isError is true, tier
  // must be null. The billing edge function relies on this to refuse
  // checkout on any unexpected state.
  const cases = [
    { status: "claimed" },
    { status: "already_member" },
    { status: "cap_reached" },
    { status: "forfeited" },
    { status: "no_profile" },
    { status: "bad_input" },
    { status: "weird_unknown_status" },
    null,
    undefined,
    "not an object",
  ];

  for (const c of cases) {
    it(`invariant holds for ${JSON.stringify(c)}`, () => {
      const r = decidePriceTier(c);
      if (r.isError) expect(r.tier).toBeNull();
      else expect(r.tier).not.toBeNull();
    });
  }
});
