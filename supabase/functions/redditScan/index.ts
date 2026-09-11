// Hourly Reddit lead scan. Searches a watch list of subreddits + a couple of
// site-wide competitor queries for threads where someone is asking about /
// comparing shop-management software, dedupes against reddit_scan_seen, and
// emails Joe a digest of only the NEW ones. Green hours are silent (unlike the
// daily health check) — a lead digest every hour with nothing in it is noise —
// BUT a run that couldn't reach Reddit DOES email an alert, so "no leads" is
// never confused with "scanner is broken".
//
// Triggered by pg_cron (see migration 2026091*_reddit_scan_pg_cron.sql) hourly
// with Authorization: Bearer <REDDIT_SCAN_CRON_TOKEN>.
//
// Reddit access: OAuth (app-only client_credentials) when REDDIT_CLIENT_ID /
// REDDIT_CLIENT_SECRET are set — much higher rate limits and won't get IP-
// blocked. Falls back to the anonymous public JSON endpoints otherwise.

import { createClient } from "npm:@supabase/supabase-js@2.102.1";
import { sendResendEmail } from "../_shared/resendClient.js";
import {
  SUBREDDITS,
  KEYWORD_QUERY,
  SITEWIDE_QUERIES,
  extractPosts,
  filterNewLeads,
  buildDigestSubject,
  buildDigestText,
  buildDigestHtml,
  buildBlockedSubject,
  buildBlockedText,
} from "../_shared/redditScan.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const CRON_TOKEN = Deno.env.get("REDDIT_SCAN_CRON_TOKEN") ?? "";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "quotes@info.inktracker.app";
const ADMIN_EMAIL =
  Deno.env.get("ADMIN_NOTIFY_EMAIL") || Deno.env.get("OPERATOR_ALERT_EMAIL") || "joe@biotamfg.co";
const REDDIT_CLIENT_ID = Deno.env.get("REDDIT_CLIENT_ID") ?? "";
const REDDIT_CLIENT_SECRET = Deno.env.get("REDDIT_CLIENT_SECRET") ?? "";
// Reddit asks for a descriptive, unique User-Agent (platform:appid:version by
// author). Anonymous requests without one are aggressively throttled.
const USER_AGENT = Deno.env.get("REDDIT_USER_AGENT") ?? "web:app.inktracker.reddit-scan:v1.0 (by /u/inktracker)";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function authorized(req: Request): boolean {
  const header = req.headers.get("Authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  return (
    (!!CRON_TOKEN && timingSafeEqual(token, CRON_TOKEN)) ||
    (!!CRON_SECRET && timingSafeEqual(token, CRON_SECRET))
  );
}

function admin() {
  return createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
}

// ── Reddit access ──────────────────────────────────────────────────────────
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getOAuthToken(): Promise<string | null> {
  if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET) return null;
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;
  const basic = btoa(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`);
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    console.warn("[redditScan] OAuth token failed:", res.status);
    return null;
  }
  const data = await res.json();
  const value = data?.access_token;
  if (!value) return null;
  cachedToken = { value, expiresAt: Date.now() + (Number(data.expires_in || 3600) * 1000) };
  return value;
}

interface FetchResult {
  posts: ReturnType<typeof extractPosts>;
  ok: boolean;
  status: number;
}

// One search request (a subreddit-restricted search, or site-wide). Returns
// ok:false with the status on any block/throttle so the caller can tell the
// difference between "empty" and "couldn't read".
async function searchReddit(query: string, opts: { sub?: string; token: string | null }): Promise<FetchResult> {
  const params = new URLSearchParams({ q: query, sort: "new", limit: "25", t: "week", raw_json: "1" });
  const headers: Record<string, string> = { "User-Agent": USER_AGENT };
  let url: string;
  if (opts.token) {
    headers.Authorization = `Bearer ${opts.token}`;
    if (opts.sub) params.set("restrict_sr", "true");
    url = opts.sub
      ? `https://oauth.reddit.com/r/${opts.sub}/search?${params}`
      : `https://oauth.reddit.com/search?${params}`;
  } else {
    if (opts.sub) params.set("restrict_sr", "true");
    url = opts.sub
      ? `https://www.reddit.com/r/${opts.sub}/search.json?${params}`
      : `https://www.reddit.com/search.json?${params}`;
  }
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { posts: [], ok: false, status: res.status };
    const body = await res.json();
    return { posts: extractPosts(body), ok: true, status: 200 };
  } catch (err) {
    console.warn("[redditScan] search threw:", (err as Error)?.message);
    return { posts: [], ok: false, status: 0 };
  }
}

async function runScan() {
  const token = await getOAuthToken();
  const usingOAuth = !!token;

  const requests: Array<Promise<FetchResult>> = [];
  for (const sub of SUBREDDITS) requests.push(searchReddit(KEYWORD_QUERY, { sub, token }));
  for (const q of SITEWIDE_QUERIES) requests.push(searchReddit(q, { token }));

  const results = await Promise.all(requests);
  const anyOk = results.some((r) => r.ok);
  const allPosts = results.flatMap((r) => r.posts);

  return { usingOAuth, anyOk, allPosts, requestCount: results.length, okCount: results.filter((r) => r.ok).length };
}

