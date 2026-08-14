// Partner trade price sheets — Supabase CRUD (docs/shop-partnerships-design.md,
// Phase 2). The pure pricing lives in partnerTradePricing.js (no Supabase
// import) so it stays unit-testable; re-exported here for convenience.
import { supabase } from "@/api/supabaseClient";
export { buildTradeSheetConfig, computeTradeTotal } from "@/lib/partnerTradePricing";

export async function getMyTradeSheet(myShop) {
  const { data, error } = await supabase
    .from("partner_trade_sheets").select("*")
    .eq("shop_owner", String(myShop).toLowerCase()).maybeSingle();
  if (error) throw error;
  return data;
}

export async function savePartnerTradeSheet(myShop, scalePct, config) {
  const { error } = await supabase.from("partner_trade_sheets").upsert({
    shop_owner: String(myShop).toLowerCase(),
    scale_pct: scalePct,
    config,
    updated_at: new Date().toISOString(),
  }, { onConflict: "shop_owner" });
  if (error) throw error;
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
