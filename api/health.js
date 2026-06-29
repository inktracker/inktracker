// Lightweight health endpoint for synthetic/uptime monitoring (audit OPS-04).
//
// GET /api/health → 200 { status: "ok", supabase: "up", ts } when the
// frontend host AND Supabase are reachable; 503 when Supabase can't be reached.
// No secrets, no auth — safe to hit from any external monitor (UptimeRobot,
// the uptime GitHub Action, a status page). Does NOT touch tenant data: it
// pings the Supabase REST root with the public anon key only.

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.status(405).json({ status: "error", error: "method not allowed" });
    return;
  }

  const url = process.env.VITE_SUPABASE_URL;
  const anon = process.env.VITE_SUPABASE_ANON_KEY;
  const ts = new Date().toISOString();

  // Frontend host is obviously up (we're answering). Check Supabase reachability
  // as the meaningful dependency. If the env isn't wired, report degraded
  // rather than falsely healthy.
  if (!url || !anon) {
    res.status(503).json({ status: "degraded", supabase: "unconfigured", ts });
    return;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    // GoTrue's liveness endpoint — public-with-apikey, returns 200 when the
    // Supabase platform is up. (The PostgREST root requires a session and 401s.)
    const r = await fetch(`${url}/auth/v1/health`, {
      method: "GET",
      headers: { apikey: anon },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (r.ok || r.status === 200) {
      res.status(200).json({ status: "ok", supabase: "up", ts });
    } else {
      res.status(503).json({ status: "degraded", supabase: `http_${r.status}`, ts });
    }
  } catch (err) {
    res.status(503).json({ status: "degraded", supabase: "unreachable", error: String(err?.name || err), ts });
  }
}
