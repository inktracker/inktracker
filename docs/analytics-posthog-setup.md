# Landing-page analytics — PostHog setup

How to go from "events are firing" to the live dashboard (traffic, clicks,
regions, conversion, drop-off) for the public landing page.

This is InkTracker's marketing/funnel data. It lives in the PostHog dashboard,
not inside the shop app.

---

## What the code already sends

Instrumented in `src/lib/analytics.js` + wired into the landing page. All of it
is gated behind the cookie-consent Accept (`hasNonEssentialConsent()`), and the
PostHog lib only loads after consent.

**Funnel events (in order):**

| Event | Fires when | Properties |
|-------|-----------|------------|
| `landing_viewed` | landing page mounts | — |
| `signup_opened` | any "start trial" CTA is clicked | `source`: `hero` \| `pricing` \| `footer_cta` \| `nav` \| `mobile_nav` |
| `signup_submitted` | the signup form is submitted | — |
| `trial_activated` | trial RPC succeeds (conversion) | identified by opaque auth id |

**Free from PostHog autocapture (no code):**
- `$pageview` / `$pageleave` — traffic, bounce, time-on-page
- `$autocapture` — every click (powers "where people click" + heatmaps)
- `$geoip_*` properties on every event — country, region/state, city

---

## 1. Deploy so real traffic is tracked

Two env vars, then ship the PR.

```bash
# add to Vercel production (or use the dashboard: Project → Settings → Env vars)
vercel env add VITE_POSTHOG_KEY production
#   value: phc_...   (Project API key from PostHog → Settings → Project → API keys)
vercel env add VITE_POSTHOG_HOST production
#   value: https://us.i.posthog.com
```

Then merge the analytics PR and deploy. Until `VITE_POSTHOG_KEY` is set in the
built environment, the tracking code is a complete no-op — safe to ship early.

Verify after deploy: open the live landing page, accept cookies, and watch
**PostHog → Activity** for `$pageview` + `landing_viewed` arriving.

---

## 2. Build the dashboard (one-time, ~10 min)

In PostHog, create these as saved Insights, then pin them to one dashboard
("InkTracker — Landing").

### a. Conversion funnel + drop-off  ← the headline

- New insight → **Funnel**
- Steps, in order: `landing_viewed` → `signup_opened` → `signup_submitted` → `trial_activated`
- Conversion window: **7 days** (a visitor can come back and convert later)
- This gives the overall visitor→trial conversion rate and the % lost at each step.

### b. Which CTA converts

- New insight → **Trends**
- Series: event `signup_opened`
- Breakdown by: event property **`source`**
- Shows hero vs pricing vs footer_cta etc. To see which one actually *converts*
  (not just opens), use a Funnel breakdown by `source` on steps `signup_opened`
  → `trial_activated`.

### c. Traffic over time

- New insight → **Trends**
- Series: `$pageview`, measured as **Unique users**, daily.
- Add a second series `landing_viewed` if you want landing-only vs whole-site.

### d. Top regions

- New insight → **Trends**
- Series: `$pageview` (Unique users)
- Breakdown by: **`$geoip_subdivision_1_name`** (US state/region)
- Swap to `$geoip_country_name` for country-level, `$geoip_city_name` for city.

### e. Where people click

- Autocapture is already on. Two ways to read it:
  - **Heatmaps:** install the PostHog Toolbar (Settings → Toolbar), open the live
    site while authed, toggle the heatmap — click density overlaid on the page.
  - **Insight:** Trends → `$autocapture`, breakdown by **element** (`$el_text` or
    autocapture element) to rank the most-clicked things.

### f. Pin them

Open each insight → **Add to dashboard** → "InkTracker — Landing". Set the
dashboard to auto-refresh (top-right). Done — this is the live view.

> Shortcut: PostHog's built-in **Web Analytics** product (left sidebar) gives
> traffic, top pages, referrers, countries, and devices out of the box with zero
> setup. Use it for the traffic/region questions and reserve the custom
> dashboard above for the funnel + CTA breakdown it can't do.

---

## Notes

- **No age/gender demographics.** Not collectable without Google Analytics +
  Google Signals; PostHog (and any first-party setup) can't derive them. Geo,
  device, referrer, clicks, and the funnel are all covered.
- **Consent:** declining cookies means zero tracking — the lib never loads. Data
  only reflects visitors who accepted.
- **Local testing:** set the same two vars in `.env.local`, `npm run dev`, accept
  cookies, and events flow to the same PostHog project (they'll show as one
  anonymous person).
