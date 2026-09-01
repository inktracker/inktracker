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

  it("labels today / yesterday / N days while waiting", () => {
    expect(sentAge(new Date(NOW - 2 * 3600000).toISOString(), NOW)).toEqual({ label: "Today · waiting", stale: false });
    expect(sentAge(new Date(NOW - DAY).toISOString(), NOW)).toEqual({ label: "Yesterday · waiting", stale: false });
    expect(sentAge(new Date(NOW - 3 * DAY).toISOString(), NOW)).toEqual({ label: "3 days · waiting", stale: false });
  });

  it("switches to 'no reply' and stale at the threshold", () => {
    const just = sentAge(new Date(NOW - (STALE_AFTER_DAYS - 1) * DAY).toISOString(), NOW);
    const at = sentAge(new Date(NOW - STALE_AFTER_DAYS * DAY).toISOString(), NOW);
    expect(just).toEqual({ label: `${STALE_AFTER_DAYS - 1} days · waiting`, stale: false });
    expect(at).toEqual({ label: `${STALE_AFTER_DAYS} days · no reply`, stale: true });
  });
});
