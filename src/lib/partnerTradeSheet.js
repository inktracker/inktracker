// Partner trade price sheets — Supabase CRUD (docs/shop-partnerships-design.md,
// Phase 2a). Per-partner, like brokers: partner_email = '*' is the default for
// all partners; a specific email overrides it. The pure pricing lives in
// partnerTradePricing.js (no Supabase import) so it stays unit-testable.
import { supabase } from "@/api/supabaseClient";
export {
  buildTradeSheetConfig,
  tradeConfigFromDraft,
  computeTradeTotal,
} from "@/lib/partnerTradePricing";

export const DEFAULT_PARTNER = "*";

const norm = (e) => (e === DEFAULT_PARTNER ? DEFAULT_PARTNER : String(e || "").toLowerCase());

// My sheet for one partner (or the '*' default) + its saved scale. scale_pct
// lives in an OWNER-ONLY sidecar (partners read the config, never the markup).
export async function getMyTradeSheet(myShop, partnerEmail = DEFAULT_PARTNER) {
  const shop = String(myShop).toLowerCase();
  const pe = norm(partnerEmail);
  const [{ data: sheet, error: sErr }, { data: meta }] = await Promise.all([
    supabase.from("partner_trade_sheets").select("config, updated_at")
      .eq("shop_owner", shop).eq("partner_email", pe).maybeSingle(),
    supabase.from("partner_trade_sheet_meta").select("scale_pct")
      .eq("shop_owner", shop).eq("partner_email", pe).maybeSingle(),
  ]);
  if (sErr) throw sErr;
  if (!sheet && !meta) return null;
  return { ...(sheet || {}), scale_pct: meta?.scale_pct ?? null };
}

// Which specific partners this shop has custom sheets for (email list, no '*').
export async function listMyTradeSheetPartners(myShop) {
  const { data, error } = await supabase.from("partner_trade_sheets")
    .select("partner_email").eq("shop_owner", String(myShop).toLowerCase());
  if (error) return [];
  return (data || []).map((r) => r.partner_email).filter((e) => e !== DEFAULT_PARTNER);
}

export async function savePartnerTradeSheet(myShop, partnerEmail, scalePct, config) {
  const shop = String(myShop).toLowerCase();
  const pe = norm(partnerEmail);
  const now = new Date().toISOString();
  const { error } = await supabase.from("partner_trade_sheets").upsert({
    shop_owner: shop, partner_email: pe, config, updated_at: now,
  }, { onConflict: "shop_owner,partner_email" });
  if (error) throw error;
  const { error: mErr } = await supabase.from("partner_trade_sheet_meta").upsert({
    shop_owner: shop, partner_email: pe, scale_pct: scalePct, updated_at: now,
  }, { onConflict: "shop_owner,partner_email" });
  if (mErr) throw mErr;
}

// The sheet a partner offers ME: my specific row if it exists, else their '*'
// default. RLS grants only these two rows, and only while actively partnered.
export async function getPartnerTradeSheet(partnerShop, myShop) {
  const me = String(myShop || "").toLowerCase();
  const { data, error } = await supabase.from("partner_trade_sheets")
    .select("partner_email, config")
    .eq("shop_owner", String(partnerShop).toLowerCase())
    .in("partner_email", [me, DEFAULT_PARTNER]);
  if (error || !data?.length) return null;
  const mine = data.find((r) => r.partner_email === me);
  return (mine || data.find((r) => r.partner_email === DEFAULT_PARTNER))?.config || null;
}
