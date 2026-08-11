import { describe, it, expect } from "vitest";
import {
  isKnownQbPaymentLink,
  linkShape,
  summarizePayLinkHealth,
  shouldSendPayLinkAlert,
  buildPayLinkAlertText,
} from "../qbPayLinkAlert.js";

// LOCKSTEP CANARY: these fixtures mirror src/lib/payment/__tests__/
// resolveCheckoutTarget.test.js. If one suite changes, change the other.
const GOOD_LONG = "https://connect.intuit.com/portal/app/CommerceNetwork/view/scs-v1-abc";
const GOOD_SHORT = "https://connect.intuit.com/t/scs-v1-abc-1";
const BAD_LEGACY = "https://connect.intuit.com/portal/asei/CommerceNetwork/consumer/view-invoice?x=1";
const BAD_LOGIN = "https://app.qbo.intuit.com/app/invoice?txnId=1";

describe("isKnownQbPaymentLink (server mirror)", () => {
  it("accepts both share-link forms", () => {
    expect(isKnownQbPaymentLink(GOOD_LONG)).toBe(true);
    expect(isKnownQbPaymentLink(GOOD_SHORT)).toBe(true);
  });
  it("rejects legacy portal, login hosts, and junk", () => {
    expect(isKnownQbPaymentLink(BAD_LEGACY)).toBe(false);
    expect(isKnownQbPaymentLink(BAD_LOGIN)).toBe(false);
    expect(isKnownQbPaymentLink("not-a-url")).toBe(false);
    expect(isKnownQbPaymentLink(null)).toBe(false);
  });
});

describe("summarize + alert decision", () => {
  const rows = [
    { quote_id: "Q-1", shop_owner: "a@x.co", qb_payment_link: GOOD_SHORT },
    { quote_id: "Q-2", shop_owner: "b@x.co", qb_payment_link: "https://connect.intuit.com/newthing/scs-v2-zzz" },
  ];
  it("flags only unrecognized links", () => {
    const s = summarizePayLinkHealth(rows);
    expect(s.checked).toBe(2);
    expect(s.failing.map((f) => f.quote_id)).toEqual(["Q-2"]);
    expect(shouldSendPayLinkAlert(s)).toBe(true);
    expect(shouldSendPayLinkAlert(summarizePayLinkHealth([rows[0]]))).toBe(false);
  });
  it("alert text names the URL shape without leaking the token", () => {
    const s = summarizePayLinkHealth(rows);
    const text = buildPayLinkAlertText(s);
    expect(text).toContain("connect.intuit.com/newthing/scs-v2-zzz");
    expect(text).toContain("Q-2");
    expect(text).toContain("resolveCheckoutTarget.js");
  });
  it("linkShape truncates deep paths and survives junk", () => {
    expect(linkShape("https://connect.intuit.com/a/b/c/d")).toBe("connect.intuit.com/a/b/…");
    expect(linkShape("garbage")).toBe("garbage");
  });
});
