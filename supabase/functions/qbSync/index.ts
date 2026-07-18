// QuickBooks sync — handles all QB API operations from the InkTracker frontend.
// Actions: checkConnection | createInvoice | syncExpense | getCustomers

import { createClient } from "npm:@supabase/supabase-js@2.102.1";
import { captureError } from "../_shared/observability.ts";
import { loadProfileWithSecrets, updateProfileSecrets } from "../_shared/profileSecrets.ts";
import { refreshQbTokenSerialized } from "../_shared/qbTokenLock.js";
import { mintPaymentLink } from "../_shared/qbPaymentLink.js";
import { requireActiveSubscription } from "../_shared/subscriptionGuard.ts";
import { parseRetryAfterMs, QbRateLimitError } from "../_shared/qbRateLimit.ts";
import {
  decideTokenRefresh,
  buildRefreshedTokenFields,
  extractConnectionStatus,
} from "../_shared/connectionLogic.js";
import {
  nextAvailableDocNumber as sharedNextAvailableDocNumber,
  buildQBDisplayName,
  buildQBCustomerBody as sharedBuildQBCustomerBody,
  escapeQbStringLiteral,
  isLikelyEmail,
  buildInvoiceLinesFromPayload as sharedBuildInvoiceLinesFromPayload,
  extractPaymentLink as sharedExtractPaymentLink,
  buildQbSendInvoiceUrl,
  stripDocNumberRevision,
  isQbInvoicePaid,
  qbInvoiceHasPayment,
  buildUpdateFailureResponse,
  resolveInvoiceCustomerFields,
  pickIncomeAccountId,
  customerIdentityMatches,
  normalizeItemName,
  clampPaymentAmount,
  dominantItemIncomeAccount,
  buildQbShipAddr,
  isExemptionActive,
  buildTaxRecordFromQbInvoice,
  qbJurisdictionRate,
  stripQbDiscountNote,
  shouldReplaceLocalInvoiceItems,
  shouldCascadeImportedPaid,
  pickQbInvoiceForAdoption,
  mergeCustomerAuthoritative,
} from "../_shared/qbInvoice.js";
import { cascadeMarkInvoicePaid } from "../_shared/qbWebhookLogic.js";
import {
  reconcileQbInvoice,
  RECONCILE_SEVERITY,
} from "../_shared/qbWriteContracts.js";
import { validateQbTokenResponse } from "../_shared/qbOAuthResponse.js";
import { UserFacingError, USER_FACING_CODES, isUserFacingError } from "../_shared/userFacingError.ts";
import { summarizeInvoicesForDashboard } from "../_shared/qbDashboardMetrics.js";
import {
  recordShopNotification,
  buildQbDriftNotification,
} from "../_shared/shopNotifications.js";
import { withQbAudit, logEvent } from "../_shared/qbAudit.js";
import {
  withQbIdempotency,
  withQbRowSerialization,
  IDEMPOTENCY_OUTCOMES,
} from "../_shared/qbIdempotency.js";
import {
  buildQuotePatchFromFreshInvoice,
  decideRefreshConversion,
  REFRESH_CONVERSION,
} from "../_shared/qbRefreshLogic.js";
import {
  classifyLinkInput,
  chooseInvoiceCandidate,
  buildLinkPatch,
  LINK_INPUT_KIND,
  LINK_OUTCOMES,
} from "../_shared/qbLinkLogic.js";
import { convertQuoteToOrder } from "../_shared/qbConvertQuote.js";
import {
  chooseQuotePaymentRecipient,
  buildQuotePaymentEmail,
  sendAndLogApprovalNotification,
} from "../_shared/approvalNotificationEmail.js";

const QB_CLIENT_ID     = Deno.env.get("QB_CLIENT_ID")!;
const QB_CLIENT_SECRET = Deno.env.get("QB_CLIENT_SECRET")!;
const QB_TOKEN_URL     = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const QB_REVOKE_URL    = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
const QB_BASE          = "https://quickbooks.api.intuit.com/v3/company";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Token management ────────────────────────────────────────────────────────

async function refreshToken(refreshTok: string) {
  const res = await fetch(QB_TOKEN_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${btoa(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshTok }),
  });
  if (!res.ok) {
    const body = await res.text();
    // Log the status + parsed `error` only — never the raw body (defensive:
    // avoid persisting any token material Intuit might echo into logs).
    let errCode = "";
    try { errCode = JSON.parse(body)?.error || ""; } catch { /* not JSON */ }
    console.error(`[qbSync] Token refresh failed: ${res.status} ${errCode}`);
    if (body.includes("invalid_grant")) {
      throw new UserFacingError(
        USER_FACING_CODES.QB_DISCONNECTED,
        "Your QuickBooks connection has expired. Please go to Account → QuickBooks and reconnect.",
      );
    }
    throw new UserFacingError(
      USER_FACING_CODES.QB_REFRESH_FAILED,
      "QuickBooks connection error. Please reconnect in Account settings.",
    );
  }
  // Validate the response shape before trusting it. See
  // validateQbTokenResponse for why this matters — malformed OK
  // responses from Intuit would otherwise persist undefined tokens
  // to profile_secrets and lock the shop out.
  const fresh = await res.json();
  const check = validateQbTokenResponse(fresh);
  if (!check.ok) {
    // Log only the shape, never the values — `fresh` can carry a live
    // access/refresh token even when "malformed" (e.g. missing expires_in).
    console.error(`[qbSync] Token refresh returned malformed body (${check.reason}); keys:`, fresh && typeof fresh === "object" ? Object.keys(fresh) : typeof fresh);
    throw new UserFacingError(
      USER_FACING_CODES.QB_MALFORMED_TOKEN,
      "QuickBooks token refresh returned an unexpected response. Please reconnect in Account settings.",
    );
  }
  return fresh;
}

