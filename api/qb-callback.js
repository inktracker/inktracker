// QuickBooks OAuth callback proxy.
//
// Intuit redirects the user's browser to this URL after they
// authorize InkTracker on the QB consent screen. The actual token
// exchange + DB write happens in the Supabase edge function
// `qbOAuthCallback`. We can't redirect Intuit straight at the
// Supabase function URL because the Supabase Functions gateway
// rejects requests without an Authorization header (even when the
// function itself has verify_jwt = false), and Intuit's redirect
// can't include one.
//
// This proxy receives Intuit's redirect, injects the anon JWT as
// the Authorization header, and forwards the request to Supabase.
// The Supabase function does its job and returns a 3xx redirect
// pointing the user back into the app; we pass that redirect
// through to the browser.
//
// Vercel auto-detects files in api/ as serverless functions for
// any framework — no separate config needed.

export default async function handler(req, res) {
  // Intuit always uses GET for the redirect. Anything else is a bug
  // or an exploration scan — reject early.
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    // Hard fail loud — without these the proxy can't reach Supabase.
    res.status(500).json({ error: "Server misconfigured: missing Supabase env" });
    return;
  }

  // Pass every query param through verbatim — Intuit sends code,
  // state, realmId on success and error/error_description on
  // failure. The edge function's existing handler reads all of them.
  const params = new URLSearchParams(req.query).toString();
  const upstreamUrl = `${supabaseUrl}/functions/v1/qbOAuthCallback${params ? `?${params}` : ""}`;

  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${anonKey}`,
        "apikey": anonKey,
      },
      // Don't auto-follow — we want to surface the 3xx so we can
      // forward the Location header to the user's browser.
      redirect: "manual",
    });
  } catch (err) {
    console.error("[qb-callback proxy] fetch failed:", err);
    res.status(502).json({ error: "Upstream unreachable" });
    return;
  }

  // The Supabase function returns Response.redirect(...) on both
  // success and known error paths — pass that through.
  if (upstream.status >= 300 && upstream.status < 400) {
    const location = upstream.headers.get("location");
    if (location) {
      res.redirect(upstream.status, location);
      return;
    }
  }

  // Unexpected response (function 500'd, gateway rejected, etc).
  // Surface the body so it's visible in Vercel logs + browser.
  const text = await upstream.text().catch(() => "");
  res.status(upstream.status).send(text || "QB OAuth proxy: unexpected upstream response");
}
