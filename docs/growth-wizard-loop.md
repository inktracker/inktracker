# InkTracker Growth — The Quote-Wizard Loop (your #1 free channel)

**Why this one first (bootstrapped, solo, niche):** every quote and art-approval page your shops send lands in front of *their* customers — and a chunk of those customers are other print shops, brokers, decorators, and shop-curious people. A small, tasteful "made with InkTracker" mark on those pages turns every active shop into a billboard aimed at exactly the audience you want. It costs $0, needs zero ongoing effort once shipped, and it **compounds**: more shops → more quotes sent → more impressions → more shops. No ad channel does that.

The catch: it starts slow (you need shops actively sending quotes — you have ~10, so it's already turning). Treat it as the compounding foundation, and pair it with the two fast-start moves at the end.

---

## 1. Where the branding goes (your existing public surfaces)
These are the pages/emails a shop's customer already sees — add the mark to each:
- **The public quote page** (`QuotePayment.jsx` / customer-facing quote view)
- **The art-approval page** (`ArtApproval.jsx`)
- **The public quote request/wizard** (`QuoteRequest.jsx`) — footer
- **The emailed quote + the quote PDF** (via `sendQuoteEmail` / `pdfExport.jsx`) — a one-line footer

Keep it **small and classy** — a footer line, not a banner. It should read as a quiet credit, never as an ad interrupting the shop's own customer. That respect is what keeps shops from wanting it gone.

## 2. The mark (copy — pick one, keep it consistent)
- Primary (footer link): **"Quotes & production run on InkTracker — software built by printers, for printers. → inktracker.app"**
- Shorter: **"Made with InkTracker — print shop software. inktracker.app"**
- Email/PDF one-liner: **"This quote was created with InkTracker (inktracker.app), print-shop software by printers, for printers."**

Link target: **`https://inktracker.app/made-with-inktracker?ref=quote`** (a purpose-built quote-loop page — see §4 — NOT the generic homepage, and NOT `/for-printers`, which is now the general product page), with a UTM so you can measure it: `?ref=quote&utm_source=quote_page&utm_medium=plg&utm_campaign=wizard_loop`.

## 3. Attribution (so you know it's working)
- Tag the link with `ref=quote`.
- On signup, capture and store the `ref`/UTM (persist it from the landing page through to `handle_new_user`, or at minimum log it) so you can count "signups that came from a quote page."
- Success metric: **signups tagged `ref=quote` per month**, and impressions (public quote/approval page views) as the leading indicator.

## 4. The destination page: `/made-with-inktracker` (this is what converts)
Do NOT point the mark at your homepage. Point it at a page written for the exact person clicking it: *a printer (or shop-adjacent person) who just saw a slick quote and wondered what made it.* This page is built and live (noindex, quote-loop copy). It is deliberately separate from `/for-printers` (the general, indexable product page) so the "that quote was made in InkTracker" framing only shows to people who actually got a quote. Copy, in your voice:

> **Headline:** "That quote was made in InkTracker."
> **Sub:** "The shop that sent it runs quotes, production, and invoicing in one place — software built by a printer, for printers. If you're still living in spreadsheets and sticky notes, come see why they switched."
> **3 proof bullets:** "Quote in minutes, not a spreadsheet." · "Production board your whole shop can see." · "Invoices + QuickBooks, no double entry."
> **CTA:** "Start your 14-day free trial — no card to look." *(matches your trial)*
> **Trust line:** "Made by a working print shop. We use it every day."

Keep it one screen, one CTA, a screenshot of the quote/production view, done.

## 5. Guardrails / product notes
- **Tasteful > loud.** One line, muted styling. If it ever feels like it's competing with the shop's brand, it's too big.
- **Future upsell lever:** "Remove InkTracker branding from customer pages" is a classic paid add-on. You're single-tier $99 today, so ship the branding ON for everyone now; if you ever add tiers, "white-label the quote pages" is an easy upgrade reason. (Don't build the toggle yet — just know it's there.)
- **Don't gate it behind trial/paid** — you *want* even trial shops spreading it.

## 6. Drop-in implementation prompt (hand to your terminal agent)
```
Add a tasteful "made with InkTracker" footer mark to the customer-facing public surfaces, as the product-led growth loop in docs/growth-wizard-loop.md.
- Branch feat/plg-wizard-loop, keep npm test green, don't deploy.
- Add a small shared component <PoweredByInkTracker/> (a muted footer line + link to https://inktracker.app/made-with-inktracker?ref=quote&utm_source=quote_page&utm_medium=plg&utm_campaign=wizard_loop, target=_blank rel=noopener).
- Render it at the bottom of: QuotePayment.jsx, ArtApproval.jsx, QuoteRequest.jsx (public wizard), and add the one-line text version to the emailed quote (sendQuoteEmail) and the quote PDF footer (pdfExport.jsx).
- Do NOT show it on authenticated in-app dashboards — customer-facing pages only.
- Persist an incoming ?ref / utm_* on the signup landing so handle_new_user (or the profile) records signup source; if that's too invasive, at minimum store it in localStorage and include it on the trial-activation call.
- Add a light test that the mark renders on the public pages and links to the ref-tagged URL.
Report files changed + where the mark appears.
```
(The `/made-with-inktracker` page with the §4 copy is already built and live in the static content pipeline, alongside `/for-printers` and `/compare`. This prompt only needs to add the footer mark + attribution.)

---

## Do these two THIS WEEK for signups now (the wizard loop is slow to start)
1. **One authentic community post.** In the biggest screen-printing Facebook group (or r/screenprinting), post as what you are — a printer who got sick of the tools and built his own. Show a real screenshot. Ask for feedback, not sales. Format: "I run a shop and hated [Printavo/spreadsheets] for X, so I built the thing I wanted. Here's how we quote/schedule now — happy to share it / would love feedback." Printers reward builders; they punish ad-speak.
2. **Ten founder DMs/emails.** List 10 shops you know or admire. Personal note: "I built print-shop software for my own shop — quotes/production/invoicing in one place. I'll set you up myself and you keep it free through the trial. Want a look?" The first ~50 customers of a niche B2B tool come from the founder doing this by hand.

Want me to build the **community launch kit** (the actual posts, tuned to each community's rules and your voice) and the **10 outreach templates** next? Those are the fast-return complement to the loop above.