// Best-effort revocation of the OAuth grant at Intuit. Disconnecting should
// invalidate the grant on Intuit's side, not just forget the tokens locally —
// otherwise the grant lingers and old refresh tokens stay usable if our app
// secret ever leaked. Revoking the refresh token kills the whole grant. Never
// throws: if Intuit is down or the token's already invalid, we still clear
// locally (the caller proceeds regardless).
async function revokeQbToken(token: string | null): Promise<void> {
  if (!token) return;
  try {
    const res = await fetch(QB_REVOKE_URL, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${btoa(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`)}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({ token }),
    });
    if (!res.ok && res.status !== 200) {
      console.error(`[qbSync] Token revoke returned ${res.status} (continuing; tokens cleared locally)`);
    }
  } catch (err) {
    console.error("[qbSync] Token revoke request failed (continuing; tokens cleared locally):", (err as Error)?.message);
  }
}

async function findUserProfile(supabase: any, authId: string, email: string | null) {
  // Use service role to read profile_secrets (RLS blocks user client)
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let profile = await loadProfileWithSecrets(admin, { auth_id: authId });

  // Fallback: match by email (profile may pre-date the auth user; auth_id still NULL)
  if (!profile && email) {
    const byEmail = await loadProfileWithSecrets(admin, { email });
    if (byEmail) {
      // Backfill auth_id so future lookups are fast
      if (!byEmail.auth_id) {
        await supabase.from("profiles").update({ auth_id: authId }).eq("id", byEmail.id);
        byEmail.auth_id = authId;
      }
      profile = byEmail;
    }
  }

  if (!profile) return null;

  // Team members (manager/employee) have no QuickBooks connection of their own —
  // the shop's QB connection lives on the OWNER's profile_secrets. Resolve the
  // owner so a team member's checkConnection / dashboard metrics / invoicing use
  // the SHOP's connection (a manager-partner is a full operator, minus billing).
  // ADDITIVE + safe: an owner has their own qb_access_token and never reaches
  // this branch, so owner behavior is byte-for-byte unchanged. Only a profile
  // WITHOUT its own token AND with a shop_owner (i.e. a team member) falls back.
  if (!profile.qb_access_token && profile.shop_owner) {
    const owner = await loadProfileWithSecrets(admin, { email: profile.shop_owner });
    if (owner?.qb_access_token) return owner;
  }

  return profile;
}

async function getValidTokens(supabase: any, authId: string, email: string | null) {
  const profile = await findUserProfile(supabase, authId, email);

  if (!profile?.qb_access_token) {
    throw new UserFacingError(
      USER_FACING_CODES.QB_NOT_CONNECTED,
      "QuickBooks not connected. Please connect your account in Settings.",
    );
  }

  // Refresh (when near expiry) under a DB lease lock so two concurrent QB
  // actions don't both refresh and clobber Intuit's rotating refresh token.
  // Pure refresh-decision + lease logic live in ../_shared (unit-tested).
  const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    return await refreshQbTokenSerialized(adminClient, profile, {
      decideRefresh: decideTokenRefresh,
      refreshFn: refreshToken,
      buildFields: buildRefreshedTokenFields,
      persist: (id: string, fields: any) => updateProfileSecrets(adminClient, id, fields),
      reload: (id: string) => loadProfileWithSecrets(adminClient, { id }),
    });
  } catch (err) {
    // refreshToken throws tagged UserFacingErrors (invalid_grant → QB_DISCONNECTED,
    // etc.) — let those through untouched. Only a persistence/lease failure is
    // wrapped into the generic save error.
    if (err instanceof UserFacingError) throw err;
    console.error("[qbSync] CRITICAL: failed to persist refreshed QB tokens:", err);
    throw new Error("Could not save refreshed QuickBooks tokens. Please try again.");
  }
}

// ── QB API helpers ──────────────────────────────────────────────────────────

function qbHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" };
}

// Retry policy shared by qbQuery / qbCreate / qbUpdate. Three attempts
// with 0 / 500ms / 1.5s backoff for 5xx + transient network errors. 4xx
// responses other than 429 are NOT retried — they're caller-side
// problems (auth, validation) that won't get better.
//
// 429 (rate-limit) gets its own treatment: respect Intuit's Retry-After
// header if present, otherwise fall back to longer fixed backoff because
// rate-limit windows clear with time, not with quick retries. The header
// is parsed in seconds (RFC 7231); we cap at 10s so an aggressively long
// Retry-After can't hang an edge function past its execution budget.
// When all retries exhaust on 429, we throw a tagged QbRateLimitError so
// the action dispatcher can return a structured response instead of an
// opaque "QB failed" — operators see "QuickBooks is rate-limiting; try
// again in ~N seconds" and know it's not a real failure.
const QB_RETRY_DELAYS_MS = [0, 500, 1500];
const QB_RATE_LIMIT_DELAYS_MS = [0, 1500, 4000];

async function qbFetchWithRetry(
  url: string,
  init: RequestInit,
  label: string,
): Promise<{ res: Response; data: any }> {
  let lastErr: unknown = null;
  let lastRetryAfterMs: number | null = null;
  for (let attempt = 0; attempt < QB_RETRY_DELAYS_MS.length; attempt++) {
    // 429 path uses the longer rate-limit schedule (or the Retry-After
    // we parsed on the previous loop iteration).
    const baseDelay = QB_RETRY_DELAYS_MS[attempt];
    const delay = lastRetryAfterMs !== null
      ? lastRetryAfterMs
      : baseDelay;
    if (delay > 0) {
      await new Promise((r) => setTimeout(r, delay));
    }
    lastRetryAfterMs = null;
    try {
      const res = await fetch(url, init);
      // Always read the body so callers can inspect QB error payloads.
      let data: any = null;
      try { data = await res.json(); } catch { data = null; }
      if (res.ok) return { res, data };
      if (res.status === 429) {
        const headerMs = parseRetryAfterMs(res.headers.get("Retry-After"));
        const fallbackMs = QB_RATE_LIMIT_DELAYS_MS[attempt + 1] ?? QB_RATE_LIMIT_DELAYS_MS[QB_RATE_LIMIT_DELAYS_MS.length - 1];
        lastRetryAfterMs = headerMs ?? fallbackMs;
        lastErr = new QbRateLimitError(label, Math.ceil(lastRetryAfterMs / 1000));
        console.warn(`[qb] ${label} attempt ${attempt + 1} rate-limited, retry in ${Math.ceil(lastRetryAfterMs / 1000)}s`);
        continue;
      }
      if (res.status >= 500) {
        // Transient — retry
        lastErr = new Error(`QB ${label} ${res.status}: ${JSON.stringify(data)}`);
        console.warn(`[qb] ${label} attempt ${attempt + 1} got ${res.status}, will retry`);
        continue;
      }
      // Other 4xx — don't retry, hand back to the caller so they can
      // branch on the body (e.g. "Duplicate Document Number").
      return { res, data };
    } catch (err) {
      // Network-layer failures (DNS, TLS, fetch threw). Always retry.
      lastErr = err;
      console.warn(`[qb] ${label} attempt ${attempt + 1} network error, will retry:`, (err as Error)?.message);
      continue;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`QB ${label} failed after retries`);
}

async function qbQuery(token: string, realmId: string, query: string) {
  const url = `${QB_BASE}/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=65`;
  const { res, data } = await qbFetchWithRetry(url, { headers: qbHeaders(token) }, `query`);
  if (!res.ok) {
    // Re-read body as text for the error message — data may have parsed
    // as JSON above but we want the raw if QB returned a non-JSON 4xx.
    throw new Error(`QB query failed: ${res.status} ${data != null ? JSON.stringify(data) : ""}`);
  }
  return data;
}

async function qbCreate(token: string, realmId: string, entity: string, body: object) {
  const url = `${QB_BASE}/${realmId}/${entity}?minorversion=65`;
  const { res, data } = await qbFetchWithRetry(
    url,
    { method: "POST", headers: qbHeaders(token), body: JSON.stringify(body) },
    `create ${entity}`,
  );
  if (!res.ok) throw new Error(`QB create ${entity} failed: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

// Pick the next free DocNumber for a quote. If `base` is unused, returns base.
// Otherwise tries base-r2, base-r3, ... up to base-r99. Falls back to a
// timestamp suffix if (somehow) all 99 revisions are taken.
// Pure logic + tests live in ../_shared/qbInvoice.js + __tests__.
const nextAvailableDocNumber = sharedNextAvailableDocNumber;

async function qbUpdate(token: string, realmId: string, entity: string, body: object) {
  const url = `${QB_BASE}/${realmId}/${entity}?minorversion=65`;
  const { res, data } = await qbFetchWithRetry(
    url,
    { method: "POST", headers: qbHeaders(token), body: JSON.stringify(body) },
    `update ${entity}`,
  );
  if (!res.ok) throw new Error(`QB update ${entity} failed: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

// POST /invoice/{id}/send is the only QBO endpoint that mints the customer-
// facing share link (`connect.intuit.com/portal/app/CommerceNetwork/view/scs-v1-…`).
// We pass the customer's email as `sendTo`. QBO sends them a copy of the
// invoice (their normal /send flow) AND mints the portal record with their
// email pre-filled in "Your info → Email" on the payment page. The portal
// record is snapshotted at /send time and not refreshed by later updates —
// that's why we use the real address rather than a sink + later restore.
// Customer ends up with two emails (ours via Resend + QBO's), both linking
// to the same anonymous-pay portal.
//
// Retries on 5xx + transient network errors (up to 3 attempts, 500ms /
// 1.5s backoff). QBO has occasional blips and a single failure here is
// the most common reason a shop ends up with an invoice + no payment
// link (the "send_failed" frontend state). 4xx errors are NOT retried —
// they're configuration problems (auth, malformed payload, etc.) that
// won't get better with another attempt.
async function qbSendInvoice(token: string, realmId: string, invoiceId: string, sendTo: string) {
  const url = buildQbSendInvoiceUrl(QB_BASE, realmId, invoiceId, sendTo);
  const delays = [0, 500, 1500];
  let lastErr: unknown = null;
  // Carries over a Retry-After-derived delay from a 429 to the next iteration.
  let rateLimitOverrideMs: number | null = null;
  for (let attempt = 0; attempt < delays.length; attempt++) {
    const delay = rateLimitOverrideMs !== null ? rateLimitOverrideMs : delays[attempt];
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    rateLimitOverrideMs = null;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/octet-stream" },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return data;
      if (res.status === 429) {
        const headerMs = parseRetryAfterMs(res.headers.get("Retry-After"));
        // Use Intuit's Retry-After if present, else longer fallback than 5xx.
        rateLimitOverrideMs = headerMs ?? 4000;
        lastErr = new QbRateLimitError(`send invoice/${invoiceId}`, Math.ceil(rateLimitOverrideMs / 1000));
        console.warn(`[qbSendInvoice] attempt ${attempt + 1} rate-limited, retry in ${Math.ceil(rateLimitOverrideMs / 1000)}s`);
        continue;
      }
      if (res.status >= 500) {
        // Transient — retry
        lastErr = new Error(`QB send invoice/${invoiceId} ${res.status}: ${JSON.stringify(data)}`);
        console.warn(`[qbSendInvoice] attempt ${attempt + 1} failed (${res.status}), will retry`);
        continue;
      }
      // 4xx — caller config / data problem, don't retry
      throw new Error(`QB send invoice/${invoiceId} failed: ${res.status} ${JSON.stringify(data)}`);
    } catch (err) {
      lastErr = err;
      // Network errors (fetch threw): retry
      if (!(err instanceof Error) || !err.message?.startsWith("QB send invoice")) {
        console.warn(`[qbSendInvoice] attempt ${attempt + 1} network/parse error, will retry:`, err);
        continue;
      }
      // 4xx-style errors thrown above — rethrow immediately
      throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`QB send invoice/${invoiceId} failed after retries`);
}

// Re-fetch an invoice with ?include=invoiceLink. QBO's portal record is
// provisioned asynchronously, so /send sometimes returns 200 without the
// share link populated. A subsequent GET a moment later picks it up.
async function qbFetchInvoiceWithLink(token: string, realmId: string, invoiceId: string) {
  const url = `${QB_BASE}/${realmId}/invoice/${invoiceId}?minorversion=65&include=invoiceLink`;
  const res = await fetch(url, { headers: qbHeaders(token) });
  if (!res.ok) {
    console.warn(`[qbFetchInvoiceWithLink] GET /invoice/${invoiceId}?include=invoiceLink → ${res.status}`);
    return null;
  }
  return res.json();
}

// Wraps the full "mint a customer-facing payment link" flow:
//   1. POST /invoice/{id}/send (with built-in 5xx retries)
//   2. extractPaymentLink — return immediately if present
//   3. Sleep 1.5s, GET /invoice/{id}?include=invoiceLink (catches async
//      portal provisioning)
//   4. Sleep another 3s, refetch one more time
//   5. Give up — return a structured reason so the frontend can show
//      actionable guidance (the most likely cause when QBO claims success
//      but doesn't mint a link is that the shop hasn't activated QB
//      Payments on their account)
//
// Returns { link, finalInvoice, reason } where reason is null on success
// and a short string code otherwise: "send_failed" | "no_link_after_retry"
// | "no_bill_email"
async function mintInvoicePaymentLink(
  token: string,
  realmId: string,
  invoiceId: string,
  billEmail: string | null,
  initialInvoice: any,
  skipSend = false,
): Promise<{ link: string | null; finalInvoice: any; reason: string | null }> {
  // Thin wrapper over the pure, unit-tested orchestrator in
  // ../_shared/qbPaymentLink.js: try include=invoiceLink (no email) first, fall
  // back to /send (emails) only if it yields no link. Keeps the duplicate QB
  // email off by default while never breaking payment. When skipSend is set
  // (invoice/order flow), the /send fallback is suppressed entirely — QB never
  // emails the customer.
  const result = await mintPaymentLink({
    initialInvoice,
    billEmail,
    skipSend,
    extractLink: sharedExtractPaymentLink,
    fetchLink: async () => {
      const r = await qbFetchInvoiceWithLink(token, realmId, invoiceId);
      return r ? (r.Invoice || r) : null;
    },
    sendInvoice: async (email: string) => {
      const s = await qbSendInvoice(token, realmId, invoiceId, email);
      return s ? (s.Invoice || s) : null;
    },
  });
  if (result.link) {
    console.log(`[mintInvoicePaymentLink] link minted (${result.emailed ? "/send fallback — QB email sent" : "include=invoiceLink — no QB email"})`);
  } else {
    console.warn(`[mintInvoicePaymentLink] no link (${result.reason}). Most likely the shop hasn't activated QB Payments.`);
  }
  return { link: result.link, finalInvoice: result.finalInvoice, reason: result.reason };
}

// ── Find or create QB Customer ──────────────────────────────────────────────

// Pure logic + tests live in ../_shared/qbInvoice.js + __tests__.
const buildQBCustomerBody = sharedBuildQBCustomerBody;

async function updateQBCustomer(token: string, realmId: string, qbId: string, customer: any) {
  const displayName = buildQBDisplayName(customer);

  // Fetch current SyncToken (required for QB updates). Escape qbId
  // even though it normally arrives as digits from QB — defense in
  // depth in case a malformed id ever slips into the column.
  const existing = await qbQuery(token, realmId, `SELECT Id, SyncToken FROM Customer WHERE Id = '${escapeQbStringLiteral(qbId)}'`);
  const current = existing?.QueryResponse?.Customer?.[0];
  if (!current) return qbId;

  const body: any = buildQBCustomerBody(customer, displayName);
  body.Id = qbId;
  body.SyncToken = current.SyncToken;
  body.sparse = true;

  await qbUpdate(token, realmId, "customer", body);
  return qbId;
}

async function findOrCreateCustomer(token: string, realmId: string, customer: any, supabase: any) {
  if (!customer) throw new Error("No customer data provided");

  // Authoritative re-read, INSIDE the resolver so every caller inherits it
  // (createInvoice, estimateTax, syncCustomer — and anything added later).
  // The payload may be a stub ({id, name} from a modal whose customer never
  // loaded); matching a stub against QB finds nothing and MINTS A DUPLICATE
  // QB customer (the email-less "Lisa Gotts", 2026-07-17). The customers row
  // is the authority for identity + the stored QB link; the payload only
  // fills fields the row lacks. Redundant with handleCreateInvoice's own
  // merge (one extra PK lookup) — kept here so the invariant doesn't depend
  // on callers remembering to hydrate.
  if (customer.id) {
    try {
      const { data: dbCust } = await supabase
        .from("customers")
        .select("*")
        .eq("id", customer.id)
        .maybeSingle();
      if (dbCust) customer = mergeCustomerAuthoritative(customer, dbCust);
    } catch (e) {
      console.error("[QB] customer authoritative re-read failed (using payload):", (e as Error)?.message);
    }
  }

  // If already linked, push non-empty fields back to QB (sparse update — never wipes QB data)
  if (customer.qb_customer_id) {
    try {
      await updateQBCustomer(token, realmId, customer.qb_customer_id, customer);
    } catch (err) {
      console.warn("[QB] customer update failed (non-blocking):", (err as any)?.message);
    }
    return customer.qb_customer_id;
  }

  const displayName = buildQBDisplayName(customer);

  // Search QB for existing customer by email or name.
  // Errors from these searches MUST propagate. The previous behavior
  // swallowed everything (including 401 token-expired / 429 rate-limit
  // / 500 transient) and silently fell through to the CREATE path —
  // which then minted a DUPLICATE QB customer record because the search
  // never actually ran. qbQuery already retries 5xx; if it still throws
  // after retries, it's a real problem and the caller should hear it.
  let qbCustomerId: string | null = null;

  // Fetch candidate rows with the fields needed to verify identity.
  const queryCustomers = async (where: string) => {
    const res = await qbQuery(token, realmId,
      `SELECT Id, DisplayName, CompanyName, GivenName, PrimaryEmailAddr FROM Customer WHERE ${where} MAXRESULTS 20`
    );
    return res?.QueryResponse?.Customer ?? [];
  };

  // 1. Email — the strongest signal. Only when it actually looks like an
  // email (junk values in customers.email would blow the query syntax).
  if (isLikelyEmail(customer.email)) {
    const rows = await queryCustomers(`PrimaryEmailAddr = '${escapeQbStringLiteral(customer.email.trim())}'`);
    if (rows.length > 0) qbCustomerId = rows[0].Id;
  }

  // 2. Exact DisplayName (our canonical "company (name)" format).
  if (!qbCustomerId) {
    const rows = await queryCustomers(`DisplayName = '${escapeQbStringLiteral(displayName)}'`);
    if (rows.length > 0) qbCustomerId = rows[0].Id;
  }

  // 3. CompanyName + GivenName — finds the SAME company+contact even when
  // the existing QB record's DisplayName is formatted differently (e.g. an
  // imported "Acme - John"). Requires BOTH to match so distinct contacts
  // at one company are never merged.
  if (!qbCustomerId && customer?.company && customer?.name) {
    const rows = await queryCustomers(
      `CompanyName = '${escapeQbStringLiteral(String(customer.company).trim())}' ` +
      `AND GivenName = '${escapeQbStringLiteral(String(customer.name).trim())}'`
    );
    const hit = rows.find((r: any) => customerIdentityMatches(r, customer));
    if (hit) qbCustomerId = hit.Id;
  }

  // 4. Normalized fuzzy match — catches cosmetic duplicates (case /
  // whitespace / punctuation: "Acme Inc" vs "acme, inc."). Fetch
  // candidates by the first token via LIKE, then compare normalized in JS
  // (customerIdentityMatches still requires company+contact to agree).
  if (!qbCustomerId) {
    const anchor = String(customer?.company || customer?.name || "").trim();
    const firstToken = anchor.split(/\s+/)[0] || "";
    if (firstToken.length >= 2) {
      const rows = await queryCustomers(`DisplayName LIKE '${escapeQbStringLiteral(firstToken)}%'`);
      const hit = rows.find((r: any) => customerIdentityMatches(r, customer));
      if (hit) qbCustomerId = hit.Id;
    }
  }

  // Create customer if not found
  if (!qbCustomerId) {
    const newCustomer = buildQBCustomerBody(customer, displayName);
    try {
      const created = await qbCreate(token, realmId, "customer", newCustomer);
      qbCustomerId = created?.Customer?.Id;
    } catch (createErr: any) {
      // Safety net: a single QB-rejected field on the customer must never
      // block the entire invoice. QBO's customer validation is fussy and
      // varies by company config (Automated Sales Tax, locale, etc.) — e.g.
      // it rejects customer-level Taxable in AST files, and has rejected
      // odd ResaleNum/Notes values. Rather than fail the whole "Create QB
      // Invoice & Send Quote" flow, retry once with the bare-minimum
      // identity fields (name + email), which QB always accepts. The
      // invoice's own line-level tax codes still produce the correct total.
      const msg = String(createErr?.message || "");
      const isValidation = msg.includes(" 400 ") || /ValidationFault|Business Validation|2030|6240/i.test(msg);
      if (!isValidation) throw createErr;
      const minimalCustomer: any = {
        DisplayName: displayName,
        PrintOnCheckName: customer?.company || customer?.name || displayName,
      };
      if (customer?.company) minimalCustomer.CompanyName = customer.company;
      if (customer?.name)    minimalCustomer.GivenName   = customer.name;
      if (isLikelyEmail(customer?.email)) minimalCustomer.PrimaryEmailAddr = { Address: customer.email.trim() };
      console.error(
        `[QB] customer create rejected (${msg}); retrying with minimal identity body ` +
        `for DisplayName="${displayName}". Dropped optional fields (notes/phone/address/tax).`,
      );
      const created = await qbCreate(token, realmId, "customer", minimalCustomer);
      qbCustomerId = created?.Customer?.Id;
    }
  }

  // Save QB customer ID back to InkTracker
  if (qbCustomerId && customer.id) {
    await supabase.from("customers").update({ qb_customer_id: qbCustomerId }).eq("id", customer.id);
  }

  return qbCustomerId;
}

// ── Find or create a generic QB Service Item ────────────────────────────────

const DEFAULT_ITEM_NAME = "Custom Apparel";

async function findIncomeAccountId(token: string, realmId: string, configuredId: string | null = null) {
  // Use the shop's explicitly chosen account when set + still present; else
  // guess by name, else the first Income account (pure picker — tested).
  try {
    const res = await qbQuery(token, realmId,
      "SELECT Id, Name, AccountType FROM Account WHERE AccountType = 'Income' MAXRESULTS 100"
    );
    const accts: any[] = res?.QueryResponse?.Account ?? [];
    const { id } = pickIncomeAccountId(accts, configuredId);
    if (id) return id;
  } catch {}

  // Create a fallback Income account if none exists
  const created = await qbCreate(token, realmId, "account", {
    Name: "InkTracker Sales",
    AccountType: "Income",
    AccountSubType: "SalesOfProductIncome",
  });
  return created?.Account?.Id ?? null;
}

// Resolve every unique item name referenced in a payload to its QB Item Id.
// Fetches the shop's existing items ONCE and matches by exact name, then by
// NORMALIZED name (so "T-Shirts" reuses an existing "T-Shirt" instead of
// creating a duplicate that splits the sales-by-product report). Only
// creates a Service item when nothing matches.
async function resolveItemIdMap(
  token: string,
  realmId: string,
  invoicePayload: any,
  configuredIncomeAccountId: string | null = null,
): Promise<Map<string, string>> {
  const names = new Set<string>();
  for (const line of invoicePayload?.lines ?? []) {
    names.add((line.itemName || DEFAULT_ITEM_NAME).trim());
  }
  names.add(DEFAULT_ITEM_NAME);

  // One fetch of existing items (any type — we reuse whatever exists with a
  // matching name, regardless of Service/Inventory). Also grab each item's
  // income account so a NEW item can inherit the shop's dominant account
  // instead of introducing a different one (which splits the P&L). Index by
  // exact AND normalized name.
  const itemsRes = await qbQuery(token, realmId, "SELECT Id, Name, IncomeAccountRef FROM Item MAXRESULTS 1000");
  const existingItems: any[] = (itemsRes?.QueryResponse?.Item ?? []).filter((i: any) => i && i.Name);
  const byExact = new Map<string, string>();
  const byNorm = new Map<string, string>();
  for (const it of existingItems) {
    byExact.set(it.Name, String(it.Id));
    const n = normalizeItemName(it.Name);
    if (n && !byNorm.has(n)) byNorm.set(n, String(it.Id));
  }

  // Income account for any NEW item: the shop's explicit choice → the
  // account most of their existing items already use → name-based guess.
  // The dominant-account step is what stops InkTracker splitting revenue
  // across "Sales" and "Sales of Product Income".
  const dominantIncome = dominantItemIncomeAccount(existingItems);
  const incomeAccountId = await findIncomeAccountId(token, realmId, configuredIncomeAccountId || dominantIncome);
  if (!incomeAccountId) throw new Error("No QB Income account found; cannot create service items");

  const map = new Map<string, string>();
  for (const name of names) {
    let id = byExact.get(name) || byNorm.get(normalizeItemName(name)) || null;
    if (!id) {
      const created = await qbCreate(token, realmId, "item", {
        Name: name,
        Type: "Service",
        IncomeAccountRef: { value: incomeAccountId },
      });
      id = created?.Item?.Id ?? null;
      // Index the new item so another name in THIS payload that normalizes
      // to the same value reuses it instead of creating a second duplicate.
      if (id) {
        byExact.set(name, id);
        const n = normalizeItemName(name);
        if (n) byNorm.set(n, id);
      }
    }
    if (id) map.set(name, id);
  }
  return map;
}

// ── Build QB invoice lines from InkTracker quote ────────────────────────────

// Build QB invoice lines from a pre-computed payload (built on the frontend
// using the same pricing helpers the UI uses, so totals match the quote).
// Each line may carry an `itemName` (e.g. "Embroidery", "Screen Printing") which
// is resolved to the matching QB Item Id via itemIdMap. Lines with no mapping
// fall back to the default item.
// Pure logic + tests live in ../_shared/qbInvoice.js + __tests__.
const buildInvoiceLinesFromPayload = sharedBuildInvoiceLinesFromPayload;
const extractPaymentLink = (invoiceData: any, _realmId?: string) => sharedExtractPaymentLink(invoiceData);

// ── Action: createInvoice ───────────────────────────────────────────────────

async function handleCreateInvoice(token: string, realmId: string, params: any, supabase: any) {
  const { quote, invoicePayload } = params;
  // When true, suppress QBO's /send fallback so creating the invoice never
  // emails the customer (invoice/order flow — the shop sends via InkTracker).
  const noEmail = !!params?.noEmail;

  if (!invoicePayload?.lines?.length) {
    throw new Error("Missing invoicePayload — frontend must compute quote totals");
  }

  // ── Authoritative state re-read ──────────────────────────────────────────
  // The payload's quote/customer are snapshots of DB rows as the calling
  // window last saw them — possibly fetched before another surface's sync
  // finished its write-back. Trusting a stale snapshot's empty qb_invoice_id
  // is how the INV-2026-OW0M1 duplicate was minted (2026-07-17): the invoice
  // modal pushed seconds after the order-completion push, its snapshot
  // predated the write-back, and the CREATE path fired a -r2 under a
  // freshly-duplicated customer. The DB is the authority for both links;
  // the payload only fills in when the row can't be read.
  let sourceRow: any = null;
  if (quote?.id) {
    for (const table of ["invoices", "quotes"]) {
      const { data, error } = await supabase
        .from(table)
        .select(table === "invoices"
          ? "id, qb_invoice_id, qb_doc_number, order_id"
          : "id, qb_invoice_id, qb_doc_number, quote_id")
        .eq("id", quote.id)
        .maybeSingle();
      if (!error && data) { sourceRow = data; break; }
    }
    if (sourceRow?.qb_invoice_id && String(sourceRow.qb_invoice_id) !== String(quote.qb_invoice_id || "")) {
      console.error(
        `[createInvoice] Payload qb_invoice_id ("${quote.qb_invoice_id || ""}") is stale — ` +
        `DB row ${quote.id} says "${sourceRow.qb_invoice_id}". Using the DB value.`,
      );
    }
  }

  let customer = params.customer;
  if (customer?.id) {
    const { data: dbCust, error: custErr } = await supabase
      .from("customers")
      .select("*")
      .eq("id", customer.id)
      .maybeSingle();
    if (!custErr && dbCust) customer = mergeCustomerAuthoritative(customer, dbCust);
  }

  // 1. Find or create customer in QB
  const qbCustomerId = await findOrCreateCustomer(token, realmId, customer, supabase);
  if (!qbCustomerId) throw new Error("Could not find or create QuickBooks customer");

  // 2. Resolve every QB item referenced by the payload (one per technique).
  //    Use the shop's chosen income account when set (default-until-set: a
  //    null lookup falls back to qbSync's guess, so existing shops are
  //    unaffected). Lookup failure is non-fatal — also falls back to guessing.
  let configuredIncomeAccountId: string | null = null;
  try {
    const shopOwnerForAcct = quote?.shop_owner;
    if (shopOwnerForAcct) {
      const acctClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data: shopRow } = await acctClient
        .from("shops")
        .select("qb_income_account_id")
        .eq("owner_email", shopOwnerForAcct)
        .maybeSingle();
      configuredIncomeAccountId = shopRow?.qb_income_account_id || null;
    }
  } catch (e) {
    console.error("[createInvoice] income-account lookup failed (using default):", (e as Error)?.message);
  }
  const itemIdMap = await resolveItemIdMap(token, realmId, invoicePayload, configuredIncomeAccountId);

  // 3. Resolve tax-exempt status. InkTracker is the exemption authority:
  // honor the exemption only when it's ACTIVE — not expired and (for scoped
  // certs) covering the ship-to state. An expired or out-of-scope cert
  // collects tax, which is the audit-safe behavior. See
  // docs/qb-multistate-tax-scope.md.
  const todayIso = new Date().toISOString().slice(0, 10);
  const destinationState = customer?.ship_to_address?.state;
  let isTaxExempt = isExemptionActive(customer, { asOf: todayIso, destinationState });
  try {
    const qbCustData = await qbQuery(token, realmId, `SELECT * FROM Customer WHERE Id = '${escapeQbStringLiteral(qbCustomerId)}'`);
    const qbCust = qbCustData?.QueryResponse?.Customer?.[0];
    // Fallback: honor QB's own exempt flag ONLY when InkTracker has no
    // exemption on file. If IT marks the customer exempt but the cert is
    // expired/out-of-scope, IT's decision (collect tax) must win — a stale
    // QB Taxable=false can't silently re-exempt them.
    if (!customer?.tax_exempt && qbCust?.Taxable === false) isTaxExempt = true;
    console.error(`[createInvoice] QB customer ${qbCustomerId} Taxable=${qbCust?.Taxable}, isTaxExempt=${isTaxExempt}`);
  } catch (e) {
    console.error("[createInvoice] QB customer tax check failed (non-fatal):", e);
  }

  // 4. Build invoice lines from the precomputed payload (matches UI totals)
  const lines = buildInvoiceLinesFromPayload(invoicePayload, itemIdMap, DEFAULT_ITEM_NAME, isTaxExempt);
  if (lines.length === 0) throw new Error("Invoice payload has no valid lines");

  // 5. Create the invoice.
  // Email gating: QB rejects the whole invoice with 400 ValidationFault
  // if BillEmail isn't RFC 822-shaped (e.g. a customer name accidentally
  // saved in the email column). Pick the first source that looks like
  // an email; if neither does, omit BillEmail entirely so QB just
  // creates the invoice without an email on file.
  const candidateEmails = [quote.customer_email, customer?.email];
  const billEmail = candidateEmails.find((e) => isLikelyEmail(e))?.trim() || null;
  if ((quote.customer_email || customer?.email) && !billEmail) {
    console.error(`[createInvoice] Dropping invalid email "${quote.customer_email || customer?.email}" — not RFC 822 shaped`);
  }
  const billAddress = customer?.address;
  // Structured ship-to for QB Automated Sales Tax. When the customer has a
  // ship-to with state + zip, this carries City/State/ZIP so AST sources the
  // DESTINATION jurisdiction; otherwise it falls back to a Line1-only address
  // (AST then uses the shop's home rate, and the Phase-0 tax hold catches any
  // resulting mismatch). See docs/qb-multistate-tax-scope.md.
  const shipAddr = buildQbShipAddr(customer?.ship_to_address, billAddress);

  const baseDocNumber = String(quote.quote_id || "");

  // Tax handling: let QB auto-calculate tax using its own tax codes/rates.
  const taxPercent = parseFloat(invoicePayload?.taxPercent) || 0;

  // Per-line tax: garments + setup + taxable fees → TAX; non-taxable fees
  // (e.g. shipping) → NON. Tax-exempt customers or a 0% rate force NON on all.
  // Strip the transient _taxable/_isFee hints (set by buildInvoiceLinesFromPayload)
  // so they never reach QuickBooks.
  lines.forEach((l: any) => {
    if (l.SalesItemLineDetail) {
      const lineTaxable = l._taxable !== false;
      const code = (isTaxExempt || taxPercent === 0 || !lineTaxable) ? "NON" : "TAX";
      l.SalesItemLineDetail.TaxCodeRef = { value: code };
    }
    delete l._taxable;
    delete l._isFee;
  });

  console.error(`[createInvoice] Tax: rate=${taxPercent}%, isTaxExempt=${isTaxExempt}, lines=${lines.length}`);

  let created: any;
  // DB row wins over the caller's snapshot (see authoritative re-read above).
  let qbInvoiceId: string = String(sourceRow?.qb_invoice_id || quote.qb_invoice_id || "");
  let qbInvoiceFinal: any;
  // How the invoice-to-update was found when the caller's snapshot had no
  // qb_invoice_id. Surfaced in the response (→ qb_event_log) for forensics.
  let adoptionSource: string | null = null;
  if (qbInvoiceId && !quote.qb_invoice_id) adoptionSource = "db_row";
  // NEW-12 idempotency: true when we're resyncing an invoice that ALREADY has a
  // payment applied in QB (e.g. the deposit posted on a prior sync). Gates the
  // deposit-recording step below so a re-send / re-"Create in QB" can't post the
  // deposit twice. Stays false on a first-time create (no existing invoice), so
  // a genuine deposit is still recorded exactly once.
  let existingInvoiceHadPayment = false;

  // ── Adoption guard 1: order-born invoice whose source QUOTE is in QB ──────
  // A quote pushed to QB stamps qb_invoice_id on the QUOTES row only; an
  // invoices row for it appears when the next pull imports it. Complete the
  // order inside that window and the fresh INV- row knows nothing about the
  // Q- invoice already in QB — pushing it would mint a SECOND QB invoice for
  // the same job under a different DocNumber (no -rN to even hint at the
  // duplicate). Walk invoices.order_id → orders.quote_id → quotes.qb_invoice_id
  // and adopt the quote's invoice; the update path keeps its Q- DocNumber.
  if (!qbInvoiceId && quote?.shop_owner) {
    const orderId = String(quote?.order_id || sourceRow?.order_id || "");
    if (orderId) {
      try {
        const { data: orderRow } = await supabase
          .from("orders")
          .select("quote_id")
          .eq("shop_owner", quote.shop_owner)
          .eq("order_id", orderId)
          .maybeSingle();
        if (orderRow?.quote_id) {
          const { data: srcQuote } = await supabase
            .from("quotes")
            .select("qb_invoice_id, quote_id")
            .eq("shop_owner", quote.shop_owner)
            .eq("quote_id", orderRow.quote_id)
            .maybeSingle();
          if (srcQuote?.qb_invoice_id) {
            qbInvoiceId = String(srcQuote.qb_invoice_id);
            adoptionSource = "order_source_quote";
            console.error(
              `[createInvoice] Adopting QB invoice ${qbInvoiceId} from source quote ` +
              `${srcQuote.quote_id} (order ${orderId}) instead of creating a duplicate.`,
            );
          }
        }
      } catch (e) {
        // Non-fatal: guard 2 (DocNumber family) and the create path still run.
        console.error("[createInvoice] order→quote adoption lookup failed:", (e as Error)?.message);
      }
    }
  }

  // ── Adoption guard 2: DocNumber family already exists in QB ───────────────
  // No local row points at a QB invoice, but one may exist anyway (lost
  // write-back, or a concurrent sync that won the race — its write-back
  // lands while we run). Query the whole family (base + -rN) up front:
  // fully-paid member → refuse (books already settled); live unpaid member →
  // adopt and UPDATE it. Only when the family is empty do we CREATE.
  // The old behavior — query DocNumbers only to pick "the next free -rN" —
  // is what turned every one of these races into a duplicate.
  let familyDocNumbers: string[] | null = null;
  if (!qbInvoiceId) {
    const escapedBaseForFamily = escapeQbStringLiteral(String(quote.quote_id || ""));
    try {
      const familyResp = await qbQuery(
        token,
        realmId,
        `SELECT * FROM Invoice WHERE DocNumber = '${escapedBaseForFamily}' OR DocNumber LIKE '${escapedBaseForFamily}-r%'`,
      );
      const family = familyResp?.QueryResponse?.Invoice || [];
      familyDocNumbers = family.map((i: any) => String(i.DocNumber || "")).filter(Boolean);
      const picked = pickQbInvoiceForAdoption(family);
      if (picked.paid) {
        console.error(
          `[createInvoice] QB invoice ${picked.paid.Id} (${picked.paid.DocNumber}) for this ` +
          `quote is already PAID. Refusing to create a duplicate.`,
        );
        return {
          qbInvoiceId: String(picked.paid.Id),
          paymentLink: sharedExtractPaymentLink(picked.paid) ?? null,
          linkFailureReason: null,
          alreadyPaid: true,
          alreadyPaidMessage:
            `This quote already has a paid QuickBooks invoice (#${picked.paid.DocNumber ?? picked.paid.Id}). ` +
            `No new invoice was created.`,
        };
      }
      if (picked.adopt) {
        qbInvoiceId = String(picked.adopt.Id);
        adoptionSource = "doc_family";
        console.error(
          `[createInvoice] QB already has invoice ${qbInvoiceId} (${picked.adopt.DocNumber}) for ` +
          `this quote — adopting it instead of creating a duplicate.`,
        );
        if (picked.live.length > 1) {
          // Pre-existing duplicates: adoption picks a canonical one but can't
          // void the others — the shop has to. Tell them, loudly.
          try {
            const adminNotify = createClient(
              Deno.env.get("SUPABASE_URL")!,
              Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
            );
            await recordShopNotification(adminNotify, {
              shopOwner: quote.shop_owner,
              eventType: "qb_duplicate_invoices_detected",
              severity:  "warning",
              title:     `Duplicate QuickBooks invoices exist for ${quote.quote_id}`,
              body:      `QuickBooks has ${picked.live.length} live invoices for this quote ` +
                         `(${picked.live.map((i: any) => i.DocNumber).join(", ")}). InkTracker is now ` +
                         `tracking #${picked.adopt.DocNumber}; please void the other copy in QuickBooks ` +
                         `so the customer can't be billed twice.`,
              relatedEntity: "quote",
              relatedId:     String(quote.id ?? ""),
              metadata: { quote_id: quote.quote_id, docs: picked.live.map((i: any) => i.DocNumber) },
            });
          } catch (notifErr) {
            console.error("[createInvoice] duplicate-invoice notification failed:", notifErr);
          }
        }
      }
    } catch (e) {
      // Family lookup failed (QB hiccup). Don't guess: the create path
      // retries its own DocNumber query, and its Duplicate-DocNumber retry
      // loop is the last-resort backstop.
      console.error("[createInvoice] DocNumber family lookup failed:", (e as Error)?.message);
      familyDocNumbers = null;
    }
  }

  // If the quote already has a QB invoice ID, UPDATE the existing invoice
  // instead of creating a duplicate. This is the "resync" path.
  if (qbInvoiceId) {
    console.error(`[createInvoice] Resyncing existing QB invoice ${qbInvoiceId}`);

    // Fetch the existing invoice ONCE up front so we can:
    //   (a) inspect TotalAmt + Balance for the paid-state guard below,
    //   (b) hand the SyncToken to a subsequent update.
    let existingInv: any = null;
    try {
      const existing = await qbQuery(token, realmId, `SELECT * FROM Invoice WHERE Id = '${escapeQbStringLiteral(qbInvoiceId)}'`);
      existingInv = existing?.QueryResponse?.Invoice?.[0] ?? null;
    } catch (e) {
      // A FAILED fetch is not the same as "invoice deleted in QB". Falling
      // through with existingInv=null would take the create-fresh branch
      // below and mint a -rN duplicate of a live (possibly paid) invoice —
      // the Shana-Krochmal books-split via the error path. It would also
      // leave existingInvoiceHadPayment=false, re-posting any deposit.
      // Refuse and let the operator retry once QB is reachable.
      console.error(`[createInvoice] Could not fetch existing QB invoice ${qbInvoiceId}:`, (e as Error)?.message);
      throw new Error(
        `Couldn't reach QuickBooks to check the existing invoice for this quote. ` +
        `Nothing was created or changed — try again in a minute.`,
      );
    }

    // Record whether a payment is already applied BEFORE we mutate the invoice,
    // so the deposit step below doesn't double-post on a re-sync (NEW-12).
    existingInvoiceHadPayment = qbInvoiceHasPayment(existingInv);

    if (existingInv && isQbInvoicePaid(existingInv)) {
      // Paid-state guard. The previous behavior here was to attempt an
      // UPDATE, and if QB refused (locked record / stale SyncToken /
      // policy block on paid invoices), silently fall through to CREATE
      // a -r2 duplicate. That orphan landed a customer payment on one
      // invoice in QB while the visible invoice in InkTracker showed
      // unpaid — root cause of the "Shana Krochmal" double-row bug.
      // When the existing invoice is paid, the right move is to refuse
      // to mutate it AND refuse to create a duplicate. Return the
      // current state so the caller can surface "already paid" copy.
      console.error(
        `[createInvoice] Existing QB invoice ${qbInvoiceId} is fully paid ` +
        `(Balance=0 of $${Number(existingInv.TotalAmt ?? 0)}). ` +
        `Refusing to resync — would create a duplicate -rN.`,
      );
      // Return a PLAIN object — the dispatcher spreads it into
      // Response.json({success: true, ...result}). Returning a
      // Response instance here would lose every field via the spread
      // (Response has no own enumerable props) and the frontend's
      // alreadyPaid banner would never fire.
      const paymentLink = sharedExtractPaymentLink(existingInv);
      return {
        qbInvoiceId,
        paymentLink: paymentLink ?? null,
        linkFailureReason: null,
        alreadyPaid: true,
        alreadyPaidMessage:
          `This quote already has a paid QuickBooks invoice (#${existingInv.DocNumber ?? qbInvoiceId}). ` +
          `No new invoice was created.`,
      };
    }

    if (!existingInv) {
      // Stored qb_invoice_id no longer resolves — invoice was deleted in
      // QB or our ID is stale. Safe to fall through and create a fresh
      // one; nothing to mutate.
      console.error(`[createInvoice] Stored qb_invoice_id ${qbInvoiceId} not found in QB. Will create new.`);
      qbInvoiceId = "";
    } else {
      try {
        const updateBody: any = {
          Id: qbInvoiceId,
          SyncToken: existingInv.SyncToken,
          sparse: true,
          CustomerRef: { value: qbCustomerId },
          AllowOnlineCreditCardPayment: true,
          AllowOnlineACHPayment: true,
          Line: lines,
          CustomerMemo: { value: quote.notes || "" },
          PrivateNote: `InkTracker Quote ${baseDocNumber} — updated ${new Date().toISOString().slice(0, 10)}`
            + (quote.job_title ? ` · Job: ${quote.job_title}` : ""),
        };
        if (billEmail) {
          updateBody.BillEmail = { Address: billEmail };
        }
        if (billAddress) {
          updateBody.BillAddr = { Line1: billAddress };
        }
        // ShipAddr drives AST destination sourcing — structured when possible.
        if (shipAddr) {
          updateBody.ShipAddr = shipAddr;
        }

        const updated = await qbUpdate(token, realmId, "invoice", updateBody);
        created = updated;
        qbInvoiceFinal = updated?.Invoice ?? updated;
        qbInvoiceId = String(qbInvoiceFinal?.Id || qbInvoiceId);
      } catch (updateErr: any) {
        // ── HARD STOP: never silently create a duplicate ────────────
        // Previous behavior (pre-2026-05-30) was to clear qbInvoiceId
        // and fall through to CREATE here. That produced the Shana
        // Krochmal Q-2026-F4O5 → Q-2026-F4O5-r2 split: the original
        // invoice stayed UNPAID in InkTracker, the duplicate -r2
        // collected the payment in QB, and the books diverged.
        //
        // The existing invoice is unpaid (we checked above) AND its
        // row exists in QB (existingInv was truthy). An UPDATE failure
        // here is a TRANSIENT or POLICY problem — not a "the link is
        // stale" problem. The right answer is to surface the failure
        // and let the operator choose: Refresh to re-pull state, fix
        // the invoice manually in QB, or edit and retry.
        //
        // Note: there IS still one legitimate path to a -rN: when the
        // stored qb_invoice_id genuinely doesn't resolve in QB (deleted
        // by the operator), the `if (!existingInv)` branch above clears
        // the id and the CREATE block downstream uses the next free
        // DocNumber. That path is correct — no duplicate exists to
        // collide with.
        console.error(
          `[createInvoice] Update failed for invoice ${qbInvoiceId}. ` +
          `Refusing to create duplicate. Reason: ${updateErr?.message}`,
        );
        return buildUpdateFailureResponse({
          qbInvoiceId,
          qbDocNumber:        String(existingInv?.DocNumber || ""),
          existingPaymentLink: sharedExtractPaymentLink(existingInv) ?? null,
          updateErrMessage:    updateErr?.message,
        });
      }
    }
  }

  // Create new invoice if we don't have one yet. Reached only when the
  // adoption guards found NOTHING to update: no DB-linked invoice, no source
  // quote's invoice, and an empty (or unreadable) DocNumber family in QB.
  if (!qbInvoiceId) {
    const escapedBase = escapeQbStringLiteral(baseDocNumber);
    // Reuse the family query from adoption guard 2 when it succeeded; only
    // re-query when that lookup failed (familyDocNumbers === null) or was
    // skipped because a stale qb_invoice_id got cleared by the resync path.
    let existingDocs: string[] = familyDocNumbers ?? [];
    if (familyDocNumbers === null) {
      try {
        const existingResp = await qbQuery(
          token,
          realmId,
          `SELECT DocNumber FROM Invoice WHERE DocNumber = '${escapedBase}' OR DocNumber LIKE '${escapedBase}-r%'`,
        );
        existingDocs = (existingResp?.QueryResponse?.Invoice || [])
          .map((i: any) => String(i.DocNumber || ""))
          .filter(Boolean);
      } catch (e) {
        console.error("[createInvoice] DocNumber lookup failed (will try base only):", e);
      }
    }
    const docNumber = nextAvailableDocNumber(baseDocNumber, existingDocs);
    const isRevision = docNumber !== baseDocNumber;

    // DueDate = TxnDate. The QB invoice should be due on receipt —
    // the customer's already approved the quote and the pay-now link
    // is on the email. Previously we mapped `quote.due_date` here,
    // but that's the PRODUCTION due date (when the job ships to the
    // customer), not the PAYMENT due date — different semantics. QB
    // would then display "Due in 15 days" (or whatever the production
    // turnaround was), discouraging immediate payment.
    //
    // Setting DueDate explicitly to the invoice date overrides the
    // QB customer's default terms ("Net 15", etc.) so every shop's
    // invoices land as "Due on receipt" regardless of their QB
    // company settings.
    const invoiceBody: any = {
      CustomerRef: { value: qbCustomerId },
      DocNumber: docNumber,
      TxnDate: quote.date,
      DueDate: quote.date || undefined,
      AllowOnlineCreditCardPayment: true,
      AllowOnlineACHPayment: true,
      Line: lines,
      CustomerMemo: { value: quote.notes || "" },
      // PrivateNote is QB's internal memo (visible to the shop in QB, not on
      // the customer's invoice). Append the InkTracker job title so it flows
      // to accounting for reference.
      PrivateNote: (isRevision
        ? `InkTracker Quote ${baseDocNumber} — revision (${docNumber})`
        : `InkTracker Quote ${baseDocNumber}`)
        + (quote.job_title ? ` · Job: ${quote.job_title}` : ""),
    };

    if (billEmail) {
      invoiceBody.BillEmail = { Address: billEmail };
      invoiceBody.EmailStatus = "NeedToSend";
    }
    if (billAddress) {
      invoiceBody.BillAddr = { Line1: billAddress };
    }
    // ShipAddr drives AST destination sourcing — structured when possible.
    if (shipAddr) {
      invoiceBody.ShipAddr = shipAddr;
    }

    let attempt = 0;
    let activeBody = invoiceBody;
    while (attempt < 5) {
      try {
        created = await qbCreate(token, realmId, "invoice", activeBody);
        qbInvoiceId = created?.Invoice?.Id;
        if (!qbInvoiceId) throw new Error("QB did not return an invoice ID");
        qbInvoiceFinal = created?.Invoice ?? created;
        break;
      } catch (createErr: any) {
        const isDuplicate = createErr?.message?.includes("Duplicate Document Number");
        if (!isDuplicate) throw createErr;

        existingDocs.push(activeBody.DocNumber);
        const nextDoc = nextAvailableDocNumber(baseDocNumber, existingDocs);
        console.error(
          `[createInvoice] DocNumber ${activeBody.DocNumber} taken — retrying as ${nextDoc}`
        );
        activeBody = {
          ...activeBody,
          DocNumber: nextDoc,
          PrivateNote: `InkTracker Quote ${baseDocNumber} — revision (${nextDoc})`,
        };
        attempt++;
      }
    }
    if (!qbInvoiceId) {
      throw new Error(
        `Could not create QB invoice for ${baseDocNumber} after retries. ` +
        `Existing revisions: ${existingDocs.join(", ")}`
      );
    }
  }

  // Re-read the invoice to ensure we have the final AST-computed tax/total
  try {
    const re = await qbQuery(token, realmId, `SELECT * FROM Invoice WHERE Id = '${escapeQbStringLiteral(qbInvoiceId)}'`);
    const fetched = re?.QueryResponse?.Invoice?.[0];
    if (fetched) qbInvoiceFinal = fetched;
  } catch (e) {
    console.error("[createInvoice] refetch failed (non-fatal):", e);
  }

  const qbTotal     = Number(qbInvoiceFinal?.TotalAmt ?? 0);
  const qbTaxAmount = Number(qbInvoiceFinal?.TxnTaxDetail?.TotalTax ?? 0);
  const qbSubtotal  = Number((qbTotal - qbTaxAmount).toFixed(2));

  // ── Numbers-match reconciliation guard ─────────────────────────────────────
  // Compare what we sent vs what QB returned. Any non-OK result is logged
  // loudly so it shows up in the Supabase function logs. Classification
  // (line-amount integrity DRIFT vs TAX_MISMATCH, plus the missingTax
  // flag) drives whether we ALSO push a shop notification below — see the
  // shouldNotify gate. Pure helper + tests live in
  // ../_shared/qbWriteContracts.js.
  // Expected tax applies only to TAX-coded lines (non-taxable shipping etc.
  // are excluded), matching how QB itself computes it.
  const taxableSubtotalForReconcile = lines.reduce(
    (s: number, l: any) =>
      s + (l?.SalesItemLineDetail?.TaxCodeRef?.value === "TAX" ? (Number(l?.Amount) || 0) : 0),
    0,
  );
  const expectedTax = Number((taxableSubtotalForReconcile * (taxPercent / 100)).toFixed(2));
  const reconciliation = reconcileQbInvoice({
    sentLines: lines,
    sentTax: expectedTax,
    qbResponse: qbInvoiceFinal,
  });

  // HARD TAX GATE. When QB's computed tax doesn't match what the quote
  // billed, the customer would pay a tax we never quoted and the books
  // would disagree with InkTracker. Hold the invoice — do NOT mint or
  // deliver the customer payment link, and do NOT advance the quote to
  // "Sent" — until the shop reconciles it (fix the customer's QB tax
  // setup or the quote's tax rate, then re-sync). `taxMismatch` is the
  // discount-aware signal from reconcileQbInvoice: the line amounts are
  // faithful but the total diverges beyond a cent purely via tax. Today
  // this never fires (the shop's flat rate equals QB's AST rate); it is
  // the tripwire for the day they diverge. See docs/qb-tax-sync.md.
  //
  // acceptQbTax: the shop reviewed the hold and chose "use QuickBooks' tax"
  // (one-click on the held send). We then ADOPT QB's authoritative tax onto
  // the quote (below), mint the link, and proceed — no hold.
  const acceptQbTax = params?.acceptQbTax === true;
  const taxBlocked = reconciliation.taxMismatch === true && !acceptQbTax;

  if (reconciliation.severity !== RECONCILE_SEVERITY.OK) {
    console.error(
      `[createInvoice] QB write reconciliation: ${reconciliation.severity} ` +
      `quote=${quote.quote_id} shop=${quote.shop_owner} qb_invoice=${qbInvoiceId}\n` +
      `  Sent subtotal: $${reconciliation.sentSubtotal.toFixed(2)}, ` +
      `QB subtotal: $${reconciliation.qbSubtotal.toFixed(2)}, ` +
      `drift: $${reconciliation.subtotalDrift.toFixed(2)}\n` +
      `  Sent total:    $${reconciliation.sentTotal.toFixed(2)}, ` +
      `QB total:    $${reconciliation.qbTotal.toFixed(2)}, ` +
      `drift: $${reconciliation.totalDrift.toFixed(2)}\n` +
      `  Issues: ${reconciliation.issues.join(" | ")}`,
    );

    // Decide whether to NOTIFY (vs just log above). Integrity DRIFT (QB
    // altered our line amounts) and FATAL always notify. As of the tax-sync
    // hardening, ANY tax mismatch also notifies — because it now also BLOCKS
    // the customer send (see taxBlocked), so the shop must be told to
    // reconcile it rather than discovering a held invoice silently. The
    // notification copy distinguishes the dangerous missingTax sub-case
    // (QB recorded ~$0) from a plain rate divergence.
    const shouldNotify =
      reconciliation.severity === RECONCILE_SEVERITY.DRIFT ||
      reconciliation.severity === RECONCILE_SEVERITY.FATAL ||
      reconciliation.severity === RECONCILE_SEVERITY.TAX_MISMATCH;

    // Best-effort in-app notification: a failure here must NOT cause the
    // user-facing invoice send to error out. Uses a service-role client
    // because the notifications table is service-role-only on INSERT (the
    // authenticated user can read/update their own, but not forge new ones).
    if (shouldNotify) {
      try {
        const notif = buildQbDriftNotification({
          shopOwner: quote.shop_owner,
          quoteId: quote.quote_id,
          quoteRowId: String(quote.id),
          qbInvoiceId,
          reconciliation,
        });
        const adminClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        // recordShopNotification swallows its own errors, but we wrap
        // anyway in case the build step throws.
        await recordShopNotification(adminClient, {
          shopOwner: notif.shop_owner,
          eventType: notif.event_type,
          severity:  notif.severity,
          title:     notif.title,
          body:      notif.body,
          relatedEntity: notif.related_entity,
          relatedId:     notif.related_id,
          metadata:      notif.metadata,
        });
      } catch (err) {
        console.error(`[createInvoice] failed to push reconciliation notification: ${err}`);
      }
    }
  }

  // Mint the customer-facing share link. QBO does NOT include the link in
  // the create response, a plain GET, or in ?include=invoiceLink on a
  // draft — the link only exists after the invoice runs through QBO's send
  // pipeline, which provisions the portal record (snapshotted at mint
  // time). mintInvoicePaymentLink wraps the full flow: /send with built-in
  // retries, then two refetches via GET ?include=invoiceLink to catch
  // async portal provisioning, then returns a structured reason so the
  // caller can show actionable guidance.
  const initialInvoice: any = qbInvoiceFinal || created;
  let paymentLink: string | null = null;
  let linkFailureReason: string | null = null;
  if (taxBlocked) {
    // On hold for a tax mismatch — never mint or deliver a customer
    // payment link. The QB invoice exists (we needed QB to compute the
    // tax to detect the mismatch), but no portal link is provisioned and
    // the frontend send is blocked via the taxBlocked flag in the return.
    linkFailureReason = "tax_mismatch_hold";
    console.error(
      `[createInvoice] TAX HOLD: quote=${quote.quote_id} qb_invoice=${qbInvoiceId} ` +
      `quoted tax $${reconciliation.sentTax.toFixed(2)} vs QB $${reconciliation.qbTax.toFixed(2)} ` +
      `(drift $${reconciliation.taxDrift.toFixed(2)}) — payment link NOT minted; customer send blocked.`,
    );
  } else {
    const linkResult = await mintInvoicePaymentLink(token, realmId, qbInvoiceId, billEmail, initialInvoice, noEmail);
    paymentLink = linkResult.link;
    linkFailureReason = linkResult.reason;
  }

  // 4b. If the quote's deposit was already paid, record the payment against this invoice.
  // A failure here is REAL money drift: the deposit shows as paid in
  // InkTracker but the QB invoice still has the full balance outstanding,
  // so a customer who pays the QB-side balance ends up double-billed.
  // Surface a structured warning to the frontend AND a shop notification
  // so the operator can manually record the payment in QB. The invoice
  // itself was created successfully, so we still finish the rest of the
  // sync — but the response will carry depositRecordFailed: true.
  let depositRecordFailed = false;
  const depositAmount = Number(invoicePayload?.depositAmount) || 0;
  // Skip while tax-held: a held invoice isn't going out, and recording the
  // deposit now would double it when the fixed invoice is re-synced.
  // Skip when the existing QB invoice ALREADY carries a payment
  // (existingInvoiceHadPayment) — the deposit was recorded on a prior sync, and
  // posting it again would over-apply and zero out a balance still owed
  // (NEW-12). A first-time create has no existing payment, so the deposit is
  // still recorded exactly once.
  if (quote.deposit_paid && depositAmount > 0 && !taxBlocked && !existingInvoiceHadPayment) {
    try {
      await qbCreate(token, realmId, "payment", {
        CustomerRef: { value: qbCustomerId },
        TotalAmt: depositAmount,
        PrivateNote: `InkTracker deposit for quote ${quote.quote_id}`,
        Line: [{
          Amount: depositAmount,
          LinkedTxn: [{ TxnId: qbInvoiceId, TxnType: "Invoice" }],
        }],
      });
    } catch (err) {
      depositRecordFailed = true;
      console.error("[createInvoice] CRITICAL: deposit payment record failed — operator must record manually:", err);
      try {
        const adminClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        await recordShopNotification(adminClient, {
          shopOwner: quote.shop_owner,
          eventType: "qb_deposit_record_failed",
          severity:  "warning",
          title:     `Couldn't record $${depositAmount.toFixed(2)} deposit on QB invoice`,
          body:      `The QuickBooks invoice for quote ${quote.quote_id} was created, but recording the deposit payment against it failed. The customer's QB invoice will show the FULL balance instead of remaining balance. Open QuickBooks → Receive Payment for this invoice and apply $${depositAmount.toFixed(2)} to fix it.`,
          relatedEntity: "quote",
          relatedId:     String(quote.id ?? ""),
          metadata: {
            quote_id: quote.quote_id,
            qb_invoice_id: qbInvoiceId,
            deposit_amount: depositAmount,
            error: (err as Error)?.message ?? String(err),
          },
        });
      } catch (notifErr) {
        console.error("[createInvoice] failed to push deposit-failed notification:", notifErr);
      }
    }
  }

  // The DocNumber that was actually written to QB. Differs from quote.quote_id
  // when a previous invoice with the same base existed and we created a
  // versioned revision (e.g. Q-2026-115-r2).
  const qbDocNumber = String(qbInvoiceFinal?.DocNumber || baseDocNumber);

  // When the shop accepted QB's tax (one-click on the held send), adopt QB's
  // authoritative numbers onto the quote/invoice so the email, PDF, payment
  // page, and any future reconcile all match what QB charges — no re-hold.
  const adoptQbTaxFields = acceptQbTax
    ? {
        tax:      qbTaxAmount,
        total:    qbTotal,
        tax_rate: qbSubtotal > 0 ? Number(((qbTaxAmount / qbSubtotal) * 100).toFixed(4)) : 0,
      }
    : {};

  // Clobber-guard: only write qb_payment_link when we actually minted one.
  // A re-sync whose link mint transiently fails (or a held invoice that skips
  // minting) returns paymentLink=null — writing that would WIPE a previously
  // good link and break "Approve & Pay". Omit the field to keep the existing link.
  const linkField = paymentLink ? { qb_payment_link: paymentLink } : {};

  // 5. Save QB invoice ID + DocNumber + payment link + final QB-computed
  // totals back to the source record. Both ids matter — the internal id
  // for API calls, the DocNumber for the operator-facing UI.
  if (quote.id) {
    // Recording qb_invoice_id locally is CRITICAL: the QB invoice already
    // exists, so if this write-back is lost we have an invoice in QB that
    // InkTracker doesn't know about, and a re-send after the idempotency TTL
    // takes the CREATE path and mints a -rN DUPLICATE. The updates used to
    // discard their Supabase error entirely (zero observability). Now each is
    // retried on failure and logged loudly; the row targets either the quotes
    // or the invoices table (same id format), so success on EITHER is enough.
    const updateWithRetry = async (table: string, patch: Record<string, unknown>) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const { error } = await supabase.from(table).update(patch).eq("id", quote.id);
        if (!error) return true;
        // 22P02 / PGRST116-style "no row in this table" is expected for one of
        // the two tables (a quote-originated invoice isn't in `invoices` and
        // vice versa) — an empty match is NOT an error from PostgREST, so any
        // returned error here is a real write failure worth retrying.
        console.error(`[createInvoice] write-back to ${table} failed (attempt ${attempt + 1}) for ${quote.id}:`, error.message);
      }
      return false;
    };

    const okQuotes = await updateWithRetry("quotes", {
      qb_invoice_id:   qbInvoiceId,
      qb_doc_number:   qbDocNumber,
      ...linkField,
      qb_synced_at:    new Date().toISOString(),
      qb_subtotal:     qbSubtotal,
      qb_tax_amount:   qbTaxAmount,
      qb_total:        qbTotal,
      ...adoptQbTaxFields,
      // Don't advance a held invoice to "Sent" — it hasn't been sent.
      status:          (!taxBlocked && quote.status === "Draft") ? "Sent" : quote.status,
    });

    // Also mirror onto the invoices table (invoice-originated, same ID format).
    const okInvoices = await updateWithRetry("invoices", {
      qb_invoice_id:   qbInvoiceId,
      qb_doc_number:   qbDocNumber,
      ...linkField,
      qb_subtotal:     qbSubtotal,
      qb_tax_amount:   qbTaxAmount,
      qb_total:        qbTotal,
      ...adoptQbTaxFields,
    });

    if (!okQuotes && !okInvoices) {
      // Neither table recorded the link after retries. The QB invoice exists
      // but nothing local points at it — flag it so this doesn't silently
      // become a duplicate on the next send.
      console.error(`[createInvoice] CRITICAL: QB invoice ${qbInvoiceId} created but link write-back FAILED on both tables for ${quote.id}. Re-send risks a duplicate.`);
    }
  }

  // Phase 3: immutable tax-audit record. Snapshots QB's authoritative
  // per-jurisdiction tax (TxnTaxDetail) for the by-state filing report and
  // audit trail. Upsert on (shop_owner, qb_invoice_id) so a resync refreshes
  // the one authoritative row. Best-effort — must never fail the invoice.
  // See docs/qb-multistate-tax-scope.md §10.
  //
  // Skip when QB's tax doesn't match what the quote billed (taxMismatch): that
  // invoice is being held for reconciliation (Phase 0) and hasn't been sent, so
  // recording its tax as charged would put a phantom liability in the filing
  // report until the shop fixes it. The clean re-sync — OR an explicit
  // acceptQbTax (the shop adopted QB's tax) — writes the record.
  try {
    const taxRecord = buildTaxRecordFromQbInvoice(qbInvoiceFinal, {
      shopOwner:   quote.shop_owner,
      quoteId:     quote.quote_id,
      qbInvoiceId,
      customer,
      isTaxExempt,
    });
    if (taxRecord.shop_owner && taxRecord.qb_invoice_id && (reconciliation.taxMismatch !== true || acceptQbTax)) {
      const taxAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { error: trErr } = await taxAdmin
        .from("tax_records")
        .upsert(taxRecord, { onConflict: "shop_owner,qb_invoice_id" });
      if (trErr) console.error("[createInvoice] tax-record upsert error (non-fatal):", trErr.message);
    }
  } catch (err) {
    console.error("[createInvoice] tax-record write failed (non-fatal):", (err as Error)?.message);
  }

  return {
    qbInvoiceId,
    qbDocNumber,
    isRevision: qbDocNumber !== baseDocNumber,
    // Non-null when the caller's snapshot had no qb_invoice_id but the sync
    // found the existing invoice anyway ("db_row" | "order_source_quote" |
    // "doc_family") and UPDATEd it instead of creating a duplicate.
    adoptionSource,
    paymentLink,
    // Surfaces to the frontend so it can show actionable guidance:
    //   null                 → success (paymentLink populated)
    //   "no_bill_email"      → quote/customer is missing an email; can't /send
    //   "no_link_after_retry"→ /send succeeded but no portal link minted
    //                          after retries + 2 refetches. The most likely
    //                          cause is QB Payments isn't activated on the
    //                          shop's QuickBooks account.
    linkFailureReason,
    // True when the deposit-against-invoice payment record failed in QB.
    // The invoice was created successfully; the operator needs to record
    // the deposit manually in QuickBooks → Receive Payment. A shop
    // notification was also written.
    depositRecordFailed,
    // True when QB's tax didn't match the quote, so the invoice is on hold:
    // no payment link was minted and the frontend must NOT send the customer
    // email. The shop reconciles (see docs/qb-tax-sync.md) and re-syncs.
    taxBlocked,
    taxBlockReason: taxBlocked ? "tax_mismatch" : null,
    taxBlockDetail: taxBlocked
      ? {
          quotedTax:   reconciliation.sentTax,
          qbTax:       reconciliation.qbTax,
          taxDrift:    reconciliation.taxDrift,
          quotedTotal: reconciliation.sentTotal,
          qbTotal:     reconciliation.qbTotal,
        }
      : null,
    qbSubtotal,
    qbTaxAmount,
    qbTotal,
    customerRef: qbCustomerId,
  };
}

// ── Action: estimateTax (quote-time "Calculate tax") ───────────────────────
// QuickBooks has no "just calculate tax" endpoint — AST only computes tax on a
// real transaction. So we create (or reuse) a NON-POSTING Estimate for the
// quote, read QB's authoritative tax off it, and return it for the editor to
// fill in. Non-posting = never touches A/R, so pricing a draft quote doesn't
// litter the books. One Estimate per quote (deduped by DocNumber = quote_id,
// updated on re-calc). No mint, no send, no email. See docs/qb-multistate-tax-scope.md.
async function handleEstimateTax(token: string, realmId: string, params: any, supabase: any) {
  const { quote, customer, invoicePayload } = params;
  if (!invoicePayload?.lines?.length) {
    throw new Error("Missing invoicePayload — frontend must compute quote totals first");
  }

  const qbCustomerId = await findOrCreateCustomer(token, realmId, customer, supabase);
  if (!qbCustomerId) throw new Error("Could not find or create QuickBooks customer");

  // Item refs (income account doesn't affect tax — pass null, falls back).
  const itemIdMap = await resolveItemIdMap(token, realmId, invoicePayload, null);

  // Same exemption authority as createInvoice: honor only ACTIVE exemptions.
  const todayIso = new Date().toISOString().slice(0, 10);
  const destinationState = customer?.ship_to_address?.state;
  let isTaxExempt = isExemptionActive(customer, { asOf: todayIso, destinationState });
  try {
    const qbCustData = await qbQuery(token, realmId, `SELECT * FROM Customer WHERE Id = '${escapeQbStringLiteral(qbCustomerId)}'`);
    const qbCust = qbCustData?.QueryResponse?.Customer?.[0];
    if (!customer?.tax_exempt && qbCust?.Taxable === false) isTaxExempt = true;
  } catch (e) {
    console.error("[estimateTax] QB customer tax check failed (non-fatal):", (e as Error)?.message);
  }

  const lines = buildInvoiceLinesFromPayload(invoicePayload, itemIdMap, DEFAULT_ITEM_NAME, isTaxExempt);
  if (lines.length === 0) throw new Error("No valid lines to estimate");

  // Code taxable lines TAX so AST evaluates the jurisdiction and returns the
  // real rate (including $0 for a no-nexus destination). Do NOT gate on the
  // quote's current taxPercent — the whole point is to let QB decide. Only a
  // genuine exemption or a non-taxable line (e.g. shipping) is NON.
  lines.forEach((l: any) => {
    if (l.SalesItemLineDetail) {
      const lineTaxable = l._taxable !== false;
      const code = (isTaxExempt || !lineTaxable) ? "NON" : "TAX";
      l.SalesItemLineDetail.TaxCodeRef = { value: code };
    }
    delete l._taxable;
    delete l._isFee;
  });

  const shipAddr = buildQbShipAddr(customer?.ship_to_address, customer?.address);
  const docNumber = String(quote?.quote_id || "").slice(0, 21); // QB DocNumber max 21 chars

  // Reuse one estimate per quote (dedup by DocNumber) so re-calcs don't pile up.
  let existing: any = null;
  if (docNumber) {
    try {
      const found = await qbQuery(token, realmId, `SELECT * FROM Estimate WHERE DocNumber = '${escapeQbStringLiteral(docNumber)}'`);
      existing = found?.QueryResponse?.Estimate?.[0] ?? null;
    } catch (e) {
      console.error("[estimateTax] estimate lookup failed (will create):", (e as Error)?.message);
    }
  }

  const body: any = {
    CustomerRef: { value: qbCustomerId },
    Line: lines,
    TxnTaxDetail: {},  // opt into AST
  };
  if (docNumber) body.DocNumber = docNumber;
  if (shipAddr) body.ShipAddr = shipAddr;

  let est: any;
  if (existing?.Id) {
    est = await qbUpdate(token, realmId, "estimate", { ...body, Id: existing.Id, SyncToken: existing.SyncToken });
  } else {
    est = await qbCreate(token, realmId, "estimate", body);
  }
  const estimate = est?.Estimate ?? est;

  const total    = Number(estimate?.TotalAmt ?? 0);
  const taxTotal = Number(estimate?.TxnTaxDetail?.TotalTax ?? 0);
  const subtotal = Number((total - taxTotal).toFixed(2));
  // Prefer QB's actual jurisdiction rate (summed from the tax lines) over
  // back-computing tax/subtotal — the latter skews on small orders where the
  // tax amount is penny-rounded ($0.52 on $6.30 reads as 8.254%, not 8.265%).
  const jurisdictionRate = qbJurisdictionRate(estimate?.TxnTaxDetail);
  const effectiveRate = jurisdictionRate > 0
    ? jurisdictionRate
    : (subtotal > 0 ? Number(((taxTotal / subtotal) * 100).toFixed(4)) : 0);

  console.error(`[estimateTax] quote=${quote?.quote_id} subtotal=${subtotal} tax=${taxTotal} rate=${effectiveRate}% exempt=${isTaxExempt}`);
  return { ok: true, tax: taxTotal, subtotal, total, effectiveRate, exempt: isTaxExempt };
}

// ── Action: pullCustomers (QB → InkTracker) ────────────────────────────────

async function handlePullCustomers(token: string, realmId: string, supabase: any, shopOwner: string) {
  // Paginated fetch of all QB customers. Hard cap at 10K rows so a
  // misconfigured shop can't hang the function forever — but flag
  // truncation in the response so the operator knows to investigate
  // (or so we know to raise the cap).
  const pageSize = 1000;
  const hardCap = 10000;
  const all: any[] = [];
  let start = 1;
  let truncatedAtCap = false;
  while (true) {
    const res = await qbQuery(token, realmId,
      `SELECT * FROM Customer STARTPOSITION ${start} MAXRESULTS ${pageSize}`
    );
    const batch: any[] = res?.QueryResponse?.Customer ?? [];
    all.push(...batch);
    if (batch.length < pageSize) break;
    start += pageSize;
    if (start > hardCap) {
      console.error(
        `[pullCustomers] hit ${hardCap}-row cap for ${shopOwner} — additional QB customers were NOT pulled. ` +
        `Raise hardCap or paginate UI-side if shops legitimately have more.`,
      );
      truncatedAtCap = true;
      break;
    }
  }

  if (all.length === 0) return { imported: 0, skipped: 0, updated: 0, total: 0, truncatedAtCap };

  // Fetch existing InkTracker customers for this shop
  const { data: existing } = await supabase
    .from("customers")
    .select("id, qb_customer_id, email, name, company")
    .eq("shop_owner", shopOwner);
  const byQbId = new Map<string, any>();
  const byEmail = new Map<string, any>();
  for (const c of existing ?? []) {
    if (c.qb_customer_id) byQbId.set(String(c.qb_customer_id), c);
    if (c.email) byEmail.set(c.email.toLowerCase(), c);
  }

  let imported = 0;
  let skipped = 0;
  let updated = 0;

  for (const qbCust of all) {
    if (qbCust.Active === false) { skipped++; continue; }

    const qbId = String(qbCust.Id);
    const email = qbCust.PrimaryEmailAddr?.Address ?? "";
    const phone = qbCust.PrimaryPhone?.FreeFormNumber ?? "";
    const addr = qbCust.BillAddr;
    const addressParts = [addr?.Line1, addr?.City, addr?.CountrySubDivisionCode, addr?.PostalCode].filter(Boolean);
    const name = [qbCust.GivenName, qbCust.FamilyName].filter(Boolean).join(" ") || qbCust.DisplayName || "";
    const company = qbCust.CompanyName || "";
    const notes = qbCust.Notes || "";
    const taxExempt = qbCust.Taxable === false;
    const taxId = qbCust.ResaleNum || "";

    const payload: any = {
      shop_owner: shopOwner,
      name: name || company || qbCust.DisplayName || "Unknown",
      company,
      email: email || null,
      phone: phone || null,
      address: addressParts.join(", ") || null,
      notes: notes || null,
      tax_exempt: taxExempt,
      tax_id: taxId || null,
      qb_customer_id: qbId,
    };

    // Check if already imported. qb_customer_id and email are the fast,
    // decisive paths. The third pass is a normalized identity match
    // (company + contact) so an emailless QB customer links to the
    // existing InkTracker record instead of importing a DUPLICATE — the
    // same helper the invoice-create path uses (Increment 1). Only runs
    // when both fast paths miss, so it stays cheap on re-syncs.
    const existingByQb = byQbId.get(qbId);
    const existingByMail = email ? byEmail.get(email.toLowerCase()) : null;
    const existingByIdentity = (!existingByQb && !existingByMail)
      ? (existing ?? []).find((c: any) => customerIdentityMatches(qbCust, c))
      : null;
    const match = existingByQb || existingByMail || existingByIdentity;

    if (match) {
      // Update existing — pull QB data into fields the shop doesn't
      // typically own (contact + billing). NOTES are intentionally
      // SKIPPED on update: the shop's notes column is editorial (their
      // own scratchpad / production notes for the customer) and
      // blasting it from QB Notes on every pull is silent data loss.
      // Initial INSERT below still seeds the notes from QB so newly-
      // imported customers aren't blank — just don't clobber edits.
      const updates: any = {};
      if (!match.qb_customer_id) updates.qb_customer_id = qbId;
      if (company) updates.company = company;
      if (email) updates.email = email;
      if (phone) updates.phone = phone;
      if (addressParts.length > 0) updates.address = payload.address;
      if (taxId) updates.tax_id = taxId;
      if (name) updates.name = name;
      updates.tax_exempt = taxExempt;
      if (Object.keys(updates).length > 0) {
        await supabase.from("customers").update(updates).eq("id", match.id);
        updated++;
      } else {
        skipped++;
      }
    } else {
      // Create new
      const { error } = await supabase.from("customers").insert(payload);
      if (error) {
        console.error("[pullCustomers] insert failed:", error.message, payload.name);
        skipped++;
      } else {
        imported++;
      }
    }
  }

  return { imported, skipped, updated, total: all.length, truncatedAtCap };
}

// ── Action: pullInvoices (QB → InkTracker) ─────────────────────────────────

async function handlePullInvoices(token: string, realmId: string, supabase: any, shopOwner: string) {
  // Paginated fetch of all QB invoices. Hard cap at 10K rows so a
  // misconfigured shop can't hang the function forever — but surface
  // truncation so a growing shop knows to raise the cap.
  const pageSize = 1000;
  const hardCap = 10000;
  const all: any[] = [];
  let start = 1;
  let truncatedAtCap = false;
  while (true) {
    const res = await qbQuery(token, realmId,
      `SELECT * FROM Invoice STARTPOSITION ${start} MAXRESULTS ${pageSize}`
    );
    const batch: any[] = res?.QueryResponse?.Invoice ?? [];
    all.push(...batch);
    if (batch.length < pageSize) break;
    start += pageSize;
    if (start > hardCap) {
      console.error(
        `[pullInvoices] hit ${hardCap}-row cap for ${shopOwner} — additional QB invoices were NOT pulled.`,
      );
      truncatedAtCap = true;
      break;
    }
  }

  if (all.length === 0) return { imported: 0, skipped: 0, updated: 0, total: 0, truncatedAtCap };

  // Build customer lookup: qb_customer_id → InkTracker customer. Pull the tax
  // fields too so the tax-record backfill below can attribute ship-to state +
  // exemption from the current customer record.
  const { data: customers } = await supabase
    .from("customers")
    .select("id, qb_customer_id, name, company, ship_to_address, tax_exempt, exemption_type, exemption_certificate_number")
    .eq("shop_owner", shopOwner);
  const custByQbId = new Map<string, any>();
  for (const c of customers ?? []) {
    if (c.qb_customer_id) custByQbId.set(String(c.qb_customer_id), c);
  }

  // Check existing invoices to deduplicate. Indexed by BOTH:
  //   - exact invoice_id (DocNumber), and
  //   - the qb_invoice_id from prior pulls (covers DocNumber renames).
  // We also build a base-DocNumber index so a -rN revision pulled from
  // QB lands on the row that holds the base DocNumber instead of
  // spawning a sibling row. Closes the "two rows for one quote" bug
  // surfaced by the Shana Krochmal invoice.
  // line_items + order_id feed shouldReplaceLocalInvoiceItems — the pull must
  // know whether a matched row has local itemization worth preserving.
  const { data: existingInvoices } = await supabase
    .from("invoices")
    .select("id, invoice_id, qb_invoice_id, customer_id, customer_name, order_id, line_items, paid")
    .eq("shop_owner", shopOwner);
  const existingByDoc = new Map<string, any>();
  const existingByQbId = new Map<string, any>();
  for (const row of existingInvoices ?? []) {
    if (row.invoice_id) existingByDoc.set(String(row.invoice_id), row);
    if (row.qb_invoice_id) existingByQbId.set(String(row.qb_invoice_id), row);
  }

  let imported = 0;
  let skipped = 0;
  let updated = 0;
  let taxRecords = 0;

  // Service-role client for the tax-audit-record backfill (tax_records is
  // service-role-write-only). Built once; the per-invoice upsert below
  // populates history so the by-state report covers existing invoices.
  const taxAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  for (const qbInv of all) {
    const docNumber = qbInv.DocNumber || `QB-${qbInv.Id}`;

    // Find an existing InkTracker row to update, in priority order:
    //   1. qb_invoice_id match — most authoritative, survives DocNumber
    //      renames (when QB rejects the original number).
    //   2. exact DocNumber match — the common case for unchanged sync.
    //   3. base DocNumber match — when QB now has a -rN revision but
    //      InkTracker still holds the row keyed to the base. Avoids
    //      spawning a sibling row.
    // Falls through to INSERT only when none match.
    const qbId = String(qbInv.Id);
    let existingRow = existingByQbId.get(qbId) || existingByDoc.get(docNumber);
    if (!existingRow) {
      const base = stripDocNumberRevision(docNumber);
      if (base && base !== docNumber) {
        existingRow = existingByDoc.get(base);
      }
    }
    const existingId = existingRow?.id ?? null;

    const qbCustId = qbInv.CustomerRef?.value;
    const custMatch = qbCustId ? custByQbId.get(String(qbCustId)) : null;
    // Sync guard: when QB's customer has no local mapping, PRESERVE the
    // existing local link instead of nulling it (beloved's re-burial,
    // 2026-06-10). Pure logic + regression tests live in _shared/qbInvoice.js.
    const customerFields = resolveInvoiceCustomerFields(
      custMatch,
      existingRow,
      qbInv.CustomerRef?.name || "Unknown",
    );

    const totalAmt = Number(qbInv.TotalAmt ?? 0);
    const balance = Number(qbInv.Balance ?? 0);
    const isPaid = balance === 0 && totalAmt > 0;

    // Map QB line items. stripQbDiscountNote removes the " (less $X
    // discount)" label OUR push appended for QB's tax math — the local row
    // carries discount as real fields; importing the note back duplicated it
    // onto every line (the INV-2026-CQY1X PDF).
    const lineItems = (qbInv.Line ?? [])
      .filter((l: any) => l.DetailType === "SalesItemLineDetail")
      .map((l: any) => ({
        id: `qb-${l.Id || Math.random().toString(36).slice(2)}`,
        style: stripQbDiscountNote(l.Description || l.SalesItemLineDetail?.ItemRef?.name || "Item"),
        garmentCost: 0,
        sizes: {},
        imprints: [],
        qty: Number(l.SalesItemLineDetail?.Qty ?? 1),
        lineTotal: Number(l.Amount ?? 0),
      }));

    // Calculate subtotal (pre-tax)
    const taxTotal = Number(qbInv.TxnTaxDetail?.TotalTax ?? 0);
    const subtotal = totalAmt - taxTotal;

    // Find paid date from linked payments if paid
    let paidDate: string | null = null;
    if (isPaid && qbInv.MetaData?.LastUpdatedTime) {
      paidDate = qbInv.MetaData.LastUpdatedTime.split("T")[0];
    }

    const payload: any = {
      invoice_id: docNumber,
      qb_invoice_id: String(qbInv.Id),
      shop_owner: shopOwner,
      customer_id: customerFields.customer_id,
      customer_name: customerFields.customer_name,
      date: qbInv.TxnDate || null,
      due: qbInv.DueDate || null,
      subtotal,
      tax: taxTotal,
      total: totalAmt,
      paid: isPaid,
      paid_date: paidDate,
      status: isPaid ? "Completed" : "Pending",
      line_items: lineItems,
      notes: qbInv.CustomerMemo?.value || null,
      discount: 0,
      tax_rate: 0,
      rush_rate: 0,
      extras: {},
    };

    if (existingId) {
      // Locally-born invoices (order-born, or rich local line items) keep
      // their itemization and pricing semantics — a Sync-All used to replace
      // them with flattened qb-N stubs and zero the discount (INV-2026-CQY1X,
      // 2026-07-03). QB stays authoritative for money STATE (paid/status/
      // total/tax/dates), which remains in the payload. Local `subtotal` is
      // pre-discount by app semantics; QB's is post-discount — overwriting it
      // while keeping discount>0 would double-discount the display.
      if (!shouldReplaceLocalInvoiceItems(existingRow)) {
        delete payload.line_items;
        delete payload.discount;
        delete payload.tax_rate;
        delete payload.rush_rate;
        delete payload.extras;
        delete payload.subtotal;
        delete payload.notes;
      }
      const { error } = await supabase.from("invoices").update(payload).eq("id", existingId);
      if (error) { console.error("[pullInvoices] update failed:", error.message, docNumber); skipped++; }
      else {
        updated++;
        // Unpaid→paid transition on an order-linked invoice: walk the paid
        // state through to the order too. Without this, a Sync-All that
        // beats the webhook flips the invoice paid directly and the nightly
        // reconcile (candidate filter: paid=false) skips the order forever.
        // Same cascade the webhook/reconcile use; best-effort — a cascade
        // failure must not fail the pull (reconcile can't retry the invoice
        // side, but the order stays visible as unpaid for the operator).
        if (shouldCascadeImportedPaid(existingRow, isPaid)) {
          try {
            await cascadeMarkInvoicePaid(
              supabase,
              { ...existingRow, shop_owner: shopOwner },
              (paidDate || new Date().toISOString().split("T")[0]),
            );
          } catch (cascadeErr) {
            console.error("[pullInvoices] paid cascade to order failed:", (cascadeErr as Error)?.message, docNumber);
          }
        }
      }
    } else {
      const { error } = await supabase.from("invoices").insert(payload);
      if (error) { console.error("[pullInvoices] insert failed:", error.message, docNumber); skipped++; }
      else { imported++; }
    }

    // Tax-audit-record backfill (best-effort). Upsert one record per QB
    // invoice from its authoritative TxnTaxDetail so the by-state report
    // covers history. Ship-to + exemption come from the matched customer
    // (falls back to the QB invoice's ShipAddr). Never fail the pull on this.
    try {
      const taxRecord = buildTaxRecordFromQbInvoice(qbInv, {
        shopOwner,
        quoteId: docNumber,
        qbInvoiceId: qbInv.Id,
        customer: custMatch || undefined,
        isTaxExempt: !!custMatch?.tax_exempt,
      });
      const { error: trErr } = await taxAdmin
        .from("tax_records")
        .upsert(taxRecord, { onConflict: "shop_owner,qb_invoice_id" });
      if (trErr) console.error("[pullInvoices] tax-record upsert error:", trErr.message, docNumber);
      else taxRecords++;
    } catch (err) {
      console.error("[pullInvoices] tax-record build failed:", (err as Error)?.message, docNumber);
    }
  }

  return { imported, skipped, updated, taxRecords, total: all.length, truncatedAtCap };
}

// ── Action: getCustomerStats (live from QB) ────────────────────────────────

// ── Action: getDashboardMetrics (Dashboard + Performance) ────────────────
// Returns the four QB-sourced numbers the dashboard chips display when
// the shop has QB connected:
//   revenueLast30Days / revenueOrderCount   — invoices billed in last 30 days
//   openInvoicesCount / openInvoicesTotal   — AR (Balance > 0)
//
// Strategy: pull every Invoice once (paginated, just Id/TxnDate/TotalAmt
// /Balance columns) and let the pure summarizer do the math. Cheaper
// than two separate filtered queries against QB and matches how
// handleGetCustomerStats already works.
async function handleGetDashboardMetrics(token: string, realmId: string) {
  const all: any[] = [];
  let start = 1;
  const pageSize = 1000;
  while (true) {
    const res = await qbQuery(token, realmId,
      `SELECT Id, TxnDate, TotalAmt, Balance FROM Invoice STARTPOSITION ${start} MAXRESULTS ${pageSize}`
    );
    const batch: any[] = res?.QueryResponse?.Invoice ?? [];
    all.push(...batch);
    if (batch.length < pageSize) break;
    start += pageSize;
    if (start > 10000) break;
  }
  const summary = summarizeInvoicesForDashboard(all, Date.now(), 30);
  return { ...summary, asOf: new Date().toISOString(), source: "quickbooks" };
}

async function handleGetCustomerStats(token: string, realmId: string) {
  const all: any[] = [];
  let start = 1;
  const pageSize = 1000;
  while (true) {
    const res = await qbQuery(token, realmId,
      `SELECT Id, CustomerRef, TotalAmt, Balance FROM Invoice STARTPOSITION ${start} MAXRESULTS ${pageSize}`
    );
    const batch: any[] = res?.QueryResponse?.Invoice ?? [];
    all.push(...batch);
    if (batch.length < pageSize) break;
    start += pageSize;
    if (start > 10000) break;
  }

  // Aggregate per customer: { qbCustomerId: { orders, collected } }
  const stats: Record<string, { orders: number; collected: number }> = {};
  for (const inv of all) {
    const custId = inv.CustomerRef?.value;
    if (!custId) continue;
    if (!stats[custId]) stats[custId] = { orders: 0, collected: 0 };
    stats[custId].orders++;
    const total = Number(inv.TotalAmt ?? 0);
    const balance = Number(inv.Balance ?? 0);
    stats[custId].collected += (total - balance);
  }

  return { stats };
}

// ── Action: checkConnection ─────────────────────────────────────────────────

async function handleCheckConnection(supabase: any, authId: string, email: string | null) {
  const profile = await findUserProfile(supabase, authId, email);
  return extractConnectionStatus(profile);
}

// ── Action: refreshInvoice ──────────────────────────────────────────────────
// Pull current state from QB and reconcile back to the InkTracker quote.
// Recovery primitive for missed webhooks + manual operator audits.
//
// Input:  { quote_id, qb_invoice_id? }
//   quote_id is REQUIRED — we use it (and shop_owner) to fetch the
//   quote row, then either trust the passed qb_invoice_id or read it
//   from the row.
//
// Output: { refreshed: true, qbInvoice, patch, conversion: { action, reason, orderId? } }
//
// Side effects: writes the totals patch to the quotes row; if QB
// reports the invoice fully paid AND the quote is not yet converted,
// runs the same quote → order conversion that the webhook does.

async function handleRefreshInvoice(
  token: string,
  realmId: string,
  params: any,
  adminClient: any,
  shopOwnerEmail: string,
) {
  const quoteId = params?.quote_id;
  if (!quoteId) throw new Error("refreshInvoice: quote_id is required");

  // Always re-fetch the quote (don't trust client state — the row may
  // have been updated between the user opening the modal and clicking
  // Refresh).
  const { data: quote, error: quoteErr } = await adminClient
    .from("quotes")
    .select("*")
    .eq("id", quoteId)
    .eq("shop_owner", shopOwnerEmail)
    .maybeSingle();
  if (quoteErr) throw new Error(`refreshInvoice: quote lookup failed: ${quoteErr.message}`);
  if (!quote)   throw new Error(`refreshInvoice: quote ${quoteId} not found for this shop`);

  const qbInvoiceId = params?.qb_invoice_id || quote.qb_invoice_id;
  if (!qbInvoiceId) {
    return {
      refreshed: false,
      reason: "no_qb_invoice_id",
      message: "This quote isn't linked to a QuickBooks invoice yet. Create one or link an existing one first.",
    };
  }

  // Fetch fresh state from QB.
  const resp = await qbQuery(token, realmId, `SELECT * FROM Invoice WHERE Id = '${escapeQbStringLiteral(qbInvoiceId)}'`);
  const freshInvoice = resp?.QueryResponse?.Invoice?.[0] || null;
  if (!freshInvoice) {
    return {
      refreshed: false,
      reason: "qb_invoice_not_found",
      message: `QuickBooks no longer has an invoice with Id ${qbInvoiceId}. It may have been deleted in QB.`,
    };
  }

  // Patch quotes row with fresh QB-side totals + paid state.
  const patch: any = buildQuotePatchFromFreshInvoice(freshInvoice, quote);
  if (patch) {
    await adminClient
      .from("quotes")
      .update(patch)
      .eq("id", quote.id)
      .eq("shop_owner", quote.shop_owner);
  }

  // Convert quote → order if newly paid + not already converted.
  // Same idempotency contract as the webhook handler so a refresh and
  // a webhook racing each other can't double-create an order.
  const conversion = decideRefreshConversion(freshInvoice, quote);
  let orderId: string | undefined;
  if (conversion.action === REFRESH_CONVERSION.CONVERT) {
    // Re-read the quote AFTER applying the patch so the order row
    // carries the latest paid state (deposit_paid etc.).
    const { data: latestQuote } = await adminClient
      .from("quotes")
      .select("*")
      .eq("id", quote.id)
      .eq("shop_owner", quote.shop_owner)
      .maybeSingle();
    orderId = await convertQuoteToOrder(adminClient, latestQuote || quote);

    // Same payment-received notification the webhook would have sent,
    // for the case where Refresh caught a payment the webhook missed.
    // Best-effort: a Resend failure must not break the response.
    try {
      const q = latestQuote || quote;
      const recipient = chooseQuotePaymentRecipient(q);
      let email: any = null;
      if (recipient) {
        const { data: shopRow } = await adminClient
          .from("shops")
          .select("shop_name")
          .eq("owner_email", q.shop_owner)
          .maybeSingle();
        email = buildQuotePaymentEmail({
          quote: q, shop: shopRow, customer: null, recipient,
          orderId, amountPaid: q.total,
        });
      }
      await sendAndLogApprovalNotification(adminClient, {
        shop_owner: q.shop_owner,
        event_type: "quote_payment",
        quote_id:   q.id,
        recipient_email: recipient?.to ?? "",
        recipient_role:  recipient?.role,
        to:       recipient?.to,
        subject:  email?.subject,
        html:     email?.html,
        reply_to: email?.reply_to,
      });
    } catch (notifyErr) {
      console.error("[refreshInvoice] payment notification failed:", notifyErr);
    }
  }

  return {
    refreshed: true,
    qbInvoiceId,
    qbTotal:     Number(freshInvoice.TotalAmt ?? 0),
    qbBalance:   Number(freshInvoice.Balance ?? 0),
    paid:        patch?.paid ?? Boolean(quote.paid),
    conversion: {
      action: conversion.action,
      reason: conversion.reason,
      orderId,
    },
  };
}

// ── Action: linkQbInvoice ───────────────────────────────────────────────────
// Operator pastes a QB invoice Id or DocNumber. We locate the invoice,
// validate it's unambiguous, and write qb_invoice_id back to the
// quote. Lets shops adopt QB invoices created outside InkTracker
// (manual entry in QBO, migration from a prior system) without
// double-billing the customer.

async function handleLinkQbInvoice(
  token: string,
  realmId: string,
  params: any,
  adminClient: any,
  shopOwnerEmail: string,
) {
  const quoteId = params?.quote_id;
  const raw     = params?.qb_invoice_input;
  if (!quoteId) throw new Error("linkQbInvoice: quote_id is required");

  const classification = classifyLinkInput(raw);
  if (classification.kind === LINK_INPUT_KIND.INVALID) {
    return {
      linked: false,
      reason: "invalid_input",
      message: "Type a QuickBooks invoice number (e.g. Q-2026-115) or numeric Id.",
    };
  }

  // Search QB. Id lookup is exact; DocNumber lookup may return >1
  // (QB doesn't enforce DocNumber uniqueness — we handle the
  // ambiguous case downstream).
  const where = classification.kind === LINK_INPUT_KIND.ID
    ? `Id = '${escapeQbStringLiteral(classification.value)}'`
    : `DocNumber = '${escapeQbStringLiteral(classification.value)}'`;
  const resp = await qbQuery(token, realmId, `SELECT * FROM Invoice WHERE ${where}`);
  const hits = resp?.QueryResponse?.Invoice ?? [];
  const decision = chooseInvoiceCandidate(classification.kind, hits);

  if (decision.outcome === LINK_OUTCOMES.NOT_FOUND) {
    return {
      linked: false,
      reason: "not_found",
      message: `No QuickBooks invoice matches "${classification.value}".`,
    };
  }
  if (decision.outcome === LINK_OUTCOMES.AMBIGUOUS) {
    return {
      linked: false,
      reason: "ambiguous",
      message:
        `Multiple QuickBooks invoices share DocNumber "${classification.value}" ` +
        `(Ids: ${decision.candidateIds.join(", ")}). ` +
        `Use the numeric Invoice Id instead to disambiguate.`,
    };
  }

  const linkedInvoice = decision.invoice;
  const patch: any = buildLinkPatch(linkedInvoice);

  // Tenant-scoped write. Even though the caller is authenticated, the
  // shop_owner filter ensures we never silently link a quote owned
  // by a different tenant on a row-id collision.
  const { error: updateErr } = await adminClient
    .from("quotes")
    .update(patch)
    .eq("id", quoteId)
    .eq("shop_owner", shopOwnerEmail);
  if (updateErr) throw new Error(`linkQbInvoice: write failed: ${updateErr.message}`);

  return {
    linked: true,
    qbInvoiceId: patch.qb_invoice_id,
    qbDocNumber: linkedInvoice.DocNumber || null,
    paid:        Boolean(patch.paid),
    paymentLink: patch.qb_payment_link || null,
  };
}

// ── Action: recordPayment ──────────────────────────────────────────────────
// Operator clicked "Mark as Paid" on an InkTracker invoice/quote that's
// linked to a QB invoice. Push the payment to QB so the two systems
// stay in sync — without it, marking paid in InkTracker would silently
// diverge from QB's still-open balance.
//
// Idempotent: if QB already shows Balance = 0 (the customer paid via the
// portal link and the webhook hasn't caught up locally yet), skip the
// create and just flip the local paid flag.
//
// Defaults: PaymentMethod is unset on the QB Payment — QB shows it as
// "no payment method", which is fine for a generic "operator recorded
// it" entry. Operator can edit in QB if they want to tag it cash/check.
// PrivateNote names the originating InkTracker DocNumber for audit.
async function handleRecordPayment(
  token: string,
  realmId: string,
  params: any,
  adminClient: any,
  shopOwnerEmail: string,
) {
  const invoiceId = params?.invoice_id;
  const quoteId   = params?.quote_id;
  if (!invoiceId && !quoteId) {
    throw new Error("recordPayment: invoice_id or quote_id is required");
  }
  const table = invoiceId ? "invoices" : "quotes";
  const rowId = invoiceId || quoteId;

  const { data: row, error: rowErr } = await adminClient
    .from(table)
    .select("*")
    .eq("id", rowId)
    .eq("shop_owner", shopOwnerEmail)
    .maybeSingle();
  if (rowErr) throw new Error(`recordPayment: ${table} lookup failed: ${rowErr.message}`);
  if (!row)   throw new Error(`recordPayment: ${table} ${rowId} not found for this shop`);

  const qbInvoiceId = row.qb_invoice_id;
  if (!qbInvoiceId) {
    return {
      recorded: false,
      reason: "no_qb_invoice_id",
      message: "This row isn't linked to a QuickBooks invoice. Mark it paid locally only.",
    };
  }

  // Pull current QB state — both for the idempotency guard and for the
  // CustomerRef we need to attach to the Payment row.
  const resp = await qbQuery(token, realmId, `SELECT * FROM Invoice WHERE Id = '${escapeQbStringLiteral(qbInvoiceId)}'`);
  const freshInvoice = resp?.QueryResponse?.Invoice?.[0] || null;
  if (!freshInvoice) {
    return {
      recorded: false,
      reason: "qb_invoice_not_found",
      message: `QuickBooks no longer has an invoice with Id ${qbInvoiceId}. It may have been deleted in QB.`,
    };
  }

  const nowIso = new Date().toISOString();
  const qbBalance = Number(freshInvoice.Balance ?? 0);
  if (qbBalance === 0) {
    // QB already paid — just sync local. No new Payment row to avoid double-counting.
    await adminClient
      .from(table)
      .update({ paid: true, paid_date: nowIso, qb_synced_at: nowIso })
      .eq("id", row.id)
      .eq("shop_owner", shopOwnerEmail);
    return {
      recorded: false,
      alreadyPaidInQb: true,
      message: "QuickBooks already shows this invoice as paid. Local state synced.",
    };
  }

  const customerRef = freshInvoice?.CustomerRef?.value;
  if (!customerRef) throw new Error("recordPayment: QB invoice missing CustomerRef");

  // Default: pay the remaining QB balance in full. Caller can override
  // with params.amount for partial payments (not used in v1 UI but the
  // server-side contract supports it). CLAMP to the remaining balance so a
  // repeated "Mark as Paid" (after the idempotency TTL) or an explicit
  // amount > balance can NEVER drive the invoice negative — closes the
  // partial-payment overpay window the 5-min idempotency alone didn't.
  const { amount, valid, capped } = clampPaymentAmount(params?.amount ?? qbBalance, qbBalance);
  if (!valid) {
    throw new Error("recordPayment: amount must be a positive number");
  }

  const docLabel = row.qb_doc_number || `Id ${qbInvoiceId}`;

  // Guard the actual QB Payment write against a double-click / retry. Without
  // this, two near-simultaneous "Mark as Paid" clicks both read Balance > 0
  // (QB hasn't posted the first payment yet) and each create a Payment, leaving
  // the invoice overpaid (negative balance) until an operator voids one in QB.
  // Mirrors createInvoice's protection. Key is deterministic per
  // invoice+amount so the same intent collides within the TTL; an explicit
  // idempotencyKey from the caller wins if provided.
  const idempKey = params?.idempotencyKey ?? `record_payment:${table}:${rowId}:${amount}`;
  const idemp = await withQbIdempotency(
    adminClient,
    idempKey,
    { shop_owner: shopOwnerEmail, action: "record_payment" },
    async () => {
      const payment = await qbCreate(token, realmId, "payment", {
        CustomerRef: { value: customerRef },
        TotalAmt: amount,
        PrivateNote: `InkTracker manual payment recorded for ${docLabel}`,
        Line: [{
          Amount: amount,
          LinkedTxn: [{ TxnId: qbInvoiceId, TxnType: "Invoice" }],
        }],
      });

      await adminClient
        .from(table)
        .update({ paid: true, paid_date: nowIso, qb_synced_at: nowIso })
        .eq("id", row.id)
        .eq("shop_owner", shopOwnerEmail);

      return {
        recorded: true,
        qbPaymentId: payment?.Payment?.Id ?? null,
        qbDocNumber: row.qb_doc_number || null,
        amount,
        ...(capped
          ? { capped: true, message: `Payment capped to the remaining balance ($${qbBalance.toFixed(2)}) to avoid overpaying.` }
          : {}),
      };
    },
  );

  // A concurrent click is mid-write — don't fire a second Payment. Report it as
  // a non-error so the UI can just refresh.
  if (idemp.inFlight) {
    return {
      recorded: false,
      reason: "in_flight",
      message: "This payment is already being recorded. Refresh in a moment to see it.",
    };
  }
  return idemp.result;
}

// ── Action: listIncomeAccounts ──────────────────────────────────────────────
// Read-only: the shop's QB Income accounts, for the Account → QuickBooks
// income-account picker. Lets the shop choose where InkTracker revenue posts
// instead of qbSync guessing.
async function handleListIncomeAccounts(token: string, realmId: string) {
  const res = await qbQuery(token, realmId,
    "SELECT Id, Name FROM Account WHERE AccountType = 'Income' MAXRESULTS 100"
  );
  const accts: any[] = res?.QueryResponse?.Account ?? [];
  // autoSelectedId = where "Auto" actually posts, so the UI shows it (not
  // silent). Mirror resolveItemIdMap: prefer the account the shop's existing
  // items use most (dominant), else the name-based guess.
  let dominantIncome: string | null = null;
  try {
    const itemsRes = await qbQuery(token, realmId, "SELECT Id, IncomeAccountRef FROM Item MAXRESULTS 1000");
    dominantIncome = dominantItemIncomeAccount(itemsRes?.QueryResponse?.Item ?? []);
  } catch { /* fall back to the name-based pick */ }
  const autoSelectedId = pickIncomeAccountId(accts, dominantIncome).id;
  return { accounts: accts.map((a) => ({ id: String(a.Id), name: a.Name })), autoSelectedId };
}

// ── Action: getQbEvents ─────────────────────────────────────────────────────
// Returns the qb_event_log timeline for one quote, scoped by the
// caller's shop_owner. Powers the "QB Events" tab in QuoteDetailModal.
// Read-only — no writes, no side effects.

async function handleGetQbEvents(adminClient: any, quoteId: string, shopOwnerEmail: string, limit: number) {
  if (!quoteId) throw new Error("getQbEvents: quote_id is required");
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));

  const { data, error } = await adminClient
    .from("qb_event_log")
    .select("id, action, direction, status, qb_invoice_id, qb_customer_id, error_message, request_body, response_body, idempotency_key, duration_ms, created_at")
    .eq("quote_id", quoteId)
    .eq("shop_owner", shopOwnerEmail)
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error) throw new Error(`getQbEvents: ${error.message}`);
  return { events: data ?? [], count: data?.length ?? 0, limit: safeLimit };
}

