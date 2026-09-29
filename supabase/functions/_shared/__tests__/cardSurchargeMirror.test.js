import { describe, it, expect } from "vitest";
import { customerFacingShopPayload } from "../publicSafe.js";
import { getCardSurcharge } from "../../../../src/lib/payment/cardSurcharge.js";

// publicSafe.js carries a MIRROR of getCardSurcharge (Deno can't import from
// src/). This pins the two together: same inputs, same answer, forever.
const CONFIGS = [
  undefined, null, {},
  { cardSurcharge: null },
  { cardSurcharge: {} },
  { cardSurcharge: { enabled: false, ratePct: 3 } },
  { cardSurcharge: { enabled: "true", ratePct: 3 } },
  { cardSurcharge: { enabled: true } },
  { cardSurcharge: { enabled: true, ratePct: 3 } },
  { cardSurcharge: { enabled: true, ratePct: 2.9 } },
  { cardSurcharge: { enabled: true, ratePct: 0 } },
  { cardSurcharge: { enabled: true, ratePct: -1 } },
  { cardSurcharge: { enabled: true, ratePct: "abc" } },
  { cardSurcharge: { enabled: true, ratePct: 29 } },
];

const shopWith = (pricing_config) => ({
  owner_email: "owner@example.com",
  shop_name: "Test Shop",
  stripe_account_id: "acct_secret",
  stripe_account_status: "active",
  pricing_config,
});

describe("publicSafe card-surcharge mirror stays in lockstep with src/lib/payment/cardSurcharge", () => {
  it.each(CONFIGS.map((c, i) => [i, c]))("config #%i agrees", (_i, config) => {
    const canonical = getCardSurcharge(config);
    const payload = customerFacingShopPayload({ shop: shopWith(config), doc: {}, brokerProfile: null });
    if (canonical.enabled) {
      expect(payload.card_surcharge).toEqual({ enabled: true, rate_pct: canonical.ratePct });
    } else {
      expect(payload.card_surcharge).toBeUndefined();
    }
  });
});

describe("the anonymous shop payload never leaks shop internals", () => {
  const config = { cardSurcharge: { enabled: true, ratePct: 3 }, screenPrint: { enabled: true }, markup: 2.4, blankCost: 4.5 };
  const payload = customerFacingShopPayload({ shop: shopWith(config), doc: {}, brokerProfile: null });

  it("strips pricing_config entirely — margins/markups never reach a customer", () => {
    expect(payload.pricing_config).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain("markup");
    expect(JSON.stringify(payload)).not.toContain("blankCost");
  });

  it("still strips the Stripe + owner fields it always did", () => {
    expect(payload.stripe_account_id).toBeUndefined();
    expect(payload.stripe_account_status).toBeUndefined();
    expect(payload.owner_email).toBeUndefined();
    expect(payload.shop_name).toBe("Test Shop");
  });

  it("emits only the two scalars the disclosure needs", () => {
    expect(Object.keys(payload.card_surcharge).sort()).toEqual(["enabled", "rate_pct"]);
  });

  it("a BROKER quote never advertises the shop's surcharge to the end client", () => {
    const brokerPayload = customerFacingShopPayload({
      shop: shopWith(config),
      doc: { broker_id: "b@x.com", broker_company: "TTR Supply" },
      brokerProfile: { logo_url: null, phone: "555" },
    });
    expect(brokerPayload.card_surcharge).toBeUndefined();
    expect(brokerPayload.shop_name).toBe("TTR Supply");
  });
});
