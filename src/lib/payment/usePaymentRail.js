import { useEffect, useState } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import { isTestDocument } from "../../../supabase/functions/_shared/paymentRail.js";

// Which way this shop's customers pay: "qb" (the QuickBooks invoice link —
// every shop today) or "processor" (InkTracker's own payment page). Read from
// the `stripePayments` edge function's status action, which applies the platform
// kill switch + onboarding state server-side.
//
// Fails to "qb" on any error (function not deployed, signed out, network): the
// send screens then behave exactly as they always have. The server decides
// for real either way — qbSync reads the rail itself and never trusts this.

let _cache = null; // Promise<status> | null

const QB_STATUS = Object.freeze({ rail: "qb", platformEnabled: false, stage: "not_started", enabled: false });

export function fetchPaymentStatus({ fresh = false } = {}) {
  if (_cache && !fresh) return _cache;
  _cache = (async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return QB_STATUS;
    const { data, error } = await base44.functions.invoke("stripePayments", {
      action: "status",
      accessToken: session.access_token,
    });
    if (error || !data || data.error) throw new Error("status unavailable");
    return { ...QB_STATUS, ...data, rail: data.rail === "processor" ? "processor" : "qb" };
  })().catch(() => {
    // Don't cache a failure for the life of the tab: the next caller retries.
    // `unavailable` lets callers tell "couldn't ask" from "QuickBooks".
    _cache = null;
    return { ...QB_STATUS, unavailable: true };
  });
  return _cache;
}

export function resetPaymentStatus() {
  _cache = null;
}

/** @returns {{ rail: "qb"|"processor"|null, status: object|null }} rail is null while loading */
/**
 * The rail for ONE quote/invoice. In Stripe test mode only TEST/DEMO
 * documents use InkTracker payments (the server applies the same rule), so a
 * real customer never gets a test checkout.
 */
export function railForDocument(status, doc) {
  const rail = status?.rail === "processor" ? "processor" : "qb";
  if (rail === "processor" && status?.testMode && !isTestDocument(doc)) return "qb";
  return rail;
}

export function usePaymentRail() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let alive = true;
    fetchPaymentStatus().then((s) => { if (alive) setStatus(s); });
    return () => { alive = false; };
  }, []);
  return { rail: status ? status.rail : null, status };
}
