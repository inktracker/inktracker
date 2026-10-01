// InkTracker payments (Rainforest). Supabase Edge Function.
//
// Signed-in shop actions (acts on the SHOP OWNER's row; brokers refused):
//   status           → which way this shop's customers pay + setup progress
//   startOnboarding  → OWNER, paying plan only: create the Rainforest merchant
//                      (prefilled) once, then a short-lived onboarding session
//                      for the sign-up component
//   refreshStatus    → re-read merchant/application status from Rainforest
//   qbAccounts       → the shop's QuickBooks bank / expense accounts to pick from
//   saveQbAccounts   → map payout bank account + fee expense account (owner/manager)
//   setEnabled       → switch InkTracker payments on/off (OWNER only)
//
// Public (customer) action, no sign-in, token-gated like the quote page:
//   payRail          → { docType, id, token } → { rail } only (page load)
//   payinSession     → { docType: "quote"|"invoice", id, token } → a payment
//                      session for the LIVE QuickBooks balance, or a reason
//                      it can't be paid here
//
// Dormant by default: with RAINFOREST_ENABLED unset, status reports the
// QuickBooks rail, startOnboarding/setEnabled refuse, and payinSession
// answers { rail: "qb" } so the page keeps using QuickBooks.

import { createClient } from "npm:@supabase/supabase-js@2.102.1";
import { loadProfileWithSecrets, loadShopProfileForUser } from "../_shared/profileSecrets.ts";
import { flagOn, loadPaymentRail, RAIL } from "../_shared/paymentRail.js";
import {
  buildStatusPayload,
  canViewPayments,
  canMapQbAccounts,
  canTogglePayments,
  checkCanEnable,
  checkCanDisable,
  validateQbAccountMapping,
  qbAccountChoices,
  onboardingStage,
  canStartOver,
  merchantStatusFields,
} from "../_shared/rainforestAccount.js";
import {
  isPayingShop,
  buildMerchantCreate,
  buildOnboardingSession,
  buildPaymentSession,
  buildPayinConfig,
  buildActivitySession,
} from "../_shared/rainforestRequests.js";
import { choosePayTarget, NOT_PAYABLE } from "../_shared/rainforestPayinPlan.js";
import { formatRatePct } from "../_shared/rainforestPricing.js";
import { getShopQb, qbListAccounts, qbGetInvoice, type QbConn } from "../_shared/qbShopClient.ts";
import { rainforestApi, componentScripts, type RainforestApi } from "../_shared/rainforestApi.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: CORS });
}

