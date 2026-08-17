import { describe, it, expect } from "vitest";
import {
  isUnsentSentQuote,
  summarizeUnsentQuotes,
  shouldSendUnsentQuoteAlert,
  buildUnsentQuoteAlertText,
} from "../unsentQuoteAlert.js";

const OLD = "2026-08-17T18:05:52.000Z";
// "now" well past the grace window relative to OLD
const NOW = Date.parse("2026-08-17T23:00:00.000Z");

const delivered = {
  quote_id: "Q-OK", shop_owner: "a@x.co", status: "Sent",
  sent_date: "2026-08-17T18:06:00.000Z", sent_to: "buyer@x.co", created_at: OLD,
};
// The real Q-2026-HNUD shape: QB invoice created, email never sent.
const hnud = {
  quote_id: "Q-2026-HNUD", shop_owner: "joe@biotamfg.co", status: "Sent",
  sent_date: null, sent_to: null, created_at: OLD,
};

describe("isUnsentSentQuote", () => {
  it("flags a Sent quote with no delivery record", () => {
    expect(isUnsentSentQuote(hnud, { now: NOW })).toBe(true);
  });
  it("ignores a properly delivered quote", () => {
    expect(isUnsentSentQuote(delivered, { now: NOW })).toBe(false);
  });
  it("ignores drafts and converted quotes", () => {
    expect(isUnsentSentQuote({ ...hnud, status: "Draft" }, { now: NOW })).toBe(false);
    expect(isUnsentSentQuote({ ...hnud, status: "Converted to Order" }, { now: NOW })).toBe(false);
  });
  it("treats empty strings as missing (not just null)", () => {
    expect(isUnsentSentQuote({ ...hnud, sent_to: "   ", sent_date: "" }, { now: NOW })).toBe(true);
  });
  it("flags a half-written row (date but no recipient)", () => {
    expect(isUnsentSentQuote({ ...hnud, sent_date: OLD }, { now: NOW })).toBe(true);
  });
  it("respects the grace window — a send in flight is not an alert", () => {
    const justNow = new Date(NOW - 60 * 1000).toISOString();
    expect(isUnsentSentQuote({ ...hnud, created_at: justNow }, { now: NOW })).toBe(false);
  });
  it("survives junk", () => {
    expect(isUnsentSentQuote(null, { now: NOW })).toBe(false);
    expect(isUnsentSentQuote({}, { now: NOW })).toBe(false);
  });
});

describe("summarize + alert decision", () => {
  const rows = [delivered, hnud];
  it("counts everything but flags only the undelivered", () => {
    const s = summarizeUnsentQuotes(rows, { now: NOW });
    expect(s.checked).toBe(2);
    expect(s.failing.map((f) => f.quote_id)).toEqual(["Q-2026-HNUD"]);
    expect(s.failing[0].missing).toBe("sent_date + sent_to");
    expect(shouldSendUnsentQuoteAlert(s)).toBe(true);
  });
  it("stays quiet when every quote really went out", () => {
    const s = summarizeUnsentQuotes([delivered], { now: NOW });
    expect(shouldSendUnsentQuoteAlert(s)).toBe(false);
  });
  it("alert text names the shop, the quote, and what to do", () => {
    const text = buildUnsentQuoteAlertText(summarizeUnsentQuotes(rows, { now: NOW }));
    expect(text).toContain("Q-2026-HNUD");
    expect(text).toContain("joe@biotamfg.co");
    expect(text).toContain("re-send");
    expect(text).toContain("The customer did not.");
  });
});
