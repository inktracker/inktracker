import { useEffect, useState } from "react";
import { base44, supabase } from "@/api/supabaseClient";

// Which suppliers this shop has connected, as booleans — read from the
// profileSecrets edge function's getFlags action (the frontend can't read the
// raw secrets from the service-role-only profile_secrets table). Used to nudge
// a shop to connect its own supplier account BEFORE it tries to place an order
// that would otherwise be refused server-side.
//
// Readiness is per-supplier and specifically about ORDER PLACEMENT:
//   - S&S    → account number + API key (ssPlaceOrder bills this account)
//   - AS Colour → subscription key + account email + password (all three; the
//                 order path mints a Bearer token from email/password)
//   - SanMar → customer number + username + password
//
// Cached at module scope so multiple banners (PO page + inventory cart) share
// one fetch. Fail-open: on any error the flags are all false, so the nudge
// shows rather than hiding a real gap — and the server stays the true gate.

let _cache = null; // Promise<flags> | null

function fetchFlags() {
  if (_cache) return _cache;
  _cache = (async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return {};
    const { data, error } = await base44.functions.invoke("profileSecrets", {
      action: "getFlags",
      accessToken: session.access_token,
    });
    if (error || !data) return {};
    return data;
  })().catch(() => ({}));
  return _cache;
}

// Force the next read to re-fetch (call after saving supplier creds).
export function resetSupplierFlags() {
  _cache = null;
}

const SUPPLIER_READY = {
  "S&S Activewear": (f) => Boolean(f.ss),
  "AS Colour": (f) => Boolean(f.ac && f.ac_password && f.ac_email),
  SanMar: (f) => Boolean(f.sanmar),
};

export function useSupplierFlags() {
  const [flags, setFlags] = useState(null); // null = loading

  useEffect(() => {
    let alive = true;
    fetchFlags().then((f) => { if (alive) setFlags(f || {}); });
    return () => { alive = false; };
  }, []);

  return {
    flags,
    loading: flags === null,
    // undefined while loading (don't flash a nudge before we know); boolean after.
    isConnected: (supplier) => {
      if (flags === null) return undefined;
      const check = SUPPLIER_READY[supplier];
      return check ? check(flags) : true; // unknown supplier → don't nag
    },
  };
}
