import { supabase } from "@/api/supabaseClient";

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/qbSync`;

// Fire-and-forget: push a customer to QuickBooks (find-or-create).
// Returns { qbCustomerId } on success, or { skipped: true } if no auth/QB.
// Never throws to the caller — errors are logged so the save flow isn't blocked.
export async function syncCustomerToQB(customer) {
  if (!customer?.id) return { skipped: true, reason: "no customer id" };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return { skipped: true, reason: "not signed in" };

    const res = await fetch(FN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "syncCustomer",
        accessToken: session.access_token,
        customer,
      }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      console.warn("[QB] customer sync:", data.error || res.status);
      return { skipped: true, reason: data.error || "sync failed" };
    }
    return data;
  } catch (err) {
    console.warn("[QB] customer sync exception:", err?.message ?? err);
    return { skipped: true, reason: String(err?.message ?? err) };
  }
}
