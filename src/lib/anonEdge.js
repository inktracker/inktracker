// One contract for reading an edge-invoke result on the ANONYMOUS pages
// (QuotePayment, OrderStatus, ArtApproval).
//
// supabase-js returns { data: null, error } on ANY non-2xx or network failure
// — it does not throw, and it does not populate data. Every anon page used to
// read only `res.data.*`, which had three customer-visible failure modes
// (audit 2026-09-30):
//   - a failed approve skipped both guards and rendered a false
//     "Quote approved successfully";
//   - `res.data.order` threw a TypeError whose raw message was rendered to
//     the customer ("Cannot read properties of null (reading 'order')");
//   - the server's hand-written 429/500 copy collapsed into
//     "Quote/Order Not Found".
//
// `error.message` here is ALREADY humanized — the global invoke patch in
// src/api/supabaseClient.js routes every edge error through describeEdgeError
// — so this helper never surfaces a raw/stack-shaped string.
//
// Returns { data, message }: `message` is non-null on any failure (infra OR
// handler { error }), and `data` is non-null only when the call truly
// succeeded. Callers must still check the specific field they need
// (e.g. data.quote) before declaring success.
export function anonEdgeResult(response, fallback = "Something went wrong. Please try again.") {
  if (response?.error) {
    return { data: null, message: response.error.message || fallback };
  }
  if (response?.data?.error) {
    return { data: null, message: String(response.data.error) };
  }
  if (!response?.data) {
    return { data: null, message: fallback };
  }
  return { data: response.data, message: null };
}
