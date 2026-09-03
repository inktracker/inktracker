// Daily 6am system health check. Probes every external API + internal signal
// InkTracker depends on, performs the handful of SAFE auto-fixes, and emails
// the operator a digest — green mornings included, because a silent monitor
// is indistinguishable from a healthy one (the trap that hid the pay-link
// incident and the dead reconcile cron).
//
// Triggered by .github/workflows/system-health.yml (GitHub Actions cron,
// reliable + red-❌-on-failure) with `Authorization: Bearer <CRON_SECRET>`,
// same auth as qbReconcile / lifecycleDrip.
//
// "Handled vs alerted": genuinely safe auto-fixes are a short whitelist
// (re-fire a cron that didn't run). Third-party outages, expired tokens
// needing a human reconnect, broken deploys, data drift — reported, never
// faked. On a CRITICAL failure the function also returns 503 so the workflow
// goes red and GitHub emails the operator via a SEPARATE channel from Resend
// (so a Resend outage can't mute its own alarm).

import { createClient } from "npm:@supabase/supabase-js@2.102.1";
import { extractConnectionStatus } from "../_shared/connectionLogic.js";
import {
  summarizeHealth,
  buildHealthSubject,
  buildHealthText,
  buildHealthHtml,
  OK,
  WARN,
  DOWN,
} from "../_shared/systemHealthCheck.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "quotes@info.inktracker.app";
const ADMIN_EMAIL =
  Deno.env.get("ADMIN_NOTIFY_EMAIL") || Deno.env.get("OPERATOR_ALERT_EMAIL") || "joe@biotamfg.co";
const SITE_URL = Deno.env.get("APP_URL") || "https://www.inktracker.app";
const FN_BASE = `${SUPABASE_URL}/functions/v1`;

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const STRIPE_PRICE_STANDARD = Deno.env.get("STRIPE_PRICE_STANDARD") ?? "";
const SS_ACCOUNT_NUMBER = Deno.env.get("SS_ACCOUNT_NUMBER") ?? "";
const SS_API_KEY = Deno.env.get("SS_API_KEY") ?? "";
const AC_SUB_KEY = Deno.env.get("ASCOLOUR_SUBSCRIPTION_KEY") ?? "";

function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

interface Probe {
  name: string;
  tier: "critical" | "secondary";
  ok: boolean;
  status: string;
  detail: string;
  latencyMs: number | null;
}

// A single timed fetch with a hard deadline. Never throws — returns a shape
// the probe can inspect. A timeout/network error surfaces as res:null.
async function timedFetch(url: string, init: RequestInit, timeoutMs: number) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    return { res, latencyMs: Date.now() - t0, err: null as string | null };
  } catch (e) {
    return { res: null as Response | null, latencyMs: Date.now() - t0, err: (e as Error)?.name || "error" };
  }
}

const P = (
  name: string,
  tier: "critical" | "secondary",
  ok: boolean,
  detail: string,
  latencyMs: number | null,
): Probe => ({ name, tier, ok, status: ok ? OK : tier === "critical" ? DOWN : WARN, detail, latencyMs });

// ── individual probes ────────────────────────────────────────────────────

async function probeSite(): Promise<Probe> {
  const { res, latencyMs, err } = await timedFetch(SITE_URL, { method: "GET" }, 20_000);
  if (!res) return P("Website", "critical", false, `no response (${err})`, latencyMs);
  return P("Website", "critical", res.ok, res.ok ? `${res.status}` : `HTTP ${res.status}`, latencyMs);
}

async function probeSupabaseAuth(anonKey: string): Promise<Probe> {
  const { res, latencyMs, err } = await timedFetch(
    `${SUPABASE_URL}/auth/v1/health`,
    { headers: { apikey: anonKey } },
    15_000,
  );
  if (!res) return P("Supabase auth", "critical", false, `no response (${err})`, latencyMs);
  return P("Supabase auth", "critical", res.status < 500, `HTTP ${res.status}`, latencyMs);
}

async function probeDb(admin: any): Promise<Probe> {
  const t0 = Date.now();
  const { error } = await admin.from("profiles").select("id", { count: "exact", head: true }).limit(1);
  const latencyMs = Date.now() - t0;
  return P("Supabase DB", "critical", !error, error ? error.message : "query ok", latencyMs);
}

async function probeQuickBooksReachable(): Promise<Probe> {
  // No creds needed — a valid connection 401s fast (~300ms); a QBO incident
  // (like 2026-09-01) makes this hang, which the deadline turns into `down`.
  const { res, latencyMs, err } = await timedFetch(
    "https://quickbooks.api.intuit.com/v3/company/0/companyinfo/0",
    { method: "GET" },
    12_000,
  );
  if (!res) return P("QuickBooks API", "critical", false, `unreachable (${err}) — Intuit outage?`, latencyMs);
  // Any HTTP answer (401 expected) means Intuit's API is up.
  return P("QuickBooks API", "critical", true, `reachable (HTTP ${res.status})`, latencyMs);
}

