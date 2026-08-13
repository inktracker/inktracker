import { describe, it, expect } from "vitest";
import {
  summarizeGrowth,
  buildGrowthReportText,
  buildGrowthReportSubject,
  buildThresholdWatchText,
} from "../growthReport.js";

const NOW = Date.parse("2026-08-10T15:00:00Z");
const days = (n) => new Date(NOW + n * 86400000).toISOString();

const profile = (over = {}) => ({
  email: "shop@x.co",
  shop_name: "X Prints",
  company_name: null,
  subscription_tier: "trial",
  subscription_status: "trialing",
  trial_ends_at: days(10),
  created_at: days(-4),
  ...over,
});

describe("summarizeGrowth", () => {
  it("buckets signups, trials, ending-soon, expired, and paying", () => {
    const s = summarizeGrowth({
      profiles: [
        profile({ email: "new@a.co", created_at: days(-2), trial_ends_at: days(12) }),
        profile({ email: "ending@b.co", created_at: days(-11), trial_ends_at: days(3) }),
        profile({ email: "expired@c.co", created_at: days(-16), trial_ends_at: days(-2) }),
        profile({ email: "old-expired@d.co", created_at: days(-60), trial_ends_at: days(-30) }),
        profile({ email: "paying@e.co", created_at: days(-40), subscription_tier: "shop", subscription_status: "active", trial_ends_at: null }),
        profile({ email: "canceled@f.co", created_at: days(-40), subscription_tier: "shop", subscription_status: "canceled", trial_ends_at: null }),
      ],
      quoteOwners: ["ending@b.co", "ending@b.co"],
      orderCount7d: 5,
    }, NOW);

    expect(s.newSignups.map((x) => x.email)).toEqual(["new@a.co"]);
    expect(s.activeTrials.map((x) => x.email)).toEqual(["ending@b.co", "new@a.co"]); // sorted by daysLeft
    expect(s.trialsEndingSoon.map((x) => x.email)).toEqual(["ending@b.co"]);
    // Only trials that lapsed WITHIN the week are churn news; day-30 stale rows aren't.
    expect(s.expiredLast7d.map((x) => x.email)).toEqual(["expired@c.co"]);
    expect(s.payingShops).toBe(1); // canceled doesn't count
    expect(s.payingIsEstimate).toBe(true); // no stripe set supplied
    expect(s.quotes7d).toBe(2);
    expect(s.orders7d).toBe(5);
  });

  it("PAYING requires a real Stripe subscription — comps/demo count as comped, never paying", () => {
    const s = summarizeGrowth({
      profiles: [
        profile({ email: "kato@t.com", subscription_tier: "shop", subscription_status: "active", trial_ends_at: null, created_at: days(-40) }),
        profile({ email: "comp@e.co", subscription_tier: "shop", subscription_status: "active", trial_ends_at: null, created_at: days(-40) }),
        profile({ email: "demo@x.app", subscription_tier: "shop", subscription_status: "active", trial_ends_at: null, created_at: days(-40) }),
      ],
      quoteOwners: [],
      orderCount7d: 0,
      stripeSubEmails: ["KATO@T.COM"], // case-insensitive
    }, NOW);
    expect(s.payingShops).toBe(1);
    expect(s.compedShops).toBe(2);
    expect(s.payingIsEstimate).toBe(false);
  });

  it("counts per-owner weekly quotes for the activation flag", () => {
    const s = summarizeGrowth({
      profiles: [profile({ email: "a@a.co" }), profile({ email: "b@b.co" })],
      quoteOwners: ["a@a.co", "a@a.co", "a@a.co"],
    }, NOW);
    const byEmail = Object.fromEntries(s.activeTrials.map((x) => [x.email, x.quotes7d]));
    expect(byEmail["a@a.co"]).toBe(3);
    expect(byEmail["b@b.co"]).toBe(0);
  });

  it("tolerates malformed timestamps and empty inputs", () => {
    const s = summarizeGrowth({
      profiles: [profile({ created_at: "not-a-date", trial_ends_at: null })],
      quoteOwners: null,
    }, NOW);
    expect(s.newSignups).toEqual([]);
    expect(s.activeTrials).toEqual([]);
    expect(buildGrowthReportText(s)).toContain("• none");
  });
});

describe("report formatting", () => {
  const stats = () => summarizeGrowth({
    profiles: [
      profile({ email: "quiet@x.co", shop_name: "Quiet Shop", trial_ends_at: days(9), created_at: days(-10) }),
    ],
    quoteOwners: [],
    orderCount7d: 0,
  }, NOW);

  it("flags unactivated trials", () => {
    expect(buildGrowthReportText(stats())).toContain("not activated");
  });

  it("subject carries the three headline numbers", () => {
    expect(buildGrowthReportSubject(stats())).toBe(
      "[InkTracker] Weekly growth: 0 signup(s), 1 trial(s), 0 paying",
    );
  });
});

describe("threshold watch (2026-08-13 'monitor those things')", () => {
  const base = { newSignups: [], activeTrials: [], trialsEndingSoon: [], expiredLast7d: [], quotes7d: 0, orders7d: 0, compedShops: 0, payingIsEstimate: false, emails30d: 100, resendMonthlyCap: 3000 };
  it("below warn: neutral progress line naming the 10-shop triggers", () => {
    const t = buildThresholdWatchText({ ...base, payingShops: 2 });
    expect(t).toContain("2 paying shop(s) of 10");
    expect(t).toContain("QB Partner Silver");
    expect(t).not.toContain("⚠");
  });
  it("at 8: approaching warning", () => {
    const t = buildThresholdWatchText({ ...base, payingShops: 8 });
    expect(t).toContain("⚠ 8 paying shops");
    expect(t).toContain("approaching");
  });
  it("at 10+: triggers DUE", () => {
    const t = buildThresholdWatchText({ ...base, payingShops: 11 });
    expect(t).toContain("🔔 11 paying shops");
    expect(t).toContain("Intuit App Assessment");
  });
  it("estimate flag surfaces when the Stripe lookup failed", () => {
    const t = buildThresholdWatchText({ ...base, payingShops: 6, payingIsEstimate: true });
    expect(t).toContain("ESTIMATE");
  });
  it("Resend cap: neutral under 80%, warns at 80%, alarms at 100%", () => {
    expect(buildThresholdWatchText({ ...base, payingShops: 2, emails30d: 500 })).toContain("17% of the 3000/mo");
    expect(buildThresholdWatchText({ ...base, payingShops: 2, emails30d: 2500 })).toContain("⚠ Email volume 2500/30d is 83%");
    expect(buildThresholdWatchText({ ...base, payingShops: 2, emails30d: 3100 })).toContain("🔔 Email volume 3100/30d is AT/OVER");
  });
  it("comped count is disclosed", () => {
    const t = buildThresholdWatchText({ ...base, payingShops: 2, compedShops: 3 });
    expect(t).toContain("3 comped/demo shop(s) excluded");
  });
});
