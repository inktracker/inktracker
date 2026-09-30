// Which way a shop's customers pay: the QuickBooks invoice link (default,
// every shop today) or InkTracker's own payment page (Rainforest, opt-in).
//
// The processor rail applies only when ALL of these hold, so a half-set-up
// shop can never end up with no way to be paid:
//   - the platform kill switch RAINFOREST_ENABLED is on
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

/** Merchant statuses (normalised by the Rainforest adapter) that can take payments. */
export const ACTIVE_MERCHANT_STATUSES = Object.freeze(["active"]);

export function flagOn(raw) {
  const v = String(raw ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * @param {object} a
 * @param {boolean} a.envEnabled   RAINFOREST_ENABLED
 * @param {object|null} a.account  processor_accounts row
 * @param {boolean} [a.broker]     broker invoice/quote → always QB
 */
export function resolvePaymentRail({ envEnabled, account, broker = false }) {
  if (broker || !envEnabled || !account) return RAIL.QB;
  if (account.enabled !== true || !account.merchant_id) return RAIL.QB;
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
 * Read the shop's rail. Fails to the QuickBooks rail on any error.
 * @param {object} supabase service-role client
 * @param {string} shopOwner
 * @param {{ envEnabled: boolean, broker?: boolean }} opts
 */
export async function loadPaymentRail(supabase, shopOwner, { envEnabled, broker = false }) {
  if (broker || !envEnabled || !shopOwner) return RAIL.QB;
  try {
    const { data, error } = await supabase
      .from("processor_accounts")
      .select("shop_owner, merchant_id, merchant_status, enabled")
      .eq("shop_owner", shopOwner)
      .maybeSingle();
    if (error) {
      console.error(`[paymentRail] read failed for ${shopOwner}: ${error.message ?? error} — using QuickBooks rail`);
      return RAIL.QB;
    }
    return resolvePaymentRail({ envEnabled, account: data ?? null, broker });
  } catch (err) {
    console.error(`[paymentRail] read threw for ${shopOwner}: ${err} — using QuickBooks rail`);
    return RAIL.QB;
  }
}