function safeEquals(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const PAY_SESSION_REUSE_MS = 90 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Deps = {
  admin: Any;
  getUser: (token: string) => Promise<Any>;
  env: (k: string) => string | undefined;
  rf: RainforestApi;
  qb: {
    connect: (shopOwner: string) => Promise<QbConn | null>;
    listAccounts: (c: QbConn) => Promise<Any[]>;
    getInvoice: (c: QbConn, id: string) => Promise<Any | null>;
  };
};

async function loadAccount(admin: Any, shopOwner: string) {
  const { data, error } = await admin
    .from("processor_accounts")
    .select("shop_owner, merchant_id, merchant_status, merchant_application_id, merchant_application_status, enabled, processor_used_at, plan_lapsed_at, qb_bank_account_id, qb_fee_account_id")
    .eq("shop_owner", shopOwner)
    .maybeSingle();
  if (error) throw new Error(`Couldn't read payment settings: ${error.message}`);
  return data ?? null;
}

// Customer-facing reasons, in plain words. Never a raw error.
const CUSTOMER_REASON: Record<string, string> = {
  [NOT_PAYABLE.PAID]: "This invoice is already paid. Thank you!",
  [NOT_PAYABLE.DEPOSIT_PAID_AWAITING_FINAL]: "Your deposit is paid. The shop will send the final invoice when your order is ready.",
  [NOT_PAYABLE.STALE]: "This quote changed after it was invoiced. The shop needs to update the invoice before you can pay online. Please contact the shop.",
  [NOT_PAYABLE.NO_INVOICE]: "Online payment isn't set up for this yet. Please contact the shop.",
  [NOT_PAYABLE.BROKER]: "Online payment isn't available here. Please contact the shop.",
  [NOT_PAYABLE.BAD_AMOUNT]: "Online payment isn't available right now. Please contact the shop.",
  in_flight: "A payment is already being processed for this invoice. Bank payments take a few business days to clear.",
  tax_hold: "The shop is updating the sales tax on this invoice. Please check back soon or contact the shop.",
};

/** Load a quote/invoice for the public pay page, token-checked. */
async function loadPublicDoc(admin: Any, body: Any) {
  const docType = body.docType === "invoice" ? "invoice" : "quote";
  const id = String(body.id ?? "");
  if (!UUID_RE.test(id)) return null;
  const table = docType === "invoice" ? "invoices" : "quotes";
  const cols = docType === "invoice"
    ? "id, invoice_id, shop_owner, status, total, tax, qb_invoice_id, qb_deposit_invoice_id, deposit_amount, deposit_pct, deposit_paid, broker_id, public_token, customer_name, paid, qb_tax_hold"
    : "id, quote_id, shop_owner, status, total, tax, qb_invoice_id, qb_deposit_invoice_id, deposit_amount, deposit_pct, deposit_paid, broker_id, broker_email, public_token, customer_name, customer_email, paid, qb_tax_hold";
  const { data: doc } = await admin.from(table).select(cols).eq("id", id).maybeSingle();
  // Same answer for "no such doc" and "wrong token" — don't confirm ids exist.
  if (!doc || !safeEquals(String(body.token ?? ""), String(doc.public_token ?? ""))) return null;
  return { doc, docType };
}

/** What the pay page shows at the top (never internal fields). */
async function loadDisplay(admin: Any, doc: Any, docType: string) {
  const { data: shopProfile } = await admin.from("profiles").select("shop_name, logo_url, zip").eq("email", doc.shop_owner).maybeSingle();
  return {
    display: {
      shopName: shopProfile?.shop_name ?? null,
      logoUrl: shopProfile?.logo_url ?? null,
      docNumber: docType === "invoice" ? doc.invoice_id : doc.quote_id,
      customerName: doc.customer_name ?? null,
    },
    shopZip: shopProfile?.zip ?? null,
  };
}

/**
 * Public: which way this document is paid, plus what the page shows.
 * Database reads only — no Rainforest or QuickBooks calls — because email
 * link scanners prefetch these pages; the payment session is only opened
 * when a person clicks Pay (payinSession).
 */
async function payRail(body: Any, deps: Deps) {
  const found = await loadPublicDoc(deps.admin, body);
  if (!found) return json({ error: "Not found" }, 404);
  const { doc, docType } = found;
  const rail = await loadPaymentRail(deps.admin, doc.shop_owner, {
    envEnabled: flagOn(deps.env("RAINFOREST_ENABLED")),
    broker: Boolean(doc.broker_id || doc.broker_email),
  });
  if (rail !== RAIL.PROCESSOR) return json({ rail: "qb" });
  const { display } = await loadDisplay(deps.admin, doc, docType);
  return json({ rail: "processor", display, paid: Boolean(doc.paid) });
}

/**
 * An existing Rainforest merchant for this shop (from an attempt whose save
 * failed). Merchants have no metadata and can't be filtered by it, so search
 * by name and match the email we created it with. Closed ones don't count.
 */
async function findOurMerchant(deps: Deps, name: string, shopOwner: string) {
  const list = await deps.rf.get(`/v1/merchants?name=${encodeURIComponent(name)}`);
  const items = Array.isArray(list) ? list : (list?.results ?? list?.merchants ?? []);
  const hit = items.find((m: Any) =>
    String(m?.email ?? "").toLowerCase() === shopOwner.toLowerCase() &&
    String(m?.name ?? "") === name &&
    !["CANCELED", "DEACTIVATED"].includes(String(m?.merchant_status ?? m?.status ?? "").toUpperCase()));
  if (!hit?.merchant_id) return null;
  let applicationId = hit.merchant_application_id ?? hit.latest_merchant_application?.merchant_application_id ?? null;
  if (!applicationId) {
    const apps = await deps.rf.get(`/v1/merchants/${encodeURIComponent(hit.merchant_id)}/applications`);
    const appList = Array.isArray(apps) ? apps : (apps?.results ?? apps?.applications ?? []);
    applicationId = appList.at(-1)?.merchant_application_id ?? null;
  }
  return {
    merchant_id: hit.merchant_id,
    merchant_application_id: applicationId,
    merchant_status: hit.merchant_status ?? hit.status,
    merchant_application_status: hit.merchant_application_status ?? hit.latest_merchant_application?.status,
  };
}

/** Public: build a payment session for a quote or invoice. */
async function payinSession(body: Any, deps: Deps) {
  const { admin } = deps;
  const found = await loadPublicDoc(admin, body);
  if (!found) return json({ error: "Not found" }, 404);
  const { doc, docType } = found;

  const envEnabled = flagOn(deps.env("RAINFOREST_ENABLED"));
  const broker = Boolean(doc.broker_id || doc.broker_email);
  const rail = await loadPaymentRail(admin, doc.shop_owner, { envEnabled, broker });
  if (rail !== RAIL.PROCESSOR) return json({ rail: "qb" });
  // Tax-mismatch hold: QuickBooks computed a different tax than the shop
  // billed. The QB rail mints no link in this state; neither do we.
  if (doc.qb_tax_hold) {
    return json({ rail: "processor", payable: false, reason: "tax_hold", message: CUSTOMER_REASON.tax_hold });
  }
  if (docType === "quote" && ["Draft", "Declined"].includes(String(doc.status))) {
    return json({ rail: "processor", payable: false, message: "This quote isn't ready to pay yet. Please contact the shop." });
  }

  const account = await loadAccount(admin, doc.shop_owner);
  if (!account?.merchant_id) return json({ rail: "qb" });

  const { display, shopZip } = await loadDisplay(admin, doc, docType);

  // A payment already in flight for this document (bank payment clearing, or
  // a card payment not yet in QuickBooks) → don't open a second one.
  const invoiceIds = [doc.qb_invoice_id, doc.qb_deposit_invoice_id].filter(Boolean).map(String);
  if (invoiceIds.length) {
    const { data: inflight } = await admin.from("processor_payments")
      .select("processor_payin_id, status, qb_payment_id")
      .eq("shop_owner", doc.shop_owner)
      .in("qb_invoice_id", invoiceIds)
      .in("status", ["processing", "succeeded"])
      .is("qb_payment_id", null);
    if (inflight?.length) return json({ rail: "processor", payable: false, reason: "in_flight", message: CUSTOMER_REASON.in_flight, display });
  }

  // Throttle: the same document asked again within 90s gets the session we
  // just made (still ~28 min of life) — no QuickBooks or Rainforest calls.
  const { data: recent } = await admin.from("processor_pay_sessions")
    .select("response, created_at").eq("doc_id", doc.id).maybeSingle();
  if (recent?.response && Date.now() - new Date(recent.created_at).getTime() < PAY_SESSION_REUSE_MS) {
    return json(recent.response);
  }

  const conn = await deps.qb.connect(doc.shop_owner);
  if (!conn) return json({ rail: "processor", payable: false, reason: "qb_unavailable", message: CUSTOMER_REASON[NOT_PAYABLE.BAD_AMOUNT], display });
  const [liveFinal, liveDeposit] = await Promise.all([
    doc.qb_invoice_id ? deps.qb.getInvoice(conn, String(doc.qb_invoice_id)) : Promise.resolve(null),
    doc.qb_deposit_invoice_id && !doc.qb_invoice_id ? deps.qb.getInvoice(conn, String(doc.qb_deposit_invoice_id)) : Promise.resolve(null),
  ]);
  // Deposit invoices only exist when the deposit path minted one, so the
  // server can always route to them (the frontend kill switch hides the UI).
  const target = choosePayTarget({ quote: doc, depositsEnabled: true, liveFinal, liveDeposit });
  if (!target.ok) return json({ rail: "processor", payable: false, reason: target.reason, message: CUSTOMER_REASON[target.reason] ?? CUSTOMER_REASON[NOT_PAYABLE.BAD_AMOUNT], display });

  const liveInvoice = target.kind === "deposit" ? liveDeposit : liveFinal;

  // One Rainforest payin config allows one successful payment and caches
  // its first answer forever. Key it by the attempts already made against
  // this QB invoice, so a refunded-and-reopened balance gets a fresh config.
  const { data: prior } = await admin.from("processor_payments")
    .select("processor_payin_id")
    .eq("shop_owner", doc.shop_owner)
    .eq("qb_invoice_id", String(target.qbInvoiceId));
  const attempt = prior?.length ?? 0;
  const configBody = buildPayinConfig({
    merchantId: account.merchant_id,
    doc,
    docType,
    target,
    liveInvoice,
    customer: { name: doc.customer_name, email: doc.customer_email },
    shopPostalCode: shopZip,
    attempt,
  });
  let config;
  try {
    config = await deps.rf.post("/v1/payin_configs", configBody);
  } catch (err) {
    // A rejected first request would be replayed forever under the same
    // key; retry once under a fresh one (e.g. after fixing invoice data).
    const status = (err as Any)?.status;
    if (!(status >= 400 && status < 500)) throw err;
    console.error(`[rainforest] payin config rejected (${status}); retrying with a fresh key: ${(err as Error).message}`);
    config = await deps.rf.post("/v1/payin_configs", { ...configBody, idempotency_key: `${configBody.idempotency_key}:r${Date.now()}` });
  }
  const session = await deps.rf.post("/v1/sessions", buildPaymentSession(account.merchant_id));
  const response = {
    rail: "processor",
    payable: true,
    kind: target.kind,
    amountCents: target.amountCents,
    payinConfigId: config?.payin_config_id,
    sessionKey: session?.session_key,
    allowedMethods: "CARD,ACH",
    scriptUrl: componentScripts(deps.rf.base).payment,
    pricing: { card: formatRatePct("card"), ach: formatRatePct("ach") },
    display,
  };
  await admin.from("processor_pay_sessions")
    .upsert({ doc_id: doc.id, response, created_at: new Date().toISOString() }, { onConflict: "doc_id" });
  return json(response);
}

export async function handle(req: Request, deps: Deps) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "status");

  if (action === "payinSession") return payinSession(body, deps);
  if (action === "payRail") return payRail(body, deps);

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
  const account = await loadAccount(admin, shopOwner);
  const status = async () => json({
    ...buildStatusPayload({ envEnabled, account: await loadAccount(admin, shopOwner), viewer }),
    payingPlan: isPayingShop(shop),
  });

  if (action === "status") return status();

  if (action === "startOnboarding") {
    if (!canTogglePayments(viewer)) return json({ error: "Only the shop owner can sign up for payments." }, 403);
    if (!envEnabled) return json({ error: "InkTracker payments aren't available yet." }, 400);
    if (!isPayingShop(shop)) return json({ error: "InkTracker payments are available on a paid plan." }, 403);
    // A closed application is replaced with a new one (below, as if new).
    const startOver = canStartOver(account);
    let merchantId = startOver ? null : (account?.merchant_id ?? null);
    let applicationId = startOver ? null : (account?.merchant_application_id ?? null);
    if (onboardingStage(account) === "active") return json({ error: "Your payments account is already approved." }, 400);
    if (!merchantId) {
      // One merchant per shop: claim creation first so two clicks (or two
      // tabs) can't create two merchants.
      const nowIso = new Date().toISOString();
      if (!account) {
        await admin.from("processor_accounts").upsert({ shop_owner: shopOwner }, { onConflict: "shop_owner", ignoreDuplicates: true });
      }
      const { data: claimed } = await admin.from("processor_accounts")
        .update({ merchant_creating_at: nowIso })
        .eq("shop_owner", shopOwner)
        .or(`merchant_creating_at.is.null,merchant_creating_at.lt."${new Date(Date.now() - 2 * 60 * 1000).toISOString()}"`)
        .select("shop_owner, merchant_id");
      if (!claimed?.length) return json({ error: "Sign-up is already opening. Try again in a moment." }, 409);
      // Claimed, but another request saved a merchant meanwhile (and it isn't
      // a closed one we're replacing) → use it.
      if (claimed[0].merchant_id && !startOver) {
        await admin.from("processor_accounts").update({ merchant_creating_at: null }).eq("shop_owner", shopOwner);
        return json({ error: "Sign-up is ready. Click Continue sign-up." }, 409);
      }
      const createBody = buildMerchantCreate(shop);
      // A merchant from an earlier attempt whose save failed? Adopt it —
      // never create a second merchant for the same shop.
      let m;
      try {
        m = await findOurMerchant(deps, createBody.name, shopOwner);
        if (!m) m = await deps.rf.post("/v1/merchants", createBody);
      } catch (err) {
        // Nothing was saved: release the claim so the owner can retry now.
        await admin.from("processor_accounts").update({ merchant_creating_at: null }).eq("shop_owner", shopOwner);
        throw err;
      }
      merchantId = m?.merchant_id;
      applicationId = m?.merchant_application_id;
      if (!merchantId || !applicationId) throw new Error("Rainforest returned no merchant id");
      const patch = {
        shop_owner: shopOwner,
        ...(startOver ? { enabled: false, enabled_at: null, onboarded_at: null } : {}),
        merchant_id: merchantId,
        merchant_application_id: applicationId,
        merchant_status: String(m?.merchant_status ?? "pending").toLowerCase(),
        merchant_application_status: String(m?.merchant_application_status ?? "created").toLowerCase(),
        merchant_creating_at: null,
        updated_at: new Date().toISOString(),
      };
      let saved = false;
      for (let i = 0; i < 3 && !saved; i++) {
        const { error } = await admin.from("processor_accounts").upsert(patch, { onConflict: "shop_owner" });
        saved = !error;
      }
      // Claim stays set; the next attempt (after it goes stale) adopts this
      // merchant via findOurMerchant instead of creating another.
      if (!saved) throw new Error(`Couldn't save the new merchant ${merchantId}; the next sign-up attempt will pick it up`);
    }
    const session = await deps.rf.post("/v1/sessions", buildOnboardingSession(merchantId));
    return json({
      sessionKey: session?.session_key,
      merchantId,
      merchantApplicationId: applicationId,
      scriptUrl: componentScripts(deps.rf.base).merchant,
      termsUrl: deps.env("RAINFOREST_TERMS_URL") ?? "https://www.inktracker.app/payment-processing-agreement",
    });
  }

  // The shop's payments and payouts (Rainforest's report components): refund
  // a customer, answer a dispute, see what each payout contained. Owner and
  // managers view; only the owner can refund or respond to disputes.
  if (action === "activitySession") {
    if (!canMapQbAccounts(viewer)) return json({ error: "Only the owner or a manager can see payments." }, 403);
    if (!account?.merchant_id) return json({ error: "No payments account yet." }, 400);
    const canAct = canTogglePayments(viewer);
    const session = await deps.rf.post("/v1/sessions", buildActivitySession(account.merchant_id, { canAct }));
    return json({
      sessionKey: session?.session_key,
      merchantId: account.merchant_id,
      canAct,
      scriptUrl: componentScripts(deps.rf.base).merchant,
    });
  }

  if (action === "refreshStatus") {
    if (!account?.merchant_id) return status();
    const m = await deps.rf.get(`/v1/merchants/${encodeURIComponent(account.merchant_id)}`);
    await admin.from("processor_accounts")
      .update({ ...merchantStatusFields(m), updated_at: new Date().toISOString() })
      .eq("shop_owner", shopOwner);
    return status();
  }

  if (action === "qbAccounts") {
    if (!canMapQbAccounts(viewer)) return json({ error: "Only the owner or a manager can set this up." }, 403);
    const conn = await deps.qb.connect(shopOwner);
    if (!conn) return json({ error: "Connect QuickBooks first." }, 400);
    return json(qbAccountChoices(await deps.qb.listAccounts(conn)));
  }

  if (action === "saveQbAccounts") {
    if (!canMapQbAccounts(viewer)) return json({ error: "Only the owner or a manager can set this up." }, 403);
    const conn = await deps.qb.connect(shopOwner);
    if (!conn) return json({ error: "Connect QuickBooks first." }, 400);
    // Validate against the LIVE chart of accounts — never store an id the
    // browser made up.
    const v = validateQbAccountMapping({
      bankAccountId: body.bankAccountId,
      feeAccountId: body.feeAccountId,
      qbAccounts: await deps.qb.listAccounts(conn),
    });
    if (!v.ok) return json({ error: v.error }, 400);
    const { error } = await admin.from("processor_accounts").upsert({
      shop_owner: shopOwner,
      qb_bank_account_id: v.bankAccountId,
      qb_fee_account_id: v.feeAccountId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "shop_owner" });
    if (error) return json({ error: `Couldn't save: ${error.message}` }, 500);
    return status();
  }

  if (action === "setEnabled") {
    const want = body.enabled === true;
    const gate = want ? checkCanEnable({ envEnabled, account, viewer, payingPlan: isPayingShop(shop) }) : checkCanDisable({ viewer });
    if (!gate.ok) return json({ error: gate.error }, want ? 400 : 403);
    if (!account && !want) return status();
    const now = new Date().toISOString();
    const { error } = await admin.from("processor_accounts")
      .update({
        enabled: want,
        enabled_at: want ? now : null,
        ...(want && !account?.processor_used_at ? { processor_used_at: now } : {}),
        updated_at: now,
      })
      .eq("shop_owner", shopOwner);
    if (error) return json({ error: `Couldn't save: ${error.message}` }, 500);
    return status();
  }

  return json({ error: `Unknown action: ${action}` }, 400);
}

if (import.meta.main) {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const env = (k: string) => Deno.env.get(k);
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
        env,
        rf: rainforestApi(env),
        qb: {
          connect: (shop) => getShopQb(admin, shop),
          listAccounts: qbListAccounts,
          getInvoice: qbGetInvoice,
        },
      });
    } catch (err) {
      console.error("[rainforest]", err);
      return json({ error: "Something went wrong. Try again in a moment." }, 500);
    }
  });
}
