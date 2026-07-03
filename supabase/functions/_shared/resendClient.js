// Shared Resend transport with retry + backoff. Every edge-function email
// send goes through sendResendEmail — no call site should fetch
// api.resend.com directly. Before this existed, a Resend 429/5xx or a
// network blip was a silent, permanent loss of the email at every call
// site (pre-scale audit, 2026-07-02) — including MFA sign-in codes, where
// a dropped email blocks login.
//
// Retry policy: up to RESEND_MAX_ATTEMPTS total attempts on 429, 5xx, and
// network throws. 429 honors the Retry-After header (capped — edge
// functions have a wall clock, we'd rather fail than hang); everything
// else backs off exponentially. Non-429 4xx (bad payload, bad key) never
// retries — the request won't get better.
//
// Node/Deno portable like approvalNotificationEmail.js: env, fetch, and
// sleep are injectable so vitest can pin the retry contract without
// real timers or network.

export const RESEND_MAX_ATTEMPTS = 3;
const RETRY_AFTER_CAP_MS = 5000;
const BASE_DELAY_MS = 400;

// Pure — exported for tests.
export function resendRetryDelayMs(retryAfterHeader, attempt) {
  const parsed = Number(retryAfterHeader);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(parsed * 1000, RETRY_AFTER_CAP_MS);
  }
  return Math.min(BASE_DELAY_MS * 2 ** attempt, RETRY_AFTER_CAP_MS);
}

export function isRetryableResendStatus(status) {
  return status === 429 || status >= 500;
}

/**
 * @param {object} payload  Resend /emails body (from, to, subject, html, …)
 * @param {object} [opts]   { apiKey, env, fetchImpl, sleep } — test seams
 * @returns {Promise<{ok: boolean, id: string|null, status: number, reason: string|null}>}
 *   Never throws. `id` is Resend's message id on success (feeds
 *   notification_log.resend_id). `reason` mirrors the existing
 *   'resend_<status>' / 'no_api_key' / 'network' vocabulary.
 */
export async function sendResendEmail(payload, opts = {}) {
  const runtimeEnv = opts.env ?? (typeof Deno !== "undefined" ? Deno.env : undefined);
  const apiKey = opts.apiKey ?? runtimeEnv?.get?.("RESEND_API_KEY") ?? "";
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  if (!apiKey) return { ok: false, id: null, status: 0, reason: "no_api_key" };

  let lastStatus = 0;
  let lastReason = "network";
  for (let attempt = 0; attempt < RESEND_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        let id = null;
        try {
          id = (await res.json())?.id ?? null;
        } catch { /* body is optional — the send already succeeded */ }
        return { ok: true, id, status: res.status, reason: null };
      }
      lastStatus = res.status;
      lastReason = `resend_${res.status}`;
      const body = await res.text().catch(() => "");
      console.error("[resend] error:", res.status, body.slice(0, 300));
      if (!isRetryableResendStatus(res.status)) break;
      if (attempt < RESEND_MAX_ATTEMPTS - 1) {
        await sleep(resendRetryDelayMs(res.headers?.get?.("retry-after"), attempt));
      }
    } catch (err) {
      lastStatus = 0;
      lastReason = "network";
      console.error("[resend] threw:", err?.message || err);
      if (attempt < RESEND_MAX_ATTEMPTS - 1) {
        await sleep(resendRetryDelayMs(null, attempt));
      }
    }
  }
  return { ok: false, id: null, status: lastStatus, reason: lastReason };
}

/**
 * Sequential multi-payload send. Resend's default account limit is
 * ~2 requests/second SHARED across every function and every shop —
 * Promise.all fan-out is exactly the shape that trips it. Recipient
 * counts here are small (1–3); latency cost is negligible.
 */
export async function sendResendEmails(payloads, opts) {
  const results = [];
  for (const payload of payloads) {
    results.push(await sendResendEmail(payload, opts));
  }
  return results;
}
