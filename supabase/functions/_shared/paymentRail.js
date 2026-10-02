// Which way a shop's customers pay: the QuickBooks invoice link (default,
// every shop today) or Stripe Checkout through InkTracker (opt-in).
//
// The processor rail applies only when ALL of these hold, so a half-set-up
// shop can never end up with no way to be paid:
//   - the platform kill switch STRIPE_PAYMENTS_ENABLED is on
//   - the shop finished onboarding (merchant exists and is active)
//   - the shop turned it on
// Anything unknown or unreadable resolves to the QuickBooks rail — the worst
// case of a wrong "qb" is the customer paying through QuickBooks like today;
// the worst case of a wrong "processor" is an invoice nobody can pay.
//
// Broker invoices (shop→broker wholesale bill, broker→client bill in the
// broker's own QuickBooks) always stay on the QuickBooks rail.

export const RAIL = Object.freeze({ QB: "qb", PROCESSOR: "processor" });

/** Reason code returned instead of a QB pay link when the shop is on the processor rail. */
export const PROCESSOR_LINK_REASON = "processor_mode";

/**
 * After a shop's InkTracker plan lapses, customers can keep paying on
 * InkTracker for this long (the owner is warned with the exact date); then
 * NEW payments go back to QuickBooks. Payouts, refunds and disputes are never
 * cut off — only new payments move.
 */
export const PLAN_GRACE_DAYS = 14;