async function probeStripe(): Promise<Probe> {
  if (!STRIPE_SECRET_KEY) return P("Stripe", "critical", false, "STRIPE_SECRET_KEY unset", null);
  const path = STRIPE_PRICE_STANDARD ? `prices/${STRIPE_PRICE_STANDARD}` : "balance";
  const { res, latencyMs, err } = await timedFetch(
    `https://api.stripe.com/v1/${path}`,
    { headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` } },
    15_000,
  );
  if (!res) return P("Stripe", "critical", false, `no response (${err})`, latencyMs);
  return P("Stripe", "critical", res.ok, res.ok ? "authed ok" : `HTTP ${res.status}`, latencyMs);
}

async function probeResend(): Promise<Probe> {
  if (!RESEND_API_KEY) return P("Resend", "critical", false, "RESEND_API_KEY unset", null);
  const { res, latencyMs, err } = await timedFetch(
    "https://api.resend.com/domains",
    { headers: { Authorization: `Bearer ${RESEND_API_KEY}` } },
    15_000,
  );
  if (!res) return P("Resend", "critical", false, `no response (${err})`, latencyMs);
  return P("Resend", "critical", res.ok, res.ok ? "authed ok" : `HTTP ${res.status}`, latencyMs);
}

async function probeSS(): Promise<Probe> {
  if (!SS_ACCOUNT_NUMBER || !SS_API_KEY) return P("S&S Activewear", "secondary", false, "creds unset", null);
  const auth = btoa(`${SS_ACCOUNT_NUMBER}:${SS_API_KEY}`);
  const { res, latencyMs, err } = await timedFetch(
    "https://api.ssactivewear.com/v2/styles/?search=39",
    { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } },
    15_000,
  );
  if (!res) return P("S&S Activewear", "secondary", false, `no response (${err})`, latencyMs);
  // 200 = authed; 401/403 = reachable but creds — surface either way.
  const authed = res.status < 400;
  return P("S&S Activewear", "secondary", authed, authed ? "reachable+authed" : `HTTP ${res.status}`, latencyMs);
}

async function probeASColour(): Promise<Probe> {
  if (!AC_SUB_KEY) return P("AS Colour", "secondary", false, "subscription key unset", null);
  const { res, latencyMs, err } = await timedFetch(
    "https://api.ascolour.com/v1/products?pageSize=1",
    { headers: { "Ocp-Apim-Subscription-Key": AC_SUB_KEY, "Subscription-Key": AC_SUB_KEY } },
    15_000,
  );
  if (!res) return P("AS Colour", "secondary", false, `no response (${err})`, latencyMs);
  return P("AS Colour", "secondary", res.status < 500, `HTTP ${res.status}`, latencyMs);
}

async function probeQbTokens(admin: any): Promise<Probe> {
  const t0 = Date.now();
  const { data, error } = await admin
    .from("profile_secrets")
    .select("qb_realm_id, qb_access_token, qb_token_expires_at, qb_refresh_token_expires_at")
    .not("qb_access_token", "is", null);
  const latencyMs = Date.now() - t0;
  if (error) return P("QB tokens", "secondary", false, `could not read: ${error.message}`, latencyMs);
  const rows = data ?? [];
  if (rows.length === 0) return P("QB tokens", "secondary", true, "no shops connected", latencyMs);
  const needReconnect = rows.filter((r: any) => extractConnectionStatus(r).needsReconnect).length;
  const ok = needReconnect === 0;
  return P(
    "QB tokens",
    "secondary",
    ok,
    ok ? `${rows.length} connected, all valid` : `${needReconnect}/${rows.length} need reconnect`,
    latencyMs,
  );
}

// Did the nightly reconcile actually run? qbReconcile writes a `reconcile_run`
// marker to qb_event_log every run — a missing one for >26h means the cron
// silently stopped (Vercel-Hobby-cron trap). This one we CAN auto-fix.
async function probeReconcileRan(admin: any): Promise<{ probe: Probe; stale: boolean }> {
  const t0 = Date.now();
  const since = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("qb_event_log")
    .select("created_at")
    .eq("action", "reconcile_run")
    .gte("created_at", since)
    .limit(1);
  const latencyMs = Date.now() - t0;
  if (error) return { probe: P("Nightly reconcile", "secondary", false, `log read failed: ${error.message}`, latencyMs), stale: false };
  const ran = (data ?? []).length > 0;
  return {
    probe: P("Nightly reconcile", "secondary", ran, ran ? "ran in last 26h" : "NO run in 26h", latencyMs),
    stale: !ran,
  };
}

async function probeEmailFailures(admin: any): Promise<Probe> {
  const t0 = Date.now();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await admin
    .from("notification_log")
    .select("id", { count: "exact", head: true })
    .eq("status", "failed")
    .gte("created_at", since);
  const latencyMs = Date.now() - t0;
  if (error) return P("Email deliverability", "secondary", false, `log read failed: ${error.message}`, latencyMs);
  const n = count ?? 0;
  return P("Email deliverability", "secondary", n < 3, n === 0 ? "no failures (24h)" : `${n} failed sends (24h)`, latencyMs);
}

async function probeDataIntegrity(admin: any): Promise<Probe> {
  const t0 = Date.now();
  const { data, error } = await admin.rpc("data_integrity_violations");
  const latencyMs = Date.now() - t0;
  // The RPC is optional infra — a missing function is not a health failure.
  if (error) return P("Data integrity", "secondary", true, "check unavailable (skipped)", latencyMs);
  const n = Array.isArray(data) ? data.length : 0;
  return P("Data integrity", "secondary", n === 0, n === 0 ? "no violations" : `${n} violation(s)`, latencyMs);
}

Deno.serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response("method not allowed", { status: 405 });
  }
  const authHeader = req.headers.get("authorization") || "";
  if (!CRON_SECRET || !timingSafeEqual(authHeader, `Bearer ${CRON_SECRET}`)) {
    return new Response("unauthorized", { status: 401 });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? SUPABASE_KEY;

  // Run independent probes in parallel; each carries its own deadline.
  const [
    site, supaAuth, db, qb, stripe, resend, ss, ac, qbTokens, reconcile, emailFail, integrity,
  ] = await Promise.all([
    probeSite(),
    probeSupabaseAuth(anonKey),
    probeDb(admin),
    probeQuickBooksReachable(),
    probeStripe(),
    probeResend(),
    probeSS(),
    probeASColour(),
    probeQbTokens(admin),
    probeReconcileRan(admin),
    probeEmailFailures(admin),
    probeDataIntegrity(admin),
  ]);

  const probes: Probe[] = [
    site, supaAuth, db, qb, stripe, resend, ss, ac, qbTokens, reconcile.probe, emailFail, integrity,
  ];

  // ── safe auto-fix: re-fire a reconcile that didn't run ──
  const autofixes: Array<{ action: string; result: string; ok: boolean }> = [];
  if (reconcile.stale) {
    try {
      const r = await fetch(`${FN_BASE}/qbReconcile`, {
        method: "POST",
        headers: { Authorization: `Bearer ${CRON_SECRET}`, "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(60_000),
      });
      autofixes.push({
        action: "Re-fired nightly reconcile (was stale)",
        result: `HTTP ${r.status}`,
        ok: r.ok,
      });
      if (r.ok) reconcile.probe.ok = true; // it just ran
    } catch (e) {
      autofixes.push({ action: "Re-fire nightly reconcile", result: (e as Error)?.name || "failed", ok: false });
    }
  }

  const summary = summarizeHealth(probes, autofixes);
  const dateStr = new Date().toISOString().slice(0, 10);
  const subject = buildHealthSubject(summary, dateStr);
  const text = buildHealthText(summary, probes, dateStr);
  const html = buildHealthHtml(summary, probes, dateStr);

  // Digest email (best effort — if Resend itself is down, the 503 below still
  // reaches the operator through GitHub's workflow-failure email).
  let emailSent = false;
  if (RESEND_API_KEY && ADMIN_EMAIL) {
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: `InkTracker <${FROM_EMAIL}>`, to: [ADMIN_EMAIL], subject, html, text }),
        signal: AbortSignal.timeout(15_000),
      });
      emailSent = r.ok;
    } catch { /* swallow — digest is best-effort */ }
  }

  // Provenance row for "did the health check itself run?" (and future dedup).
  try {
    await admin.from("qb_event_log").insert({
      shop_owner: "__system__",
      action: "system_health_run",
      direction: "inbound",
      status: summary.overall === "ok" ? "success" : summary.overall === "degraded" ? "skipped" : "error",
      response_body: { overall: summary.overall, okCount: summary.okCount, total: summary.total, emailSent },
    });
  } catch { /* logging is non-fatal */ }

  const payload = { ok: summary.overall !== DOWN, overall: summary.overall, okCount: summary.okCount, total: summary.total, emailSent, subject };
  // 503 on critical-down makes the GitHub workflow go red → operator emailed
  // via a channel independent of Resend.
  return Response.json(payload, { status: summary.overall === DOWN ? 503 : 200 });
});
