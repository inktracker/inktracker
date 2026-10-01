import { describe, it, expect } from "vitest";
import { isQuoteDateExpired } from "../quoteExpiry";

describe("isQuoteDateExpired — valid through the END of expires_date, local time", () => {
  it("NOT expired on the expiry date itself (any hour — the day-early bug)", () => {
    // 6pm local on the expiry date: the old `new Date("2026-08-11") < new Date()`
    // compare already called this expired for US viewers.
    expect(isQuoteDateExpired("2026-08-11", new Date(2026, 7, 11, 18, 0, 0))).toBe(false);
    expect(isQuoteDateExpired("2026-08-11", new Date(2026, 7, 11, 23, 59, 0))).toBe(false);
  });

  it("expired the day after", () => {
    expect(isQuoteDateExpired("2026-08-11", new Date(2026, 7, 12, 0, 1, 0))).toBe(true);
  });

  it("not expired before the date", () => {
    expect(isQuoteDateExpired("2026-08-11", new Date(2026, 7, 10, 12, 0, 0))).toBe(false);
  });

  it("no expiry date → never expired", () => {
    expect(isQuoteDateExpired(null)).toBe(false);
    expect(isQuoteDateExpired("")).toBe(false);
  });
});
