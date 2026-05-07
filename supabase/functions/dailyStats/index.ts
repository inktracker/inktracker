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

function sum(rows: any[], col: string): number {
  return rows.reduce((s, r) => s + Number(r?.[col] ?? 0), 0);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  // ── Auth: shared-secret bearer token ──
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!BRIEFING_TOKEN || token !== BRIEFING_TOKEN) {
    return json({ error: "unauthorized" }, 401);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const since24h = isoDaysAgo(1);
  const since7d  = isoDaysAgo(7);

  try {
    // ── Quotes sent (any status — counts as "quoted out the door") ──
    const [q24, q7] = await Promise.all([
      supabase.from("quotes").select("total").gte("created_at", since24h),
      supabase.from("quotes").select("total").gte("created_at", since7d),
    ]);
    if (q24.error) throw q24.error;
    if (q7.error)  throw q7.error;

    // ── Invoices created (revenue billed) ──
    const [i24, i7] = await Promise.all([
      supabase.from("invoices").select("total").gte("created_at", since24h),
      supabase.from("invoices").select("total").gte("created_at", since7d),
    ]);
    if (i24.error) throw i24.error;
    if (i7.error)  throw i7.error;

    // ── Payments received (paid > 0, paid_date in window) ──
    const [p24, p7] = await Promise.all([
      supabase.from("invoices").select("paid").gt("paid", 0).gte("paid_date", since24h),
      supabase.from("invoices").select("paid").gt("paid", 0).gte("paid_date", since7d),
    ]);
    if (p24.error) throw p24.error;
    if (p7.error)  throw p7.error;

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
          last_24h: { count: q24.data!.length, total: sum(q24.data!, "total") },
          last_7d:  { count: q7.data!.length,  total: sum(q7.data!,  "total") },
        },
        invoiced: {
          last_24h: { count: i24.data!.length, total: sum(i24.data!, "total") },
          last_7d:  { count: i7.data!.length,  total: sum(i7.data!,  "total") },
        },
        payments: {
          last_24h: { count: p24.data!.length, total: sum(p24.data!, "paid") },
          last_7d:  { count: p7.data!.length,  total: sum(p7.data!,  "paid") },
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
    return json({ error: String(err?.message ?? err) }, 500);
  }
});
