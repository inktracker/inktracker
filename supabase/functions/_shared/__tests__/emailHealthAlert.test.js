import { describe, it, expect } from "vitest";
import {
  summarizeNotificationFailures,
  shouldSendEmailHealthAlert,
  buildEmailHealthAlertText,
} from "../emailHealthAlert.js";

const row = (over = {}) => ({
  status: "failed",
  failure_reason: "resend_403",
  event_type: "quote_approval",
  shop_owner: "kato@thunder-house.com",
  ...over,
});

describe("summarizeNotificationFailures", () => {
  it("counts failures by reason, event type, and shop", () => {
    const rows = [
      row(),
      row({ event_type: "quote_payment" }),
      row({ failure_reason: "resend_401", shop_owner: "joe@biotamfg.co" }),
      row({ status: "sent" }),
      row({ status: "skipped" }),
    ];
    const s = summarizeNotificationFailures(rows);
    expect(s.total).toBe(5);
    expect(s.failed).toBe(3);
    expect(s.byReason).toEqual({ resend_403: 2, resend_401: 1 });
    expect(s.byEvent).toEqual({ quote_approval: 2, quote_payment: 1 });
    expect(s.shops).toEqual(["joe@biotamfg.co", "kato@thunder-house.com"]);
  });

  it("tolerates empty/missing input and null fields", () => {
    expect(summarizeNotificationFailures([]).failed).toBe(0);
    expect(summarizeNotificationFailures(undefined).failed).toBe(0);
    const s = summarizeNotificationFailures([
      row({ failure_reason: null, event_type: null, shop_owner: null }),
    ]);
    expect(s.byReason).toEqual({ unknown: 1 });
    expect(s.byEvent).toEqual({ unknown: 1 });
    expect(s.shops).toEqual([]);
  });
});

describe("shouldSendEmailHealthAlert", () => {
  it("fires on a single failure — retries already happened upstream", () => {
    expect(shouldSendEmailHealthAlert({ failed: 1 })).toBe(true);
    expect(shouldSendEmailHealthAlert({ failed: 40 })).toBe(true);
  });

  it("stays quiet when everything sent", () => {
    expect(shouldSendEmailHealthAlert({ failed: 0 })).toBe(false);
    expect(shouldSendEmailHealthAlert({})).toBe(false);
    expect(shouldSendEmailHealthAlert(undefined)).toBe(false);
  });
});

describe("buildEmailHealthAlertText", () => {
  const summary = summarizeNotificationFailures([
    row(),
    row({ event_type: "quote_payment" }),
  ]);

  it("leads with the failure count and window", () => {
    const text = buildEmailHealthAlertText(summary);
    expect(text).toContain("2 of 2 notification email(s) FAILED in the last 24h");
  });

  it("names the reasons, events, affected shops, and triage steps", () => {
    const text = buildEmailHealthAlertText(summary);
    expect(text).toContain("resend_403: 2");
    expect(text).toContain("quote_approval: 1");
    expect(text).toContain("kato@thunder-house.com");
    expect(text).toContain("info.inktracker.app");
    expect(text).toContain("notification_log");
  });

  it("reproduces the June outage shape (the exact incident this watches for)", () => {
    // 40/40 failed, all resend_403 — the summary the operator SHOULD have
    // received on June 2 instead of discovering it a month later.
    const outage = summarizeNotificationFailures(
      Array.from({ length: 40 }, (_, i) =>
        row({ event_type: i % 2 ? "quote_payment" : "quote_approval" }),
      ),
    );
    expect(shouldSendEmailHealthAlert(outage)).toBe(true);
    const text = buildEmailHealthAlertText(outage);
    expect(text).toContain("40 of 40");
    expect(text).toContain("resend_403: 40");
  });
});
