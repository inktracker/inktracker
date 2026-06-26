// QuickBooks sync — handles all QB API operations from the InkTracker frontend.
// Actions: checkConnection | createInvoice | syncExpense | getCustomers

import { createClient } from "npm:@supabase/supabase-js@2";
import { loadProfileWithSecrets, updateProfileSecrets } from "../_shared/profileSecrets.ts";
import { refreshQbTokenSerialized } from "../_shared/qbTokenLock.js";
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
  buildUpdateFailureResponse,
  resolveInvoiceCustomerFields,
} from "../_shared/qbInvoice.js";
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
    console.error(`[qbSync] Token refresh failed: ${res.status} ${body}`);
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
): Promise<{ link: string | null; finalInvoice: any; reason: string | null }> {
  if (!billEmail) {
    console.warn("[mintInvoicePaymentLink] no billEmail — skipping /send. Customer email is required to mint a share link.");
    return { link: null, finalInvoice: initialInvoice, reason: "no_bill_email" };
  }

  let invoiceForLink: any = initialInvoice;
  try {
    const sent = await qbSendInvoice(token, realmId, invoiceId, billEmail);
    invoiceForLink = sent?.Invoice || sent || invoiceForLink;
  } catch (sendErr) {
    console.warn("[mintInvoicePaymentLink] /send failed after retries:", sendErr instanceof Error ? sendErr.message : String(sendErr));
    // We still try the refetch path — sometimes /send 500s but the portal
    // record IS provisioned and a follow-up GET picks it up.
  }

  let link = sharedExtractPaymentLink(invoiceForLink);
  if (link) return { link, finalInvoice: invoiceForLink, reason: null };

  // First refetch — wait a beat for async portal provisioning.
  await new Promise((r) => setTimeout(r, 1500));
  let refetched = await qbFetchInvoiceWithLink(token, realmId, invoiceId);
  if (refetched) {
    invoiceForLink = refetched?.Invoice || refetched;
    link = sharedExtractPaymentLink(invoiceForLink);
    if (link) {
      console.log("[mintInvoicePaymentLink] link picked up on first refetch");
      return { link, finalInvoice: invoiceForLink, reason: null };
    }
  }

  // Second refetch — give QBO more time for the slow provisioning path.
  await new Promise((r) => setTimeout(r, 3000));
  refetched = await qbFetchInvoiceWithLink(token, realmId, invoiceId);
  if (refetched) {
    invoiceForLink = refetched?.Invoice || refetched;
    link = sharedExtractPaymentLink(invoiceForLink);
    if (link) {
      console.log("[mintInvoicePaymentLink] link picked up on second refetch");
      return { link, finalInvoice: invoiceForLink, reason: null };
    }
  }

  console.warn("[mintInvoicePaymentLink] no link after retries + 2 refetches. Most likely cause: shop hasn't activated QB Payments on their QuickBooks account. Final invoice shape:", JSON.stringify(invoiceForLink));
  return { link: null, finalInvoice: invoiceForLink, reason: "no_link_after_retry" };
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

  const body = buildQBCustomerBody(customer, displayName);
  body.Id = qbId;
  body.SyncToken = current.SyncToken;
  body.sparse = true;

  await qbUpdate(token, realmId, "customer", body);
  return qbId;
}

