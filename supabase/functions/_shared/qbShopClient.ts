// Minimal QuickBooks client for server-side work on a shop's behalf
// (payments: read the live invoice, post a Payment/Deposit, list accounts).
//
// Token refresh goes through the SHARED DB lease lock (refreshQbTokenSerialized)
// — never refresh Intuit tokens outside it, or a concurrent qbSync/qbReconcile
// rotation gets clobbered and the shop's QuickBooks "randomly disconnects".

import { loadProfileWithSecrets, updateProfileSecrets } from "./profileSecrets.ts";
import { refreshQbTokenSerialized } from "./qbTokenLock.js";
import { decideTokenRefresh, buildRefreshedTokenFields } from "./connectionLogic.js";
import { escapeQbStringLiteral } from "./qbInvoice.js";

const QB_BASE = "https://quickbooks.api.intuit.com/v3/company";
const MINOR = "minorversion=75";

async function refreshQbToken(refreshTok: string) {
  const id = Deno.env.get("QB_CLIENT_ID") ?? "";
  const secret = Deno.env.get("QB_CLIENT_SECRET") ?? "";
  const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshTok }),
  });
  if (!res.ok) throw new Error(`QuickBooks connection expired (refresh ${res.status}). Reconnect in Account settings.`);
  return res.json();
}

export type QbConn = { token: string; realmId: string };

// deno-lint-ignore no-explicit-any
export async function getShopQb(admin: any, shopOwnerEmail: string): Promise<QbConn | null> {
  const profile = await loadProfileWithSecrets(admin, { email: shopOwnerEmail });
  if (!profile?.qb_access_token || !profile?.qb_realm_id) return null;
  const fresh = await refreshQbTokenSerialized(admin, profile, {
    decideRefresh: decideTokenRefresh,
    refreshFn: refreshQbToken,
    buildFields: buildRefreshedTokenFields,
    // deno-lint-ignore no-explicit-any
    persist: (id: string, fields: any) => updateProfileSecrets(admin, id, fields),
    reload: (id: string) => loadProfileWithSecrets(admin, { id }),
  });
  const token = fresh?.accessToken;
  const realmId = fresh?.realmId ?? profile.qb_realm_id;
  return token && realmId ? { token, realmId } : null;
}

// deno-lint-ignore no-explicit-any
export async function qbQuery(conn: QbConn, sql: string): Promise<any> {
  const res = await fetch(
    `${QB_BASE}/${conn.realmId}/query?${MINOR}&query=${encodeURIComponent(sql)}`,
    { headers: { Authorization: `Bearer ${conn.token}`, Accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`QuickBooks query failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// deno-lint-ignore no-explicit-any
export async function qbPost(conn: QbConn, entity: string, body: unknown): Promise<any> {
  const res = await fetch(`${QB_BASE}/${conn.realmId}/${entity}?${MINOR}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${conn.token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = new Error(`QuickBooks ${entity} create failed (${res.status}): ${(await res.text()).slice(0, 500)}`);
    // Callers need the status to tell "definitely rejected" (4xx) from
    // "may have been created" (5xx, gateway timeouts).
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return res.json();
}

// deno-lint-ignore no-explicit-any
export async function qbGetInvoice(conn: QbConn, invoiceId: string): Promise<any | null> {
  const j = await qbQuery(conn, `SELECT * FROM Invoice WHERE Id = '${escapeQbStringLiteral(String(invoiceId))}'`);
  return j?.QueryResponse?.Invoice?.[0] ?? null;
}

// deno-lint-ignore no-explicit-any
export async function qbListAccounts(conn: QbConn): Promise<any[]> {
  const j = await qbQuery(conn, "SELECT Id, Name, FullyQualifiedName, AccountType, Active FROM Account MAXRESULTS 1000");
  return j?.QueryResponse?.Account ?? [];
}

// deno-lint-ignore no-explicit-any
export async function qbListPaymentMethods(conn: QbConn): Promise<any[]> {
  const j = await qbQuery(conn, "SELECT * FROM PaymentMethod MAXRESULTS 200");
  return j?.QueryResponse?.PaymentMethod ?? [];
}

/**
 * A customer's most recent QB Payments (dedupe before posting). Filters on
 * CustomerRef — the same query qbSync's deposit settlement uses in
 * production — and the caller matches the payin with findBookedPayment.
 */
// deno-lint-ignore no-explicit-any
export async function qbRecentCustomerPayments(conn: QbConn, customerRef: string): Promise<any[]> {
  const j = await qbQuery(conn, `SELECT * FROM Payment WHERE CustomerRef = '${escapeQbStringLiteral(String(customerRef))}' ORDERBY MetaData.CreateTime DESC MAXRESULTS 200`);
  return j?.QueryResponse?.Payment ?? [];
}
