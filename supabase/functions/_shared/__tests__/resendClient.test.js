// Retry contract for the shared Resend transport. Everything is injected
// (fetchImpl, sleep, apiKey) so these pin behavior without network or
// real timers.
import { describe, it, expect } from "vitest";
import {
  sendResendEmail,
  sendResendEmails,
  resendRetryDelayMs,
  isRetryableResendStatus,
  RESEND_MAX_ATTEMPTS,
} from "../resendClient.js";

const okResponse = (id = "re_123") => ({
  ok: true,
  status: 200,
  json: async () => ({ id }),
});

const errResponse = (status, retryAfter = null) => ({
  ok: false,
  status,
  headers: { get: (h) => (h === "retry-after" ? retryAfter : null) },
  text: async () => `{"message":"err ${status}"}`,
  json: async () => ({ message: `err ${status}` }),
});

function harness(responses) {
  const calls = [];
  const sleeps = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  const sleep = async (ms) => { sleeps.push(ms); };
  return { calls, sleeps, fetchImpl, sleep };
}

const PAYLOAD = { from: "InkTracker <quotes@inktracker.app>", to: ["a@b.co"], subject: "s", html: "<p>x</p>" };

describe("sendResendEmail — success path", () => {
  it("returns ok + Resend message id on first success", async () => {
    const h = harness([okResponse("re_abc")]);
    const r = await sendResendEmail(PAYLOAD, { apiKey: "k", fetchImpl: h.fetchImpl, sleep: h.sleep });
    expect(r).toEqual({ ok: true, id: "re_abc", status: 200, reason: null });
    expect(h.calls.length).toBe(1);
    expect(h.sleeps).toEqual([]);
  });

  it("sends the payload and auth header verbatim", async () => {
    const h = harness([okResponse()]);
    await sendResendEmail(PAYLOAD, { apiKey: "secret-key", fetchImpl: h.fetchImpl, sleep: h.sleep });
    expect(h.calls[0].url).toBe("https://api.resend.com/emails");
    expect(h.calls[0].init.headers.Authorization).toBe("Bearer secret-key");
    expect(JSON.parse(h.calls[0].init.body)).toEqual(PAYLOAD);
  });

  it("missing api key short-circuits without a network call", async () => {
    const h = harness([]);
    const r = await sendResendEmail(PAYLOAD, { apiKey: "", env: { get: () => "" }, fetchImpl: h.fetchImpl, sleep: h.sleep });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no_api_key");
    expect(h.calls.length).toBe(0);
  });
});

describe("sendResendEmail — retry on 429/5xx/network", () => {
  it("retries a 429 honoring Retry-After seconds, then succeeds", async () => {
    const h = harness([errResponse(429, "2"), okResponse("re_after_429")]);
    const r = await sendResendEmail(PAYLOAD, { apiKey: "k", fetchImpl: h.fetchImpl, sleep: h.sleep });
    expect(r.ok).toBe(true);
    expect(r.id).toBe("re_after_429");
    expect(h.calls.length).toBe(2);
    expect(h.sleeps).toEqual([2000]); // Retry-After: 2 → 2000ms
  });

  it("caps an absurd Retry-After at 5s (edge functions have a wall clock)", async () => {
    const h = harness([errResponse(429, "120"), okResponse()]);
    await sendResendEmail(PAYLOAD, { apiKey: "k", fetchImpl: h.fetchImpl, sleep: h.sleep });
    expect(h.sleeps).toEqual([5000]);
  });

  it("retries a 500 with exponential backoff and gives up after max attempts", async () => {
    const h = harness([errResponse(500), errResponse(502), errResponse(503)]);
    const r = await sendResendEmail(PAYLOAD, { apiKey: "k", fetchImpl: h.fetchImpl, sleep: h.sleep });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("resend_503");
    expect(r.status).toBe(503);
    expect(h.calls.length).toBe(RESEND_MAX_ATTEMPTS);
    expect(h.sleeps).toEqual([400, 800]); // 400*2^0, 400*2^1
  });

  it("retries network throws and reports reason 'network' if all fail", async () => {
    const h = harness([new Error("boom"), new Error("boom"), new Error("boom")]);
    const r = await sendResendEmail(PAYLOAD, { apiKey: "k", fetchImpl: h.fetchImpl, sleep: h.sleep });
    expect(r).toEqual({ ok: false, id: null, status: 0, reason: "network" });
    expect(h.calls.length).toBe(RESEND_MAX_ATTEMPTS);
  });

  it("does NOT retry a non-429 4xx — the request won't get better", async () => {
    const h = harness([errResponse(422)]);
    const r = await sendResendEmail(PAYLOAD, { apiKey: "k", fetchImpl: h.fetchImpl, sleep: h.sleep });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("resend_422");
    expect(h.calls.length).toBe(1);
    expect(h.sleeps).toEqual([]);
  });
});

describe("sendResendEmails — sequential multi-send", () => {
  it("sends payloads one at a time, in order, and returns all results", async () => {
    const h = harness([okResponse("re_1"), errResponse(422), okResponse("re_3")]);
    const rs = await sendResendEmails(
      [PAYLOAD, PAYLOAD, PAYLOAD],
      { apiKey: "k", fetchImpl: h.fetchImpl, sleep: h.sleep },
    );
    expect(rs.map((r) => r.ok)).toEqual([true, false, true]);
    expect(rs[0].id).toBe("re_1");
    expect(h.calls.length).toBe(3);
  });
});

describe("pure helpers", () => {
  it("resendRetryDelayMs prefers Retry-After, falls back to exponential", () => {
    expect(resendRetryDelayMs("3", 0)).toBe(3000);
    expect(resendRetryDelayMs(null, 0)).toBe(400);
    expect(resendRetryDelayMs(null, 1)).toBe(800);
    expect(resendRetryDelayMs("not-a-number", 2)).toBe(1600);
    expect(resendRetryDelayMs(null, 10)).toBe(5000); // capped
  });

  it("isRetryableResendStatus: 429 + 5xx yes, other 4xx no", () => {
    expect(isRetryableResendStatus(429)).toBe(true);
    expect(isRetryableResendStatus(500)).toBe(true);
    expect(isRetryableResendStatus(503)).toBe(true);
    expect(isRetryableResendStatus(422)).toBe(false);
    expect(isRetryableResendStatus(401)).toBe(false);
  });
});