async function findOrCreateCustomer(token: string, realmId: string, customer: any, supabase: any) {
  if (!customer) throw new Error("No customer data provided");
  // If already linked, push non-empty fields back to QB (sparse update — never wipes QB data)
  if (customer.qb_customer_id) {
    try {
      await updateQBCustomer(token, realmId, customer.qb_customer_id, customer);
    } catch (err) {
      console.warn("[QB] customer update failed (non-blocking):", err?.message);
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

  // Only search by email when it actually looks like an email. Junk
  // values (names, phone numbers) in the customers.email column would
  // otherwise blow the query syntax or just return zero results.
  if (isLikelyEmail(customer.email)) {
    const res = await qbQuery(token, realmId,
      `SELECT Id FROM Customer WHERE PrimaryEmailAddr = '${escapeQbStringLiteral(customer.email.trim())}'`
    );
    const rows = res?.QueryResponse?.Customer ?? [];
    if (rows.length > 0) qbCustomerId = rows[0].Id;
  }

  if (!qbCustomerId) {
    const safeName = escapeQbStringLiteral(displayName);
    const res = await qbQuery(token, realmId,
      `SELECT Id FROM Customer WHERE DisplayName = '${safeName}'`
    );
    const rows = res?.QueryResponse?.Customer ?? [];
    if (rows.length > 0) qbCustomerId = rows[0].Id;
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

async function findIncomeAccountId(token: string, realmId: string) {
  // Prefer "Sales" / "Services" / generic income; fall back to the first Income account.
  const preferred = ["Sales of Product Income", "Services", "Sales", "Income"];
  try {
    const res = await qbQuery(token, realmId,
      "SELECT Id, Name, AccountType FROM Account WHERE AccountType = 'Income' MAXRESULTS 100"
    );
    const accts: any[] = res?.QueryResponse?.Account ?? [];
    for (const name of preferred) {
      const hit = accts.find((a) => a.Name === name);
      if (hit) return hit.Id;
    }
    if (accts.length > 0) return accts[0].Id;
  } catch {}

  // Create a fallback Income account if none exists
  const created = await qbCreate(token, realmId, "account", {
    Name: "InkTracker Sales",
    AccountType: "Income",
    AccountSubType: "SalesOfProductIncome",
  });
  return created?.Account?.Id ?? null;
}

// Find-or-create a QB Service item by exact name, returning its Id.
// Caches the income account lookup across calls in the same request via a closure arg.
async function findOrCreateServiceItem(
  token: string,
  realmId: string,
  itemName: string,
  incomeAccountId: string,
) {
  const safe = escapeQbStringLiteral(itemName);
  const res = await qbQuery(token, realmId,
    `SELECT Id, Name FROM Item WHERE Name = '${safe}'`
  );
  const existing = res?.QueryResponse?.Item?.[0];
  if (existing) return existing.Id;

  const created = await qbCreate(token, realmId, "item", {
    Name: itemName,
    Type: "Service",
    IncomeAccountRef: { value: incomeAccountId },
  });
  return created?.Item?.Id ?? null;
}

// Resolve every unique item name referenced in a payload to its QB Item Id.
async function resolveItemIdMap(
  token: string,
  realmId: string,
  invoicePayload: any,
): Promise<Map<string, string>> {
  const names = new Set<string>();
  for (const line of invoicePayload?.lines ?? []) {
    names.add((line.itemName || DEFAULT_ITEM_NAME).trim());
  }
  names.add(DEFAULT_ITEM_NAME);

  const incomeAccountId = await findIncomeAccountId(token, realmId);
  if (!incomeAccountId) throw new Error("No QB Income account found; cannot create service items");

  const map = new Map<string, string>();
  for (const name of names) {
    const id = await findOrCreateServiceItem(token, realmId, name, incomeAccountId);
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
  const { quote, customer, invoicePayload } = params;

  if (!invoicePayload?.lines?.length) {
    throw new Error("Missing invoicePayload — frontend must compute quote totals");
  }

  // 1. Find or create customer in QB
  const qbCustomerId = await findOrCreateCustomer(token, realmId, customer, supabase);
  if (!qbCustomerId) throw new Error("Could not find or create QuickBooks customer");

  // 2. Resolve every QB item referenced by the payload (one per technique)
  const itemIdMap = await resolveItemIdMap(token, realmId, invoicePayload);

  // 3. Check QB customer's tax status
  let isTaxExempt = !!customer?.tax_exempt;
  try {
    const qbCustData = await qbQuery(token, realmId, `SELECT * FROM Customer WHERE Id = '${escapeQbStringLiteral(qbCustomerId)}'`);
    const qbCust = qbCustData?.QueryResponse?.Customer?.[0];
    if (qbCust?.Taxable === false) isTaxExempt = true;
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
  let qbInvoiceId: string = quote.qb_invoice_id || "";
  let qbInvoiceFinal: any;

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
      console.error(`[createInvoice] Could not fetch existing QB invoice ${qbInvoiceId}:`, (e as Error)?.message);
    }

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
          PrivateNote: `InkTracker Quote ${baseDocNumber} — updated ${new Date().toISOString().slice(0, 10)}`,
        };
        if (billEmail) {
          updateBody.BillEmail = { Address: billEmail };
        }
        if (billAddress) {
          updateBody.BillAddr = { Line1: billAddress };
          updateBody.ShipAddr = { Line1: billAddress };
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

  // Create new invoice if we don't have one yet (first sync or update failed)
  if (!qbInvoiceId) {
    const escapedBase = escapeQbStringLiteral(baseDocNumber);
    let existingDocs: string[] = [];
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
      PrivateNote: isRevision
        ? `InkTracker Quote ${baseDocNumber} — revision (${docNumber})`
        : `InkTracker Quote ${baseDocNumber}`,
    };

    if (billEmail) {
      invoiceBody.BillEmail = { Address: billEmail };
      invoiceBody.EmailStatus = "NeedToSend";
    }
    if (billAddress) {
      invoiceBody.BillAddr = { Line1: billAddress };
      invoiceBody.ShipAddr = { Line1: billAddress };
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
  // Compare what we sent vs what QB returned. Any line-amount drift
  // beyond a 1-cent rounding tolerance is logged loudly so it shows up
  // in the Supabase function logs. Tax drift alone is informational
  // (QB's tax setup is authoritative). Pure helper + tests live in
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

    // Push an in-app notification to the shop. This should never fire
    // on a clean integration — only if QB altered our data after we
    // sent it. Notification insert is best-effort: a failure here
    // must NOT cause the user-facing invoice send to error out.
    //
    // Uses a service-role client because the notifications table is
    // service-role-only on INSERT (the authenticated user is allowed
    // to read/update their own notifications, but not forge new ones).
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

  // Mint the customer-facing share link. QBO does NOT include the link in
  // the create response, a plain GET, or in ?include=invoiceLink on a
  // draft — the link only exists after the invoice runs through QBO's send
  // pipeline, which provisions the portal record (snapshotted at mint
  // time). mintInvoicePaymentLink wraps the full flow: /send with built-in
  // retries, then two refetches via GET ?include=invoiceLink to catch
  // async portal provisioning, then returns a structured reason so the
  // caller can show actionable guidance.
  const initialInvoice: any = qbInvoiceFinal || created;
  const linkResult = await mintInvoicePaymentLink(token, realmId, qbInvoiceId, billEmail, initialInvoice);
  const paymentLink = linkResult.link;
  const linkFailureReason = linkResult.reason;
  const invoiceForLink = linkResult.finalInvoice;

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
  if (quote.deposit_paid && depositAmount > 0) {
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

  // 5. Save QB invoice ID + DocNumber + payment link + final QB-computed
  // totals back to the source record. Both ids matter — the internal id
  // for API calls, the DocNumber for the operator-facing UI.
  if (quote.id) {
    // Try quotes table first (quote-originated invoices)
    await supabase.from("quotes").update({
      qb_invoice_id:   qbInvoiceId,
      qb_doc_number:   qbDocNumber,
      qb_payment_link: paymentLink,
      qb_synced_at:    new Date().toISOString(),
      qb_subtotal:     qbSubtotal,
      qb_tax_amount:   qbTaxAmount,
      qb_total:        qbTotal,
      status:          quote.status === "Draft" ? "Sent" : quote.status,
    }).eq("id", quote.id);

    // Also try invoices table (invoice-originated, same ID format)
    await supabase.from("invoices").update({
      qb_invoice_id:   qbInvoiceId,
      qb_doc_number:   qbDocNumber,
      qb_payment_link: paymentLink,
    }).eq("id", quote.id);
  }

  return {
    qbInvoiceId,
    qbDocNumber,
    isRevision: qbDocNumber !== baseDocNumber,
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
    qbSubtotal,
    qbTaxAmount,
    qbTotal,
    customerRef: qbCustomerId,
  };
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
    .select("id, qb_customer_id, email, name")
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

    // Check if already imported (by qb_customer_id or email)
    const existingByQb = byQbId.get(qbId);
    const existingByMail = email ? byEmail.get(email.toLowerCase()) : null;
    const match = existingByQb || existingByMail;

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

  // Build customer lookup: qb_customer_id → InkTracker customer
  const { data: customers } = await supabase
    .from("customers")
    .select("id, qb_customer_id, name")
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
  const { data: existingInvoices } = await supabase
    .from("invoices")
    .select("id, invoice_id, qb_invoice_id, customer_id, customer_name")
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

    // Map QB line items
    const lineItems = (qbInv.Line ?? [])
      .filter((l: any) => l.DetailType === "SalesItemLineDetail")
      .map((l: any) => ({
        id: `qb-${l.Id || Math.random().toString(36).slice(2)}`,
        style: l.Description || l.SalesItemLineDetail?.ItemRef?.name || "Item",
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
      const { error } = await supabase.from("invoices").update(payload).eq("id", existingId);
      if (error) { console.error("[pullInvoices] update failed:", error.message, docNumber); skipped++; }
      else { updated++; }
    } else {
      const { error } = await supabase.from("invoices").insert(payload);
      if (error) { console.error("[pullInvoices] insert failed:", error.message, docNumber); skipped++; }
      else { imported++; }
    }
  }

  return { imported, skipped, updated, total: all.length, truncatedAtCap };
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
  // server-side contract supports it).
  const amount = Number(params?.amount ?? qbBalance);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("recordPayment: amount must be a positive number");
  }

  const docLabel = row.qb_doc_number || `Id ${qbInvoiceId}`;
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
  };
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
      await updateProfileSecrets(
        adminClient,
        profile.id,
        {
          qb_access_token: null,
          qb_refresh_token: null,
          qb_realm_id: null,
          qb_token_expires_at: null,
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
        const idempOutcome = await withQbIdempotency(
          adminClient,
          idempKey,
          { shop_owner: quoteShop, action: "create_invoice" },
          () => withQbAudit(adminClient, auditCtx, () =>
            handleCreateInvoice(qbToken, realmId, params, supabase),
          ),
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
      default:
        return Response.json({ error: `Unknown action: ${action}` }, { status: 400, headers: CORS });
    }

    return Response.json({ success: true, ...result }, { headers: CORS });
  } catch (err) {
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
    return Response.json({ error: err.message }, { status: 500, headers: CORS });
  }
});
