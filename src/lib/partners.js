// Shop partnerships client (docs/shop-partnerships-design.md). Thin
// wrapper over the partnerHandoff edge function — the ONLY cross-tenant
// bridge — plus RLS-scoped reads of the partnership tables.

import { base44, supabase } from "@/api/supabaseClient";

async function invoke(action, params = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not signed in.");
  const { data, error } = await base44.functions.invoke("partnerHandoff", {
    action,
    accessToken: session.access_token,
    ...params,
  });
  if (error) {
    let real = "";
    try { real = (await error.context?.json?.())?.error || ""; } catch { /* fall through */ }
    throw new Error(real || error.message || "Partner request failed.");
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export const invitePartner = (partnerEmail, specialty) => invoke("invite", { partnerEmail, specialty });
export const respondToInvite = (partnershipId, accept, specialty) => invoke("respondInvite", { partnershipId, accept, specialty });
export const offerHandoff = (opts) => invoke("offer", opts);
export const respondToHandoff = (handoffId, response, extra = {}) => invoke("respond", { handoffId, response, ...extra });
export const cancelHandoff = (handoffId) => invoke("cancel", { handoffId });

/** Partnerships visible to my shop (RLS-scoped). */
export async function listPartnerships() {
  const { data, error } = await supabase.from("shop_partners").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Hand-offs involving my shop (RLS-scoped). */
export async function listHandoffs() {
  const { data, error } = await supabase.from("partner_handoffs").select("*").order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  return data ?? [];
}

/** The other party's email on a partnership row, from my shop's view. */
export function partnerOf(link, myShop) {
  const me = String(myShop || "").toLowerCase();
  return String(link.shop_a).toLowerCase() === me ? link.shop_b : link.shop_a;
}

export function activePartners(links, myShop) {
  return (links || []).filter((l) => l.status === "active").map((l) => partnerOf(l, myShop));
}

// Sender-facing labels for the partner_status chip on orders.
export const PARTNER_STATUS_LABELS = Object.freeze({
  accepted: "Partner: accepted",
  in_production: "Partner: in production",
  completed: "Partner: completed",
});
