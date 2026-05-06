// Shared FedEx API helpers.
// FedEx REST API — OAuth2 client credentials + shipment/rate/track endpoints.
// Base URL: https://apis.fedex.com (production) or https://apis-sandbox.fedex.com (sandbox)

export const FEDEX_BASE = Deno.env.get("FEDEX_API_URL") || "https://apis.fedex.com";
export const FETCH_TIMEOUT_MS = 30_000;

const FEDEX_CLIENT_ID = Deno.env.get("FEDEX_CLIENT_ID") ?? "";
const FEDEX_CLIENT_SECRET = Deno.env.get("FEDEX_CLIENT_SECRET") ?? "";
export const FEDEX_ACCOUNT_NUMBER = Deno.env.get("FEDEX_ACCOUNT_NUMBER") ?? "";

// Shipper (return) address from env vars
export const SHIPPER_ADDRESS = {
  streetLines: [Deno.env.get("FEDEX_SHIPPER_STREET") ?? ""],
  city: Deno.env.get("FEDEX_SHIPPER_CITY") ?? "",
  stateOrProvinceCode: Deno.env.get("FEDEX_SHIPPER_STATE") ?? "",
  postalCode: Deno.env.get("FEDEX_SHIPPER_ZIP") ?? "",
  countryCode: Deno.env.get("FEDEX_SHIPPER_COUNTRY") ?? "US",
};

export const SHIPPER_CONTACT = {
  personName: Deno.env.get("FEDEX_SHIPPER_NAME") ?? "",
  phoneNumber: Deno.env.get("FEDEX_SHIPPER_PHONE") ?? "",
  companyName: Deno.env.get("FEDEX_SHIPPER_COMPANY") ?? "",
};

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// --- OAuth2 token cache -------------------------------------------------------

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getFedExToken(force = false): Promise<string | null> {
  if (!FEDEX_CLIENT_ID || !FEDEX_CLIENT_SECRET) return null;
  if (!force && cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  try {
    const res = await fetch(`${FEDEX_BASE}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: FEDEX_CLIENT_ID,
        client_secret: FEDEX_CLIENT_SECRET,
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    const text = await res.text();
    console.error(`[fedex-auth] POST /oauth/token → ${res.status} (${text.length} chars)`);

    let data: any;
    try { data = JSON.parse(text); } catch { data = text; }

    if (!res.ok) {
      console.error(`[fedex-auth] error body: ${String(text).slice(0, 300)}`);
      return null;
    }

    const token = data?.access_token;
    if (!token) return null;

    const expiresIn = (data?.expires_in || 3600) * 1000;
    // Refresh 5 minutes early
    cachedToken = { token, expiresAt: Date.now() + expiresIn - 300_000 };
    return cachedToken.token;
  } catch (err) {
    console.error(`[fedex-auth] token fetch failed: ${(err as Error).message}`);
    return null;
  }
}

// --- Fetch wrapper ------------------------------------------------------------

export type FedExFetchResult = { ok: boolean; status: number; data: any };

export async function fedexFetch(
  url: string,
  init: RequestInit = {},
  ctx = "fedex",
): Promise<FedExFetchResult> {
  let status = 0;
  try {
    const token = await getFedExToken();
    if (!token) {
      return { ok: false, status: 0, data: { error: "FedEx authentication failed" } };
    }

    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    status = res.status;
    const text = await res.text();
    console.error(`[${ctx}] ${init.method ?? "GET"} ${url} → ${status} (${text.length} chars)`);

    let data: any;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }

    if (!res.ok) {
      console.error(`[${ctx}] error body: ${String(text).slice(0, 300)}`);
      return { ok: false, status, data };
    }
    return { ok: true, status, data };
  } catch (err) {
    console.error(`[${ctx}] fetch exception (${url}): ${(err as Error).message}`);
    return { ok: false, status, data: { error: (err as Error).message } };
  }
}
