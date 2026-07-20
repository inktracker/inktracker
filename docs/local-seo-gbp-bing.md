# InkTracker — Google Business Profile + Bing setup (self-serve)

Two quick, free setups that add trust/entity signals and a second search engine. Both are yours to do (they need your business identity and verification).

---

## 1. Google Business Profile (GBP)

Why it matters beyond local: a verified GBP makes Google treat InkTracker/your shop as a **real, trusted business entity** — that helps your whole domain, not just local searches. It also ranks you for "screen printing Reno"-type searches and shows a map/knowledge panel with your link, hours, and reviews.

**Setup:**
1. Go to **google.com/business** → Sign in with the account that should own it.
2. Create a profile for your shop (use your real business name — Biota Mfg / your DBA — consistently with how it appears elsewhere).
3. **Category:** primary = "Screen printing shop" (or "Print shop"); add secondary categories like "Embroidery service," "Promotional products supplier."
4. **Address:** your real shop address (you can hide it and set a service area if you don't want walk-ins).
5. **Website:** `https://inktracker.app` (the non-www canonical) — or your shop's own site if separate.
6. **Phone, hours, service area.**
7. **Verify** — Google mails a postcard code or offers phone/video verification. Complete it; the profile isn't live until verified.
8. Add **photos** (your shop + product shots — you have the B-roll stills), a description, and services.

**After it's live:** ask happy local customers to leave Google reviews (same rules as directory reviews — real customers, no incentives). Google reviews feed both local ranking and trust.

**One caution:** keep your **NAP (Name, Address, Phone) identical** everywhere — GBP, Capterra/G2, your site footer, Bing. Inconsistent NAP confuses Google and weakens the entity signal.

---

## 2. Bing Webmaster Tools

Bing powers ~5–10% of US search plus ChatGPT/Copilot web results, and it's easy — you already ship an IndexNow key, so you're half done.

**Setup:**
1. Go to **bing.com/webmasters** → sign in.
2. **Add site** `https://inktracker.app`. Fastest path: **Import from Google Search Console** (one click, pulls your verified property + sitemap). Otherwise verify via DNS or meta tag.
3. **Submit the sitemap:** `https://inktracker.app/sitemap.xml` under Sitemaps.
4. Confirm **IndexNow** is connected (your repo ships the key file for Bing/Naver/Seznam — Bing Webmaster shows IndexNow submissions once it picks up the key).
5. Check the **SEO Reports** and **Site Explorer** for any crawl issues.

That's it — now Bing/Copilot can index and surface you too, and your IndexNow pings tell Bing about new pages instantly.

---

## Do-this-week checklist
- [ ] Create + verify Google Business Profile (real NAP, category "Screen printing shop", site = inktracker.app).
- [ ] Add photos + description to GBP; ask 2–3 local customers for Google reviews.
- [ ] Add InkTracker to Bing Webmaster Tools (import from Search Console) + submit sitemap.
- [ ] Make sure your business Name/Address/Phone reads identically across GBP, Bing, Capterra/G2, and your site footer.
