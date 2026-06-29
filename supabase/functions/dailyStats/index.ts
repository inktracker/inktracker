// dailyStats — platform-wide aggregates for the morning briefing.
// Bypasses RLS via service_role; gated by BRIEFING_TOKEN bearer secret.
//
// GET /functions/v1/dailyStats
//   Authorization: Bearer <BRIEFING_TOKEN>
//
// Returns:
//   {
//     revenue: {
//       quotes_sent:    { last_24h: { count, total }, last_7d: {...} },
//       invoiced:       { last_24h: { count, total }, last_7d: {...} },
//       payments:       { last_24h: { count, total }, last_7d: {...} },
//     },
//     shops: {
//       new:                { last_24h, last_7d },
//       active:             <count of subscription_status in (trialing, active)>,
//       paying:             <count of subscription_status = active>,
//       trialing:           <count of subscription_status = trialing>,
//       trial_conversions:  { last_7d }   // active && created_at within 7d
//     },
//     generated_at: <iso>,
//   }

import { createClient } from "npm:@supabase/supabase-js@2";
import { CORS } from "../_shared/cors.ts";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BRIEFING_TOKEN            = Deno.env.get("BRIEFING_TOKEN") ?? "";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

// Constant-time string compare for the shared-secret bearer token. Standard
// practice for any verifier check where length-prefix short-circuit could
// leak timing info — even though the entropy of BRIEFING_TOKEN makes
// practical attacks impractical, the pattern is cheap to get right.
function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  // ── Auth: shared-secret bearer token ──
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!BRIEFING_TOKEN || !timingSafeEqual(token, BRIEFING_TOKEN)) {
    return json({ error: "unauthorized" }, 401);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const since24h = isoDaysAgo(1);
  const since7d  = isoDaysAgo(7);

  try {
    // ── Revenue aggregates (count + sum), computed in SQL (SCALE-03) ──
    // Was: SELECT every quotes.total / invoices.total / invoices.paid row
    // platform-wide then sum in JS — unbounded memory. Now one RPC does the
    // count()/sum() in Postgres against the created_at/shop indexes.
    const rev = await supabase.rpc("daily_briefing_revenue");
    if (rev.error) throw rev.error;
    const R = (rev.data ?? {}) as Record<string, number>;

    // ── New shops (profiles with shop/admin role) ──
    const [s24, s7] = await Promise.all([
      supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .in("role", ["shop", "admin"])
        .gte("created_at", since24h),
      supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .in("role", ["shop", "admin"])
        .gte("created_at", since7d),
    ]);
    if (s24.error) throw s24.error;
    if (s7.error)  throw s7.error;

    // ── Subscription mix ──
    const [trialing, paying] = await Promise.all([
      supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("subscription_status", "trialing"),
      supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("subscription_status", "active"),
    ]);
    if (trialing.error) throw trialing.error;
    if (paying.error)   throw paying.error;

    // ── Trial → paid conversions in last 7d (proxy: active and created in 7d) ──
    const conversions = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("subscription_status", "active")
      .gte("created_at", since7d);
    if (conversions.error) throw conversions.error;

    return json({
      revenue: {
        quotes_sent: {
          last_24h: { count: R.quotes_24h_count ?? 0, total: R.quotes_24h_total ?? 0 },
          last_7d:  { count: R.quotes_7d_count ?? 0,  total: R.quotes_7d_total ?? 0 },
        },
        invoiced: {
          last_24h: { count: R.invoices_24h_count ?? 0, total: R.invoices_24h_total ?? 0 },
          last_7d:  { count: R.invoices_7d_count ?? 0,  total: R.invoices_7d_total ?? 0 },
        },
        payments: {
          last_24h: { count: R.payments_24h_count ?? 0, total: R.payments_24h_total ?? 0 },
          last_7d:  { count: R.payments_7d_count ?? 0,  total: R.payments_7d_total ?? 0 },
        },
      },
      shops: {
        new: { last_24h: s24.count ?? 0, last_7d: s7.count ?? 0 },
        active: (trialing.count ?? 0) + (paying.count ?? 0),
        paying: paying.count ?? 0,
        trialing: trialing.count ?? 0,
        trial_conversions: { last_7d: conversions.count ?? 0 },
      },
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("dailyStats error:", err);
    return json({ error: String((err as any)?.message ?? err) }, 500);
  }
});