async function handle(): Promise<Response> {
  const db = admin();
  const { usingOAuth, anyOk, allPosts, requestCount, okCount } = await runScan();

  // Reddit unreachable → alert (don't fail silently), then stop. But the cron
  // runs hourly and anonymous access is IP-blocked from datacenter ranges, so
  // an un-throttled alert would email every hour until OAuth creds are added.
  // Dedupe to at most once per ~day: only email if the previous run wasn't
  // also a block within the last 20h. Always log the run either way.
  if (!anyOk) {
    const detail = `${okCount}/${requestCount} searches succeeded; auth=${usingOAuth ? "oauth" : "anonymous"}`;
    const alreadyAlerted = await recentlyBlocked(db);
    if (!alreadyAlerted) {
      await sendResendEmail({
        from: FROM_EMAIL,
        to: ADMIN_EMAIL,
        subject: buildBlockedSubject(),
        text: buildBlockedText(detail),
      });
    }
    await logRun(db, { status: "reddit_unreachable", detail });
    return json({ ok: false, reason: "reddit_unreachable", detail, alerted: !alreadyAlerted }, 200);
  }

  // Dedupe against what we've already surfaced. Only need to check the ids we
  // actually fetched this run.
  const fetchedIds = [...new Set(allPosts.map((p) => p.id))];
  const seenIds = new Set<string>();
  if (fetchedIds.length) {
    const { data: seenRows } = await db
      .from("reddit_scan_seen")
      .select("post_id")
      .in("post_id", fetchedIds);
    for (const r of seenRows || []) seenIds.add(r.post_id);
  }

  const { leads, total } = filterNewLeads(allPosts, seenIds, { limit: 20 });

  // Record every new lead as seen BEFORE emailing, so a re-run (or a retry)
  // can't double-send. Non-leads we ignore — they'll re-appear only if they
  // later gain lead signals, which is fine.
  if (leads.length) {
    const rows = leads.map((l) => ({
      post_id: l.id,
      subreddit: l.subreddit,
      title: (l.title || "").slice(0, 500),
      permalink: l.permalink,
      score: l._score,
      why: l._why,
      created_utc: l.created_utc ? new Date(l.created_utc * 1000).toISOString() : null,
    }));
    await db.from("reddit_scan_seen").upsert(rows, { onConflict: "post_id", ignoreDuplicates: true });
  }

  if (leads.length) {
    await sendResendEmail({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject: buildDigestSubject(leads, total),
      text: buildDigestText(leads, total),
      html: buildDigestHtml(leads, total),
    });
  }

  await logRun(db, {
    status: "ok",
    detail: `auth=${usingOAuth ? "oauth" : "anonymous"} fetched=${fetchedIds.length} new_leads=${leads.length}`,
  });

  return json({ ok: true, usingOAuth, fetched: fetchedIds.length, newLeads: leads.length, emailed: leads.length > 0 });
}

// True if the most recent scan run in the last 20h was also a Reddit block —
// used to throttle the "couldn't reach Reddit" alert to ~once/day. A blocked
// run is logged with status='skipped' (NOT 'error' — 'error' is what the daily
// QuickBooks error-spike digest counts, and a Reddit block is not a QB error).
async function recentlyBlocked(db: ReturnType<typeof admin>): Promise<boolean> {
  try {
    const since = new Date(Date.now() - 20 * 3600 * 1000).toISOString();
    const { data } = await db
      .from("qb_event_log")
      .select("status")
      .eq("action", "reddit_scan_run")
      .eq("status", "skipped")
      .gte("created_at", since)
      .limit(1);
    return (data?.length ?? 0) > 0;
  } catch {
    return false; // on doubt, prefer alerting over silence
  }
}

// Provenance row: "did the scan run, and what did it see?". qb_event_log's
// status is a constrained enum (success/error/skipped/duplicate/started) and
// shop_owner + direction are NOT NULL — mirror the systemHealthCheck row shape.
// IMPORTANT: a Reddit block logs as 'skipped', NOT 'error'. qbReconcile's daily
// error-spike digest counts every status='error' row regardless of action, so
// logging Reddit blocks as 'error' fired a false "QuickBooks error spike" alert
// (14 hourly blocks > threshold of 5). A scan that couldn't reach Reddit didn't
// error — it had nothing to do.
async function logRun(
  db: ReturnType<typeof admin>,
  { status, detail }: { status: "ok" | "reddit_unreachable"; detail: string },
) {
  try {
    await db.from("qb_event_log").insert({
      shop_owner: "__system__",
      action: "reddit_scan_run",
      direction: "inbound",
      status: status === "ok" ? "success" : "skipped",
      response_body: { detail },
    });
  } catch (err) {
    console.warn("[redditScan] logRun failed (non-fatal):", (err as Error)?.message);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);
  try {
    return await handle();
  } catch (err) {
    console.error("[redditScan] fatal:", (err as Error)?.message);
    return json({ error: "scan_failed", detail: (err as Error)?.message }, 500);
  }
});
