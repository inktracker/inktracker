import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseRetryAfterMs,
  QbRateLimitError,
  QbUnreachableError,
  QB_RATE_LIMIT_RETRY_AFTER_CAP_MS,
} from "../qbRateLimit.ts";

describe("parseRetryAfterMs", () => {
  it("returns null for null / undefined / empty", () => {
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs(undefined)).toBeNull();
    expect(parseRetryAfterMs("")).toBeNull();
    expect(parseRetryAfterMs("   ")).toBeNull();
  });

  it("parses integer seconds → ms", () => {
    expect(parseRetryAfterMs("3")).toBe(3000);
    expect(parseRetryAfterMs(" 5 ")).toBe(5000);
    expect(parseRetryAfterMs("0")).toBe(0);
  });

  it("caps at the configured ceiling so a 9999-second hint can't hang the function", () => {
    expect(parseRetryAfterMs("9999")).toBe(QB_RATE_LIMIT_RETRY_AFTER_CAP_MS);
  });

  it("ignores negative seconds", () => {
    expect(parseRetryAfterMs("-1")).toBeNull();
  });

  it("ignores non-numeric, non-date garbage", () => {
    expect(parseRetryAfterMs("soon")).toBeNull();
    expect(parseRetryAfterMs("Tomorrow")).toBeNull();
  });
});

describe("parseRetryAfterMs HTTP-date form", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-09T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses HTTP-date and returns delta (capped)", () => {
    // 3 seconds in the future → 3000ms (under cap)
    const v = parseRetryAfterMs("Tue, 09 Jun 2026 12:00:03 GMT");
    expect(v).toBe(3000);
  });

  it("returns 0 when the date is already past", () => {
    expect(parseRetryAfterMs("Tue, 09 Jun 2026 11:59:00 GMT")).toBe(0);
  });

  it("caps far-future dates at the ceiling", () => {
    // 1 hour in the future → way past cap
    expect(parseRetryAfterMs("Tue, 09 Jun 2026 13:00:00 GMT"))
      .toBe(QB_RATE_LIMIT_RETRY_AFTER_CAP_MS);
  });
});

describe("QbRateLimitError", () => {
  it("carries the action label + retry-after seconds", () => {
    const e = new QbRateLimitError("create invoice", 4);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("QbRateLimitError");
    expect(e.label).toBe("create invoice");
    expect(e.retryAfterSeconds).toBe(4);
    expect(e.message).toContain("create invoice");
    expect(e.message).toContain("4s");
  });

  it("can be detected via instanceof — the dispatcher relies on this to surface qb_rate_limited", () => {
    const e = new QbRateLimitError("send invoice/123", 2);
    expect(e instanceof QbRateLimitError).toBe(true);
    expect(e instanceof Error).toBe(true);
  });
});

describe("QbUnreachableError", () => {
  it("carries the action label and reads as an Error", () => {
    const e = new QbUnreachableError("query");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("QbUnreachableError");
    expect(e.label).toBe("query");
    expect(e.message).toContain("query");
    expect(e.message).toContain("did not respond");
  });

  it("is distinguishable from QbRateLimitError via instanceof — the dispatcher branches separately", () => {
    const unreachable = new QbUnreachableError("create invoice");
    const rateLimited = new QbRateLimitError("create invoice", 3);
    expect(unreachable instanceof QbUnreachableError).toBe(true);
    expect(unreachable instanceof QbRateLimitError).toBe(false);
    expect(rateLimited instanceof QbUnreachableError).toBe(false);
  });
});
