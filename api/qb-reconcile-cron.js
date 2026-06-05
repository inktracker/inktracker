// Vercel cron entry point for nightly QB reconciliation.
//
// The cron is configured in vercel.json. It hits this URL with
// Authorization: Bearer ${CRON_SECRET}. We validate the secret, then
// forward to the Supabase edge function qbReconcile (also gated by
// the same secret) so the secret stays on the server side and is
// never exposed to a browser.
//
// Why the proxy: Vercel's cron HTTP request can't authenticate to
// Supabase directly (no Authorization gateway pass-through), and the
// edge function itself runs under verify_jwt=false but needs to know
// the request actually came from our cron and not from a public
// scanner. CRON_SECRET solves both: Vercel adds it to the cron HTTP
// request (per their cron docs), and the edge function checks the
// same env var.

export default async function handler(req, res) {
  // Vercel's cron uses GET. Reject everything else loud.
  if (req.method !== "GET") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const cronSecret = process.env.CRON_SECRET;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  if (!cronSecret || !supabaseUrl) {
    res.status(500).json({ error: "server misconfigured: CRON_SECRET or VITE_SUPABASE_URL not set" });
    return;
  }

  // The Authorization header on a Vercel cron is set to Bearer <CRON_SECRET>
  // automatically when the env var is configured. Verifying it here
  // prevents the cron URL from being hit by anyone who guesses it.
  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const upstreamUrl = `${supabaseUrl}/functions/v1/qbReconcile`;
  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${cronSecret}`,
        "Content-Type":  "application/json",
      },
      body: "{}",
    });
  } catch (err) {
    console.error("[qb-reconcile-cron] upstream fetch failed:", err);
    res.status(502).json({ error: "upstream unreachable" });
    return;
  }

  // Surface whatever the edge function returned so it lands in
  // Vercel cron logs (sortable in the dashboard "Crons" tab).
  const bodyText = await upstream.text().catch(() => "");
  res.status(upstream.status);
  try {
    res.json(JSON.parse(bodyText || "{}"));
  } catch {
    res.send(bodyText || "");
  }
}
