import { describe, it, expect } from "vitest";
import { sentAge, STALE_AFTER_DAYS } from "../sentAge";

const DAY = 86400000;
const NOW = new Date("2026-08-31T12:00:00Z").getTime();

describe("sentAge", () => {
  it("says nothing without a usable date", () => {
    expect(sentAge(null, NOW)).toBeNull();
    expect(sentAge("", NOW)).toBeNull();
    expect(sentAge("not-a-date", NOW)).toBeNull();
  });

  it("says nothing for future dates (clock skew)", () => {
    expect(sentAge(new Date(NOW + DAY).toISOString(), NOW)).toBeNull();
  });

  it("labels today / yesterday / N days", () => {
    expect(sentAge(new Date(NOW - 2 * 3600000).toISOString(), NOW)).toEqual({ label: "Sent today", stale: false });
    expect(sentAge(new Date(NOW - DAY).toISOString(), NOW)).toEqual({ label: "Sent yesterday", stale: false });
    expect(sentAge(new Date(NOW - 3 * DAY).toISOString(), NOW)).toEqual({ label: "Sent 3 days ago", stale: false });
  });

  it("flips stale at the threshold", () => {
    const just = sentAge(new Date(NOW - (STALE_AFTER_DAYS - 1) * DAY).toISOString(), NOW);
    const at = sentAge(new Date(NOW - STALE_AFTER_DAYS * DAY).toISOString(), NOW);
    expect(just.stale).toBe(false);
    expect(at.stale).toBe(true);
    expect(at.label).toBe(`Sent ${STALE_AFTER_DAYS} days ago`);
  });
});