// ── Main handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const { action, accessToken, ...params } = body;

    if (!accessToken) {
      return Response.json({ error: "accessToken required" }, { status: 401, headers: CORS });
    }

    // Build Supabase client scoped to this user (respects RLS)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${accessToken}` } } }
    );

    // Identify the authenticated user — profiles.auth_id is the only reliable filter
    const { data: { user }, error: userErr } = await supabase.auth.getUser(accessToken);
    if (userErr || !user) {
      return Response.json({ error: "Invalid access token" }, { status: 401, headers: CORS });
    }

    if (action === "checkConnection") {
      const result = await handleCheckConnection(supabase, user.id, user.email ?? null);
      return Response.json(result, { headers: CORS });
    }

    // Hoisted ABOVE the subscription + token gates because:
    //   - it's a pure DB read (no QB API call), so QB tokens irrelevant
    //   - operators with a disconnected/expired QB connection still
    //     need to view "what happened?" — gating this on a live QB
    //     token would hide history exactly when they want it
    //   - subscription-expired shops should still see their own audit
    //     trail (read-only is not a billable QB write)
    if (action === "getQbEvents") {
      const adminClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      // Resolve the shop for tenant scoping without a token check.
      const { data: shopProfile } = await supabase
        .from("profiles")
        .select("shop_owner, email")
        .eq("auth_id", user.id)
        .maybeSingle();
      const shopOwnerEmail = shopProfile?.shop_owner || shopProfile?.email || user.email || "";
      const result = await handleGetQbEvents(adminClient, params?.quote_id, shopOwnerEmail, params?.limit);
      return Response.json({ success: true, ...result }, { headers: CORS });
    }

    // Read-only: list the shop's active QB product/service items so the Account
    // UI can map InkTracker garment categories to the shop's real items. No
    // subscription gate — it's a read, not a billable QB write.
    if (action === "listQbItems") {
      try {
        const { accessToken, realmId } = await getValidTokens(supabase, user.id, user.email ?? null);
        const res = await qbQuery(accessToken, realmId, "SELECT Id, Name FROM Item WHERE Active = true MAXRESULTS 1000");
        const items = (res?.QueryResponse?.Item ?? [])
          .map((i: any) => ({ id: String(i.Id), name: i.Name }))
          .filter((i: any) => i.name)
          .sort((a: any, b: any) => a.name.localeCompare(b.name));
        return Response.json({ success: true, items }, { headers: CORS });
      } catch (err) {
        return Response.json(
          { success: false, error: (err as Error)?.message || "Failed to list QuickBooks items" },
          { headers: CORS },
        );
      }
    }

    if (action === "disconnect") {
      // Clears QB tokens from BOTH profile_secrets (the new home) AND
      // profiles (legacy fallback). Before this existed, the client did
      // a direct UPDATE on profiles only — which left profile_secrets
      // untouched. Since loadProfileWithSecrets prefers profile_secrets,
      // the "disconnect" wasn't actually disconnecting anything; the next
      // checkConnection still saw valid tokens and reported connected.
      // No subscription gate — letting paid-status edge cases prevent
      // disconnect would lock people out of their own tokens.
      const adminClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const profile = await loadProfileWithSecrets(adminClient, { auth_id: user.id });
      if (!profile) {
        return Response.json({ error: "Profile not found" }, { status: 404, headers: CORS });
      }
      // Revoke the grant at Intuit FIRST (best-effort) so "disconnect" actually
      // ends the authorization, not just our copy of the tokens. Revoking the
      // refresh token invalidates the whole grant. Never blocks the local clear.
      await revokeQbToken(profile.qb_refresh_token || profile.qb_access_token || null);
      await updateProfileSecrets(
        adminClient,
        profile.id,
        {
          qb_access_token: null,
          qb_refresh_token: null,
          qb_realm_id: null,
          qb_token_expires_at: null,
          // Clear the newer bookkeeping columns too so nothing stale lingers.
          qb_refresh_token_expires_at: null,
          qb_token_refresh_lock: null,
        },
      );
      return Response.json({ ok: true }, { headers: CORS });
    }

    // Subscription check — QB write operations cost money.
    // requireActiveSubscription returns a 403 Response. We unwrap its
    // body and re-emit as a 200 + success:false so SendQuoteModal /
    // any other caller sees the clean message via data.error instead
    // of "Edge Function returned a non-2xx status code".
    {
      const { data: subProfile } = await supabase.from("profiles").select("subscription_tier, subscription_status, trial_ends_at, shop_owner, email").eq("auth_id", user.id).maybeSingle();
      const blocked = requireActiveSubscription(subProfile);
      if (blocked) {
        const body = await blocked.json().catch(() => ({ error: "Subscription required" }));
        return Response.json(
          { success: false, error_code: USER_FACING_CODES.SUBSCRIPTION_BLOCKED, error: body.error },
          { status: 200, headers: CORS },
        );
      }
    }

    // All other actions need valid QB tokens
    const { accessToken: qbToken, realmId } = await getValidTokens(supabase, user.id, user.email ?? null);

    // Resolve the SHOP owner email for tenant scoping. For shop owners this
    // is identical to user.email; for brokers/managers it's the assigned
    // shop's owner_email. Previously these handlers used user.email
    // directly, which mis-scoped pulls for any non-owner role.
    const { data: shopProfile } = await supabase
      .from("profiles")
      .select("shop_owner, email")
      .eq("auth_id", user.id)
      .maybeSingle();
    const shopOwnerEmail = shopProfile?.shop_owner || shopProfile?.email || user.email || "";
    // Fail closed if we couldn't derive a tenant scope. An empty string
    // would still find no rows in practice today, but anyone refactoring
    // a downstream `.eq("shop_owner", shopOwnerEmail)` into a partial
    // match would suddenly match all rows where shop_owner is empty.
    // 401 is the safest answer — caller should never reach this branch.
    if (!shopOwnerEmail) {
      return Response.json({ error: "Unable to derive tenant scope" }, { status: 401, headers: CORS });
    }

    let result: any;
    switch (action) {
      case "createInvoice": {
        // ── Idempotency + audit envelope ─────────────────────────────
        // Every createInvoice is wrapped twice:
        //   (a) withQbIdempotency — short-circuits a duplicate request
        //       carrying the same key within the 5-min TTL, returning
        //       the cached result instead of firing QB again. This is
        //       what prevents the "double-click Send creates two
        //       invoices" race.
        //   (b) withQbAudit — records start + completion rows in
        //       qb_event_log around the actual QB write, so the
        //       QuoteDetailModal "QB Events" tab can render the
        //       provenance trail.
        // Both wrappers need service-role access (the two tables are
        // service-role-only). The audit/idempotency calls are
        // best-effort: if the log/cache write fails, the QB call
        // still runs and the caller still gets its result.
        const adminClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        const quote        = params?.quote ?? {};
        const idempKey     = params?.idempotencyKey ?? null;
        const quoteShop    = quote?.shop_owner || shopOwnerEmail;
        const auditCtx = {
          shop_owner:      quoteShop,
          action:          "create_invoice",
          quote_id:        quote?.id ?? null,
          qb_invoice_id:   quote?.qb_invoice_id ?? null,
          idempotency_key: idempKey,
          request_body: {
            quote_id:       quote?.quote_id,
            customer_email: quote?.customer_email,
            total:          params?.invoicePayload?.total,
            line_count:     params?.invoicePayload?.lines?.length,
            has_deposit:    Boolean(quote?.deposit_paid),
          },
        };
        // (c) withQbRowSerialization — the per-ROW lock. Caller keys only
        //     collapse duplicates of the SAME button; two different surfaces
        //     (order-completion auto-push + the invoice modal) carry
        //     different keys and previously ran concurrently, double-creating
        //     (INV-2026-OW0M1, 2026-07-17). Later arrivals now WAIT for the
        //     holder, then run against fresh DB state — the authoritative
        //     re-read inside handleCreateInvoice routes them onto UPDATE.
        const rowLockKey = quote?.id
          ? `create_invoice_row:${quote.id}`
          : (quote?.quote_id ? `create_invoice_row:${quoteShop}:${quote.quote_id}` : null);
        const idempOutcome = await withQbIdempotency(
          adminClient,
          idempKey,
          { shop_owner: quoteShop, action: "create_invoice" },
          async () => {
            const serialized = await withQbRowSerialization(
              adminClient,
              rowLockKey,
              { shop_owner: quoteShop, action: "create_invoice_lock" },
              () => withQbAudit(adminClient, auditCtx, () =>
                handleCreateInvoice(qbToken, realmId, params, supabase),
              ),
            );
            if (!serialized.acquired) {
              return {
                inFlight: true,
                message: "Another sync for this invoice is still running — wait a moment, then refresh.",
              };
            }
            return serialized.result;
          },
        );
        if (idempOutcome.outcome === IDEMPOTENCY_OUTCOMES.IN_FLIGHT) {
          // Another request with the same key is mid-flight. Don't
          // fire a parallel QB write. The caller surfaces a
          // "already creating, refresh in a moment" hint.
          result = {
            inFlight: true,
            message: "Another request with the same idempotency key is still processing.",
          };
          break;
        }
        result = idempOutcome.result;
        if (idempOutcome.fromCache) result = { ...result, fromCache: true };
        break;
      }
      case "estimateTax": {
        // Quote-time "Calculate tax" — non-posting Estimate round-trip to read
        // QB's authoritative tax. No idempotency/audit envelope: it's a
        // read-style compute (the Estimate is reused per quote, not a ledger write).
        result = await handleEstimateTax(qbToken, realmId, params, supabase);
        break;
      }
      case "syncCustomer": {
        const { customer } = params;
        if (!customer) throw new Error("Missing customer payload");
        const qbCustomerId = await findOrCreateCustomer(qbToken, realmId, customer, supabase);
        result = { qbCustomerId };
        break;
      }
      case "pullCustomers":
        result = await handlePullCustomers(qbToken, realmId, supabase, shopOwnerEmail);
        break;
      case "pullInvoices":
        result = await handlePullInvoices(qbToken, realmId, supabase, shopOwnerEmail);
        break;
      case "getCustomerStats":
        result = await handleGetCustomerStats(qbToken, realmId);
        break;
      case "getDashboardMetrics":
        result = await handleGetDashboardMetrics(qbToken, realmId);
        break;
      case "getInvoicePDF": {
        const invId = params.qbInvoiceId;
        if (!invId) throw new Error("qbInvoiceId required");
        const pdfRes = await fetch(
          `${QB_BASE}/${realmId}/invoice/${invId}/pdf?minorversion=65`,
          { headers: { ...qbHeaders(qbToken), Accept: "application/pdf" } }
        );
        if (!pdfRes.ok) throw new Error(`QB PDF fetch failed: ${pdfRes.status}`);
        const pdfBuffer = await pdfRes.arrayBuffer();
        // Chunked base64 conversion to avoid max argument overflow on large PDFs
        const bytes = new Uint8Array(pdfBuffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        }
        const base64 = btoa(binary);
        result = { pdf: base64, filename: `Invoice-${invId}.pdf` };
        break;
      }
      case "lookupCustomerById": {
        // Read-only QB query. Used by the Customer Duplicates UI
        // after the operator merges two customers inside QuickBooks
        // — we ping each side's qb_customer_id to figure out which
        // one survived (Active=true) and which one is now Active=
        // false (the losing record after a QB merge). Read-only by
        // design so this surface can never accidentally damage QB.
        const custId = params.customerId;
        if (!custId) throw new Error("customerId required");
        const custRes = await qbQuery(qbToken, realmId, `SELECT * FROM Customer WHERE Id = '${escapeQbStringLiteral(custId)}'`);
        const cust = custRes?.QueryResponse?.Customer?.[0];
        if (!cust) {
          result = { status: "notfound", qb_customer_id: custId };
        } else if (cust.Active === false) {
          result = {
            status: "inactive",
            qb_customer_id: custId,
            displayName: cust.DisplayName,
            mergedIntoId: cust.MergedIntoId ?? null,
          };
        } else {
          result = {
            status: "active",
            qb_customer_id: custId,
            displayName: cust.DisplayName,
          };
        }
        break;
      }
      case "scanInactiveCustomers": {
        // Batch read-only check. Given an array of QB customer IDs,
        // return only the ones that are now Active=false (i.e. were
        // merged into another QB customer). Used by the Customers
        // page on load to auto-detect post-QB-merge orphans without
        // making one QB call per customer. One QB SELECT regardless
        // of list size. Read-only — no mutation, no QB-side write.
        const idsRaw = Array.isArray(params.customerIds) ? params.customerIds : [];
        // Use escapeQbStringLiteral on each ID — QBO query language
        // uses single quotes as string delimiters, and the helper
        // doubles any quote per QBO BNF. Belt-and-suspenders with
        // the local DB (which only ever stores numeric QB IDs).
        const ids = idsRaw
          .map((v: unknown) => String(v ?? "").trim())
          .filter((s: string) => s.length > 0);
        if (ids.length === 0) {
          result = { inactive: [] };
          break;
        }
        const idList = ids.map((id: string) => `'${escapeQbStringLiteral(id)}'`).join(",");
        const r = await qbQuery(
          qbToken,
          realmId,
          `SELECT Id, DisplayName, Active, MergedIntoId FROM Customer WHERE Active = false AND Id IN (${idList})`,
        );
        const rows = r?.QueryResponse?.Customer || [];
        result = {
          inactive: rows.map((c: { Id: string; DisplayName?: string; MergedIntoId?: string }) => ({
            qb_customer_id: c.Id,
            displayName: c.DisplayName || "",
            mergedIntoId: c.MergedIntoId ?? null,
          })),
        };
        break;
      }
      case "deactivateCustomer": {
        const custId = params.customerId;
        if (!custId) throw new Error("customerId required");
        const custRes = await qbQuery(qbToken, realmId, `SELECT * FROM Customer WHERE Id = '${escapeQbStringLiteral(custId)}'`);
        const cust = custRes?.QueryResponse?.Customer?.[0];
        if (cust) {
          await qbUpdate(qbToken, realmId, "customer", {
            Id: cust.Id,
            SyncToken: cust.SyncToken,
            Active: false,
            DisplayName: cust.DisplayName,
            sparse: true,
          });
          result = { deactivated: true, customerId: custId };
        } else {
          result = { deactivated: false, reason: "Customer not found in QB" };
        }
        break;
      }
      case "refreshInvoice": {
        const adminClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        const auditCtx = {
          shop_owner:    shopOwnerEmail,
          action:        "refresh_invoice",
          quote_id:      params?.quote_id ?? null,
          qb_invoice_id: params?.qb_invoice_id ?? null,
          request_body:  { quote_id: params?.quote_id, qb_invoice_id: params?.qb_invoice_id },
        };
        result = await withQbAudit(adminClient, auditCtx, () =>
          handleRefreshInvoice(qbToken, realmId, params, adminClient, shopOwnerEmail),
        );
        break;
      }
      case "linkQbInvoice": {
        const adminClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        const auditCtx = {
          shop_owner:   shopOwnerEmail,
          action:       "link_qb_invoice",
          quote_id:     params?.quote_id ?? null,
          request_body: { quote_id: params?.quote_id, qb_invoice_input: params?.qb_invoice_input },
        };
        result = await withQbAudit(adminClient, auditCtx, () =>
          handleLinkQbInvoice(qbToken, realmId, params, adminClient, shopOwnerEmail),
        );
        break;
      }
      case "recordPayment": {
        const adminClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        const auditCtx = {
          shop_owner:    shopOwnerEmail,
          action:        "record_payment",
          quote_id:      params?.quote_id ?? null,
          qb_invoice_id: params?.qb_invoice_id ?? null,
          request_body:  {
            invoice_id: params?.invoice_id,
            quote_id:   params?.quote_id,
            amount:     params?.amount ?? null,
          },
        };
        result = await withQbAudit(adminClient, auditCtx, () =>
          handleRecordPayment(qbToken, realmId, params, adminClient, shopOwnerEmail),
        );
        break;
      }
      case "listIncomeAccounts": {
        result = await handleListIncomeAccounts(qbToken, realmId);
        break;
      }
      default:
        return Response.json({ error: `Unknown action: ${action}` }, { status: 400, headers: CORS });
    }

    return Response.json({ success: true, ...result }, { headers: CORS });
  } catch (err) {
    await captureError(err, { fn: "qbSync" });
    // QbRateLimitError survives all retries → tell the frontend it's a
    // throttle, not a hard failure. 200 + structured body so the JS
    // client's FunctionsHttpError doesn't swallow the retry-after value.
    if (err instanceof QbRateLimitError) {
      console.warn(`qbSync rate-limited on ${err.label}: retry in ${err.retryAfterSeconds}s`);
      return Response.json(
        {
          success: false,
          error_code: "qb_rate_limited",
          error: `QuickBooks is rate-limiting requests. Try again in about ${err.retryAfterSeconds} second${err.retryAfterSeconds === 1 ? "" : "s"}.`,
          retry_after_seconds: err.retryAfterSeconds,
        },
        { status: 200, headers: CORS },
      );
    }
    // Known user-facing errors land as 200 + success:false so the
    // Supabase JS client's FunctionsHttpError wrap doesn't swallow
    // the message. See _shared/userFacingError.ts for the rationale.
    if (isUserFacingError(err)) {
      return Response.json(
        { success: false, error_code: err.code, error: err.message },
        { status: 200, headers: CORS },
      );
    }
    console.error("qbSync error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500, headers: CORS });
  }
});
