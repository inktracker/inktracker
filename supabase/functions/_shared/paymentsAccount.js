// Shop-side rules for InkTracker payments (pure, unit-tested). The
// `stripePayments` edge function is a thin shell around these.
//
// Who can do what:
//   - see the status (which way customers pay): anyone on the shop's team
//     except brokers — the send screens need it
//   - map the QuickBooks accounts payouts are booked to: owner or manager
//   - switch InkTracker payments on/off: OWNER ONLY. It changes where the
//     shop's money goes, which is billing, and managers are "full access
//     minus billing".

import { resolvePaymentRail, RAIL, ACTIVE_MERCHANT_STATUSES, paymentsPauseDate, planGraceOver } from "./paymentRail.js";
import { PLATFORM_PRICING, formatRatePct } from "./paymentsPricing.js";

const OWNER_ROLES = ["admin", "shop"];
const TEAM_ROLES = ["admin", "shop", "manager", "employee"];

export const canViewPayments = (p) => TEAM_ROLES.includes(p?.role);
export const canMapQbAccounts = (p) => OWNER_ROLES.includes(p?.role) || p?.role === "manager";
export const canTogglePayments = (p) => OWNER_ROLES.includes(p?.role);

/** Onboarding stage the Account → Payments card shows. */
// Statuses are derived from the Stripe account by
// stripeWebhookAdapter.accountStatusFields: merchant pending | onboarding |
// active | suspended | deactivated | canceled; sign-up in_progress |
// needs_information | in_review | completed | declined.
export function onboardingStage(account) {
  if (!account?.merchant_id) return "not_started";
  const s = String(account.merchant_status ?? "").toLowerCase();
  const app = String(account.merchant_application_status ?? "").toLowerCase();
  if (ACTIVE_MERCHANT_STATUSES.includes(s)) return "active";
  if (s === "suspended") return "suspended";
  if (["deactivated", "canceled"].includes(s) || app === "declined") return "declined";
  if (app === "needs_information") return "needs_information";
  // Merchant "onboarding" = the form was submitted, whatever the (possibly
  // lagging) application status says.
  if (s === "onboarding") return "in_review";
  if (s === "pending" || ["created", "in_progress"].includes(app)) return "in_progress"; // form not submitted yet
  return "in_review";
}

/**
 * A closed account (Stripe rejected it, or the shop disconnected it) can be
 * replaced with a new one — otherwise the shop is locked out forever.
 */
export function canStartOver(account) {
  return Boolean(account?.merchant_id) && onboardingStage(account) === "declined";
}

/**
 * What the frontend gets back from `status`. Never includes the Stripe
 * account id (nothing in the browser needs it), only whether one exists.
 */
export function buildStatusPayload({ envEnabled, account, viewer }) {
  const stage = onboardingStage(account);
  return {
    platformEnabled: Boolean(envEnabled),
    rail: resolvePaymentRail({ envEnabled, account }),
    stage,
    enabled: account?.enabled === true,
    qbAccountsMapped: Boolean(account?.qb_bank_account_id && account?.qb_fee_account_id),
    qbBankAccountId: account?.qb_bank_account_id ?? null,
    qbFeeAccountId: account?.qb_fee_account_id ?? null,
    pricing: {
      card: formatRatePct("card"),
      ach: formatRatePct("ach"),
      cardFixedCents: PLATFORM_PRICING.card.fixedCents,
      achFixedCents: PLATFORM_PRICING.ach.fixedCents,
    },
    // Plan lapsed: when new InkTracker payments stop (or stopped).
    planLapsed: Boolean(account?.plan_lapsed_at),
    paymentsPauseOn: paymentsPauseDate(account),
    paymentsPausedForPlan: planGraceOver(account),
    canToggle: canTogglePayments(viewer),
    canStartOver: canStartOver(account) && canTogglePayments(viewer),
    canMapAccounts: canMapQbAccounts(viewer),
  };
}

