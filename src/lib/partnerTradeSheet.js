// Partner trade price sheets — Supabase CRUD (docs/shop-partnerships-design.md,
// Phase 2). The pure pricing lives in partnerTradePricing.js (no Supabase
// import) so it stays unit-testable; re-exported here for convenience.
import { supabase } from "@/api/supabaseClient";
export { buildTradeSheetConfig, computeTradeTotal } from "@/lib/partnerTradePricing";

// My own sheet + my saved scale. scale_pct lives in an OWNER-ONLY sidecar
// (partners can read the resolved config but never the markup relation).
export async function getMyTradeSheet(myShop) {
  const shop = String(myShop).toLowerCase();
  const [{ data: sheet, error: sErr }, { data: meta }] = await Promise.all([
    supabase.from("partner_trade_sheets").select("config, updated_at").eq("shop_owner", shop).maybeSingle(),
    supabase.from("partner_trade_sheet_meta").select("scale_pct").eq("shop_owner", shop).maybeSingle(),
  ]);
  if (sErr) throw sErr;
  if (!sheet && !meta) return null;
  return { ...(sheet || {}), scale_pct: meta?.scale_pct ?? null };
}

export async function savePartnerTradeSheet(myShop, scalePct, config) {
  const shop = String(myShop).toLowerCase();
  const now = new Date().toISOString();
  const { error } = await supabase.from("partner_trade_sheets").upsert({
    shop_owner: shop, config, updated_at: now,
  }, { onConflict: "shop_owner" });
  if (error) throw error;
  // Scale is owner-only continuity metadata — separate table, never partner-read.
  const { error: mErr } = await supabase.from("partner_trade_sheet_meta").upsert({
    shop_owner: shop, scale_pct: scalePct, updated_at: now,
  }, { onConflict: "shop_owner" });
  if (mErr) throw mErr;
}

// A partner's published sheet (RLS grants this only while actively partnered).
// Returns null when they haven't published one, or we're not partnered.
export async function getPartnerTradeSheet(partnerShop) {
  const { data, error } = await supabase
    .from("partner_trade_sheets").select("config")
    .eq("shop_owner", String(partnerShop).toLowerCase()).maybeSingle();
  if (error) return null;
  return data?.config || null;
}
