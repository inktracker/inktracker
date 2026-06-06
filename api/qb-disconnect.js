// QuickBooks "Disconnect URL" landing endpoint.
//
// Intuit calls this URL via the user's browser when they revoke
// InkTracker from the QuickBooks side (Apps → InkTracker → Disconnect
// in QuickBooks Online). It is NOT a server-to-server webhook —
// Intuit just redirects the user here so we can show a friendly page
// instead of leaving them on Intuit's "you've disconnected" screen.
//
// Token revocation:
//   - On Intuit's side, the refresh token is invalidated automatically
//     by their disconnect flow before they redirect here.
//   - On our side, the user's qb_access_token / qb_refresh_token rows
//     in profile_secrets become stale (Intuit will refuse them on the
//     next refresh attempt). They get cleared the next time the user
//     opens Account → QuickBooks → Disconnect, OR automatically by
//     the next failed token refresh in qbSync (which throws
//     UserFacingError QB_DISCONNECTED).
//
// The query string Intuit appends is implementation-defined and has
// historically included `realmId`. We accept and log it but do not
// trust it for any privileged operation — the browser is anonymous
// from our perspective. Real cleanup of local tokens happens through
// the authenticated flow once the user lands on /Account.
//
// Configured at: developer.intuit.com → InkTracker app → Keys & OAuth →
// Disconnect URL = https://inktracker.app/api/qb-disconnect

export default async function handler(req, res) {
  // Intuit uses GET. Any other method is an exploration scan; refuse loudly.
  if (req.method !== "GET") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  // Log whatever Intuit sent so we can correlate disconnects with the
  // shop in Vercel logs if a customer reports something unexpected.
  const realmId = req.query?.realmId || "";
  console.log(
    `[qb-disconnect] inbound disconnect redirect from Intuit. realmId=${realmId || "(none)"}`,
  );

  const appUrl = (process.env.VITE_APP_URL || "https://www.inktracker.app").replace(/\/+$/, "");
  res.redirect(302, `${appUrl}/Account?qb_disconnected_remotely=1`);
}
