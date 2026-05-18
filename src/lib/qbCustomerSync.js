import { base44, supabase } from "@/api/supabaseClient";

// Fire-and-forget: push a customer to QuickBooks (find-or-create).
// Returns { qbCustomerId } on success, or { skipped: true, reason } if the
// call couldn't run / failed. Never throws — the caller's save flow stays
// unblocked even when QB is misconfigured or offline.
//
// Goes through base44.functions.invoke so the Supabase Authorization
// header is included automatically. A previous raw fetch implementation
// was silently failing in prod (gateway returned UNAUTHORIZED_NO_AUTH_HEADER
// before the function ran), which meant new customers never got their
// qb_customer_id backfilled.
export async function syncCustomerToQB(customer) {
  if (!customer?.id) return { skipped: true, reason: "no customer id" };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return { skipped: true, reason: "not signed in" };

    const { data, error: invErr } = await base44.functions.invoke("qbSync", {
      action: "syncCustomer",
      accessToken: session.access_token,
      customer,
    });

    if (invErr) {
      console.warn("[QB] customer sync:", invErr.message);
      return { skipped: true, reason: invErr.message };
    }
    if (data?.error) {
      console.warn("[QB] customer sync:", data.error);
      return { skipped: true, reason: data.error };
    }
    return data;
  } catch (err) {
    console.warn("[QB] customer sync exception:", err?.message ?? err);
    return { skipped: true, reason: String(err?.message ?? err) };
  }
}
