// Turn any Supabase edge-invoke failure into a real, user-actionable message.
//
// supabase-js returns a FunctionsHttpError on ANY non-2xx whose `.message` is
// the useless "Edge Function returned a non-2xx status code". The function's
// real reason ({ error: "..." }) lives in the unread Response on `.context`.
// Showing the raw `.message` to a user is the "no solution but to email the
// founder" class of bug — this unwraps it and maps the common infra failures
// to plain, next-step guidance.
//
// Async because reading the Response body is async. Reads the body ONCE
// (consuming it) — callers should not also read `.context` afterward.

const NETWORK_RE = /failed to fetch|networkerror|load failed|network request failed/i;
const AUTH_RE = /\bjwt\b|token|not signed in|unauthorized|no authorization/i;

export async function describeEdgeError(err, fallback = "Something went wrong. Please try again.") {
  if (!err) return fallback;

  let bodyMsg = "";
  let status = Number(err.status) || 0;

  // `.context` is the Response (supabase-js v2). Some older shapes nest it at
  // `.context.response`. Read the body as text and try JSON — covers both the
  // { error } contract and a plain-text 500.
  const ctx0 = err.context?.response ?? err.context;
  // Clone before reading so the ORIGINAL Response body stays unconsumed —
  // the global invoke patch (supabaseClient.js) calls this on every edge
  // error, and callers that unwrap `.context` themselves (QB invoice create,
  // quote/invoice send) must still be able to read it.
  const ctx = ctx0 && typeof ctx0.clone === "function" ? ctx0.clone() : ctx0;
  if (ctx && typeof ctx.text === "function") {
    status = Number(ctx0.status) || status;
    try {
      const raw = await ctx.text();
      try {
        const parsed = JSON.parse(raw);
        bodyMsg = parsed?.error || parsed?.message || "";
      } catch {
        bodyMsg = (raw || "").trim().slice(0, 300);
      }
    } catch { /* body already consumed / unreadable — fall through */ }
  }

  // Session expired (the most common real-world case): the invoke went out
  // with a stale/absent token. Tell them exactly how to recover.
  if (status === 401 || status === 403 || AUTH_RE.test(bodyMsg)) {
    return "Your session expired. Refresh the page and sign in again, then try that once more.";
  }

  // Couldn't even reach the server.
  if (!status && NETWORK_RE.test(err.message || "")) {
    return "Couldn't reach the server. Check your internet connection and try again.";
  }

  // Server error — prefer the function's own message if it gave one.
  if (status >= 500) {
    return bodyMsg || "Something went wrong on our end. Please try again in a moment — if it keeps happening, contact support.";
  }

  // Anything else: the real body message, else the raw message, else fallback.
  // Never return the opaque generic string.
  if (bodyMsg) return bodyMsg;
  const m = err.message || "";
  if (m && !/non-2xx status code/i.test(m)) return m;
  return fallback;
}
