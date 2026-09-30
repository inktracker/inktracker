// InkTracker payments (Rainforest) — shop-side actions. Supabase Edge Function.
//
//   status          → which way this shop's customers pay + setup progress
//   qbAccounts      → the shop's QuickBooks bank / expense accounts to pick from
//   saveQbAccounts  → map payout bank account + fee expense account (owner/manager)
//   setEnabled      → switch InkTracker payments on/off (OWNER only)
//
// Onboarding (merchant sign-up session) and the customer payment session are
// added once the sandbox is available — see docs/rainforest-payments.md.
//
// Dormant by default: with the RAINFOREST_ENABLED secret unset, status reports
// the QuickBooks rail and setEnabled refuses. Writes go through the service
// role (processor_accounts is SELECT-only for the browser).
//
// Auth: signed-in shop team member; acts on the SHOP OWNER's row
// (loadShopProfileForUser). Brokers are refused.

import { createClient } from "npm:@supabase/supabase-js@2.102.1";
import { loadProfileWithSecrets, loadShopProfileForUser } from "../_shared/profileSecrets.ts";
import { flagOn } from "../_shared/paymentRail.js";
import {
  buildStatusPayload,
  canViewPayments,
  canMapQbAccounts,
  checkCanEnable,
  checkCanDisable,
  validateQbAccountMapping,
  qbAccountChoices,
} from "../_shared/rainforestAccount.js";
import { getShopQb, qbListAccounts } from "../_shared/qbShopClient.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: CORS });
}

// deno-lint-ignore no-explicit-any
async function loadAccount(admin: any, shopOwner: string) {
  const { data, error } = await admin
    .from("processor_accounts")
    .select("shop_owner, merchant_id, merchant_status, merchant_application_status, enabled, qb_bank_account_id, qb_fee_account_id")
    .eq("shop_owner", shopOwner)
    .maybeSingle();
  if (error) throw new Error(`Couldn't read payment settings: ${error.message}`);
  return data ?? null;
}

// deno-lint-ignore no-explicit-any
export async function handle(req: Request, deps: { admin: any; getUser: (token: string) => Promise<any>; env: (k: string) => string | undefined }) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const body = await req.json().catch(() => ({}));
  const token = body.accessToken || req.headers.get("Authorization")?.replace("Bearer ", "") || "";
  if (!token) return json({ error: "Unauthorized" }, 401);
  const user = await deps.getUser(token);
  if (!user) return json({ error: "Unauthorized" }, 401);

  const admin = deps.admin;
  const viewer = await loadProfileWithSecrets(admin, { auth_id: user.id });
  if (!canViewPayments(viewer)) return json({ error: "Not available for this account." }, 403);
  const { profile: shop } = await loadShopProfileForUser(admin, user.id);
  if (!shop?.email) return json({ error: "Shop not found" }, 404);
  const shopOwner = String(shop.email);
  const envEnabled = flagOn(deps.env("RAINFOREST_ENABLED"));

  const action = String(body.action || "status");
  const account = await loadAccount(admin, shopOwner);

  if (action === "status") {
    return json(buildStatusPayload({ envEnabled, account, viewer }));
  }

  if (action === "qbAccounts") {
    if (!canMapQbAccounts(viewer)) return json({ error: "Only the owner or a manager can set this up." }, 403);
    const conn = await getShopQb(admin, shopOwner);
    if (!conn) return json({ error: "Connect QuickBooks first." }, 400);
    return json(qbAccountChoices(await qbListAccounts(conn)));
  }

  if (action === "saveQbAccounts") {
    if (!canMapQbAccounts(viewer)) return json({ error: "Only the owner or a manager can set this up." }, 403);
    const conn = await getShopQb(admin, shopOwner);
    if (!conn) return json({ error: "Connect QuickBooks first." }, 400);
    // Validate against the LIVE chart of accounts — never store an id the
    // browser made up.
    const v = validateQbAccountMapping({
      bankAccountId: body.bankAccountId,
      feeAccountId: body.feeAccountId,
      qbAccounts: await qbListAccounts(conn),
    });
    if (!v.ok) return json({ error: v.error }, 400);
    const { error } = await admin.from("processor_accounts").upsert({
      shop_owner: shopOwner,
      qb_bank_account_id: v.bankAccountId,
      qb_fee_account_id: v.feeAccountId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "shop_owner" });
    if (error) return json({ error: `Couldn't save: ${error.message}` }, 500);
    return json(buildStatusPayload({ envEnabled, account: await loadAccount(admin, shopOwner), viewer }));
  }

  if (action === "setEnabled") {
    const want = body.enabled === true;
    const gate = want ? checkCanEnable({ envEnabled, account, viewer }) : checkCanDisable({ viewer });
    if (!gate.ok) return json({ error: gate.error }, want ? 400 : 403);
    if (!account && !want) return json(buildStatusPayload({ envEnabled, account, viewer }));
    const now = new Date().toISOString();
    const { error } = await admin.from("processor_accounts")
      .update({ enabled: want, enabled_at: want ? now : null, updated_at: now })
      .eq("shop_owner", shopOwner);
    if (error) return json({ error: `Couldn't save: ${error.message}` }, 500);
    return json(buildStatusPayload({ envEnabled, account: await loadAccount(admin, shopOwner), viewer }));
  }

  return json({ error: `Unknown action: ${action}` }, 400);
}

if (import.meta.main) {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  Deno.serve(async (req) => {
    try {
      return await handle(req, {
        admin,
        getUser: async (token) => {
          const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
            global: { headers: { Authorization: `Bearer ${token}` } },
          });
          const { data: { user } } = await userClient.auth.getUser(token);
          return user ?? null;
        },
        env: (k) => Deno.env.get(k),
      });
    } catch (err) {
      console.error("[rainforest]", err);
      return json({ error: "Something went wrong. Try again in a moment." }, 500);
    }
  });
}