/** Date (YYYY-MM-DD) new InkTracker payments stop for a lapsed shop, or null. */
export function paymentsPauseDate(account) {
  const t = account?.plan_lapsed_at ? new Date(account.plan_lapsed_at).getTime() : NaN;
  if (!Number.isFinite(t)) return null;
  return new Date(t + PLAN_GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** True once a lapsed shop's grace period is over. */
export function planGraceOver(account, now = Date.now()) {
  const t = account?.plan_lapsed_at ? new Date(account.plan_lapsed_at).getTime() : NaN;
  return Number.isFinite(t) && now - t > PLAN_GRACE_DAYS * 24 * 60 * 60 * 1000;
}

/** Account statuses (stripeWebhookAdapter.accountStatusFields) that can take payments. */
export const ACTIVE_MERCHANT_STATUSES = Object.freeze(["active"]);

/** "live" | "test" | null for a Stripe secret key (mode decides what's real). */
export function stripeKeyMode(key) {
  const k = String(key ?? "");
  if (/^(sk|rk)_live_/.test(k)) return "live";
  if (/^(sk|rk)_test_/.test(k)) return "test";
  return null;
}

/**
 * A test document by the shop's own convention: TEST or DEMO in the
 * customer, company or job name. While Stripe is in TEST mode only these use
 * InkTracker payments — every real quote and invoice stays on QuickBooks, so
 * testing never sends a real customer a checkout they can't pay.
 */
export function isTestDocument(doc) {
  const re = /\b(TEST|DEMO)\b/i;
  return [doc?.customer_name, doc?.company, doc?.job_title, doc?.title, doc?.project_name]
    .some((v) => re.test(String(v ?? "")));
}

export function flagOn(raw) {
  const v = String(raw ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Are InkTracker payments open to this shop? The platform switch
 * (STRIPE_PAYMENTS_ENABLED) AND the pilot list (STRIPE_PAYMENTS_SHOPS:
 * comma-separated shop-owner emails, or "*" for every paying shop). An unset
 * list means NO shop: payments only reach shops named on purpose, so turning
 * the platform on (or going live) never opens them to everyone by accident.
 * Money already moving (payouts, refunds, disputes) is never gated by this.
 */
export function paymentsOpenFor(enabledRaw, shopsRaw, shopOwner) {
  if (!flagOn(enabledRaw)) return false;
  const list = String(shopsRaw ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (list.includes("*")) return true;
  const me = String(shopOwner ?? "").trim().toLowerCase();
  return Boolean(me) && list.includes(me);
}

/**
 * @param {object} a
 * @param {boolean} a.envEnabled   STRIPE_PAYMENTS_ENABLED
 * @param {object|null} a.account  processor_accounts row
 * @param {boolean} [a.broker]     broker invoice/quote → always QB
 * @param {string|null} [a.keyMode] mode of the Stripe key in use ("live" | "test")
 * @param {object} [a.doc]         the quote/invoice being paid or sent; omit
 *        for the shop-level status
 */
export function resolvePaymentRail({ envEnabled, account, broker = false, now = Date.now(), keyMode = null, doc = undefined }) {
  if (broker || !envEnabled || !account) return RAIL.QB;
  if (account.enabled !== true || !account.merchant_id) return RAIL.QB;
  // An account made under the other Stripe mode (a test account once the
  // live key is in) doesn't exist there → QuickBooks until set up again.
  if (keyMode && typeof account.stripe_livemode === "boolean" && account.stripe_livemode !== (keyMode === "live")) return RAIL.QB;
  // Test mode: TEST/DEMO documents only.
  if (keyMode !== "live" && doc !== undefined && !isTestDocument(doc)) return RAIL.QB;
  if (planGraceOver(account, now)) return RAIL.QB; // plan lapsed > 14 days ago
  if (!ACTIVE_MERCHANT_STATUSES.includes(String(account.merchant_status ?? "").toLowerCase())) return RAIL.QB;
  return RAIL.PROCESSOR;
}

/**
 * Invoice body for the rail. On the QuickBooks rail the body is returned
 * untouched: InkTracker never sets AllowOnline*Payment for QB-rail shops (the
 * shop's own QuickBooks Payments settings decide). On the processor rail both
 * are explicitly false — QuickBooks must not offer a second way to pay the
 * same invoice, and a sparse update keeps whatever the invoice had before, so
 * omitting them isn't enough.
 */
export function applyRailToInvoiceBody(body, rail) {
  if (rail !== RAIL.PROCESSOR || !body || typeof body !== "object") return body;
  return { ...body, AllowOnlineCreditCardPayment: false, AllowOnlineACHPayment: false };
}

/**
 * Back on QuickBooks after using InkTracker payments: InkTracker turned QB
 * online payment OFF on the shop's invoices, and a sparse update keeps that.
 * For those invoices only — both flags false AND the shop once used the
 * processor rail — turn them back ON so customers can pay the QuickBooks way
 * again. Shops that never opted in are never touched (Joe's 18 Sept rule).
 * @param {object} liveInvoice the invoice as QuickBooks has it now
 * @param {boolean} restore    from loadPaymentRailState
 * @returns {object} fields to merge into the sparse update ({} = none)
 */
export function restoreQbOnlinePayFields(liveInvoice, restore) {
  if (!restore || !liveInvoice) return {};
  const offByUs = liveInvoice.AllowOnlineCreditCardPayment === false && liveInvoice.AllowOnlineACHPayment === false;
  return offByUs ? { AllowOnlineCreditCardPayment: true, AllowOnlineACHPayment: true } : {};
}

/**
 * Rail plus whether QuickBooks online payment needs restoring (see
 * restoreQbOnlinePayFields). Fails to { rail: qb, restore: false }.
 */
/**
 * @param {any} supabase
 * @param {string} shopOwner
 * @param {{ envEnabled: boolean, broker?: boolean, keyMode?: string|null, doc?: object }} opts
 */
export async function loadPaymentRailState(supabase, shopOwner, { envEnabled, broker = false, keyMode = null, doc = undefined }) {
  if (broker || !shopOwner) return { rail: RAIL.QB, restore: false };
  try {
    const { data, error } = await supabase
      .from("processor_accounts")
      .select("shop_owner, merchant_id, merchant_status, enabled, processor_used_at, plan_lapsed_at, stripe_livemode")
      .eq("shop_owner", shopOwner)
      .maybeSingle();
    if (error) {
      console.error(`[paymentRail] read failed for ${shopOwner}: ${error.message ?? error} — using QuickBooks rail`);
      return { rail: RAIL.QB, restore: false };
    }
    const rail = resolvePaymentRail({ envEnabled, account: data ?? null, broker, keyMode, doc });
    return { rail, restore: rail === RAIL.QB && Boolean(data?.processor_used_at) };
  } catch (err) {
    console.error(`[paymentRail] read threw for ${shopOwner}: ${err} — using QuickBooks rail`);
    return { rail: RAIL.QB, restore: false };
  }
}

/**
 * Read the shop's rail. Fails to the QuickBooks rail on any error.
 * @param {object} supabase service-role client
 * @param {string} shopOwner
 * @param {{ envEnabled: boolean, broker?: boolean, keyMode?: string|null, doc?: object }} opts
 */
export async function loadPaymentRail(supabase, shopOwner, { envEnabled, broker = false, keyMode = null, doc = undefined }) {
  if (broker || !envEnabled || !shopOwner) return RAIL.QB;
  try {
    const { data, error } = await supabase
      .from("processor_accounts")
      .select("shop_owner, merchant_id, merchant_status, enabled, plan_lapsed_at, stripe_livemode")
      .eq("shop_owner", shopOwner)
      .maybeSingle();
    if (error) {
      console.error(`[paymentRail] read failed for ${shopOwner}: ${error.message ?? error} — using QuickBooks rail`);
      return RAIL.QB;
    }
    return resolvePaymentRail({ envEnabled, account: data ?? null, broker, keyMode, doc });
  } catch (err) {
    console.error(`[paymentRail] read threw for ${shopOwner}: ${err} — using QuickBooks rail`);
    return RAIL.QB;
  }
}
