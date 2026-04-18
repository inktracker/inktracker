import { supabase } from "@/api/supabaseClient";

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/qbSync`;

export async function syncExpenseToQB(expense) {
  if (!expense?.id) return { skipped: true };

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return { skipped: true, reason: "not signed in" };

  const res = await fetch(FN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "syncExpense",
      accessToken: session.access_token,
      expense,
    }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error || `QB sync failed (${res.status})`);
  }
  return data;
}

export async function pullExpensesFromQB() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return { skipped: true, reason: "not signed in" };

  const res = await fetch(FN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "pullExpenses",
      accessToken: session.access_token,
    }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error || `QB pull failed (${res.status})`);
  }
  return data;
}

export async function syncExpensesBatch(expenses, onProgress) {
  let ok = 0;
  let failed = 0;
  for (let i = 0; i < expenses.length; i++) {
    try {
      await syncExpenseToQB(expenses[i]);
      ok += 1;
    } catch {
      failed += 1;
    }
    onProgress?.({ done: i + 1, total: expenses.length, ok, failed });
  }
  return { ok, failed };
}
