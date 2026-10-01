import { base44, supabase } from "@/api/supabaseClient";

// Calls the artProof edge function (send / override) as the signed-in user.
// Throws an Error with the server's plain-language message on failure.
export async function callArtProof(action, extra) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Your session expired. Refresh the page and sign in again.");
  const { data, error } = await base44.functions.invoke("artProof", { action, accessToken: session.access_token, ...extra });
  if (error) throw new Error(error.message || "Request failed");
  if (data?.error) throw new Error(data.error);
  return data;
}
