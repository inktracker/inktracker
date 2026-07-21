# Fix: make non-www the canonical served domain

**Problem:** Every canonical tag, OG/Twitter URL, schema `url`/`@id`, `sitemap.xml`, and `robots.txt` on InkTracker uses the **non-www** origin `https://inktracker.app`. But the live site **redirects `inktracker.app` → `www.inktracker.app`**. So Google is handed a canonical URL that immediately 3xx-redirects, and www vs non-www can split ranking signals. Everything in code already points to non-www, so the clean fix is to **serve at non-www** and make www redirect to it (not the other way around).

## Option A — Vercel dashboard (recommended, no deploy) — Joe does this
1. Vercel → the InkTracker project → **Settings → Domains**.
2. Find `inktracker.app` and `www.inktracker.app`.
3. Set **`inktracker.app` (non-www) as the Primary Domain**. Vercel will then 308-redirect `www.inktracker.app` → `inktracker.app` automatically.
4. Done. Every served URL now matches the canonicals you already emit.

## Option B — enforce in code (if you'd rather do it via the repo)
For a terminal agent: add a host redirect to `vercel.json` so `www` → apex, branch `fix/canonical-nonwww`, keep `npm test` green, don't deploy to prod without review.

```json
{
  "redirects": [
    {
      "source": "/:path*",
      "has": [{ "type": "host", "value": "www.inktracker.app" }],
      "destination": "https://inktracker.app/:path*",
      "permanent": true
    }
  ]
}
```
(Merge into the existing `redirects` array — don't drop the current `*.vercel.app` rule.)

## Verify after the change
- `curl -sI https://www.inktracker.app/` shows `301/308` → `https://inktracker.app/`.
- `curl -sI https://inktracker.app/` returns `200` (no redirect).
- `https://inktracker.app/sitemap.xml` returns `200` directly (no redirect) — this should clear the "Couldn't fetch" state in Search Console.
- Re-request indexing of the homepage in Search Console (URL Inspection → Request Indexing).

Small change, but it removes an ambiguity Google otherwise has to resolve on every page — worth doing before you pour effort into backlinks.