/**
 * Can the owner switch InkTracker payments ON? Every blocker is spelled out in
 * shop language so the card can show exactly what's missing.
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function checkCanEnable({ envEnabled, account, viewer, payingPlan = true }) {
  if (!canTogglePayments(viewer)) return { ok: false, error: "Only the shop owner can turn InkTracker payments on or off." };
  if (!envEnabled) return { ok: false, error: "InkTracker payments aren't available yet." };
  if (!payingPlan) return { ok: false, error: "InkTracker payments are part of a paid plan. Renew your plan to turn them on." };
  const stage = onboardingStage(account);
  if (stage === "not_started") return { ok: false, error: "Finish the payments sign-up first." };
  if (stage === "in_progress") return { ok: false, error: "Finish the payments sign-up first." };
  if (stage === "needs_information") return { ok: false, error: "Stripe needs a little more information. Open the sign-up again to finish it." };
  if (stage === "in_review") return { ok: false, error: "Stripe is still reviewing your account. You can turn this on once it's approved." };
  if (stage === "suspended") return { ok: false, error: "Your Stripe account is on hold. Customers keep paying through QuickBooks until it's resolved in your Stripe dashboard." };
  if (stage === "declined") return { ok: false, error: "Your Stripe account isn't available for InkTracker payments, so customers will keep paying through QuickBooks." };
  if (!account.qb_bank_account_id || !account.qb_fee_account_id) {
    return { ok: false, error: "Pick the QuickBooks bank account your payouts land in and the expense account for fees first." };
  }
  return { ok: true };
}

/** Turning it OFF is always allowed for the owner — it just goes back to QuickBooks. */
export function checkCanDisable({ viewer }) {
  return canTogglePayments(viewer)
    ? { ok: true }
    : { ok: false, error: "Only the shop owner can turn InkTracker payments on or off." };
}

/**
 * Validate the QuickBooks account mapping against the shop's real chart of
 * accounts (fetched live by the edge function). The bank account must be a
 * Bank account; the fee account must be an Expense-type account.
 * @param {object} a
 * @param {string} a.bankAccountId
 * @param {string} a.feeAccountId
 * @param {Array<{Id:string, Name:string, AccountType:string, Active?:boolean}>} a.qbAccounts
 */
export function validateQbAccountMapping({ bankAccountId, feeAccountId, qbAccounts }) {
  const list = Array.isArray(qbAccounts) ? qbAccounts : [];
  const find = (id) => list.find((a) => String(a?.Id) === String(id ?? "") && a?.Active !== false);
  const bank = find(bankAccountId);
  const fee = find(feeAccountId);
  if (!bank) return { ok: false, error: "Pick the bank account your payouts land in." };
  if (bank.AccountType !== "Bank") return { ok: false, error: `"${bank.Name}" isn't a bank account in QuickBooks.` };
  if (!fee) return { ok: false, error: "Pick the expense account for processing fees." };
  if (!["Expense", "Other Expense", "Cost of Goods Sold"].includes(fee.AccountType)) {
    return { ok: false, error: `"${fee.Name}" isn't an expense account in QuickBooks.` };
  }
  return { ok: true, bankAccountId: String(bank.Id), feeAccountId: String(fee.Id) };
}

/**
 * Split the shop's QuickBooks accounts into the two pick-lists, suggesting the
 * usual fee account ("Merchant fees", "Bank charges", …) when there is one.
 */
export function qbAccountChoices(qbAccounts) {
  const list = (Array.isArray(qbAccounts) ? qbAccounts : []).filter((a) => a?.Active !== false);
  const pick = (a) => ({ id: String(a.Id), name: String(a.FullyQualifiedName || a.Name || "") });
  const banks = list.filter((a) => a.AccountType === "Bank").map(pick);
  const expenses = list.filter((a) => ["Expense", "Other Expense", "Cost of Goods Sold"].includes(a.AccountType)).map(pick);
  const suggestedFee = expenses.find((e) => /merchant|processing|card fee|bank (service )?charge|payment fee/i.test(e.name)) ?? null;
  return { banks, expenses, suggestedFeeAccountId: suggestedFee?.id ?? null };
}

export { RAIL };
