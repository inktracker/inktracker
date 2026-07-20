# Build a free "/tools" hub + a Screen Printing Price Calculator page

Create two crawlable static pages: a **tools hub** at `/tools/` ("Free tools for print shops") and the first tool, a **Screen Printing Price Calculator** at `/tools/screen-printing-price-calculator`. The hub is built to grow — more calculators/tools get added as cards later. Reuse the calculator logic already in the blog post `build-a-screen-printing-price-chart` (the `chartCalc` function in `scripts/generate-blog.mjs`) — do NOT copy/duplicate it; import/share the one source so they never drift. Branch `feat/free-tools`, keep `npm test` green, do NOT deploy/merge. Rebuild via `npm run build:content` and give me both preview URLs.

## Why this page
"Screen printing price calculator" is a real, recurring, low-competition search with high intent (a printer figuring out what to charge). A useful free tool earns backlinks and community shares (r/screenprinting, FB groups) that a normal marketing page never will, and it's a natural top-of-funnel into InkTracker.

## Tools hub page (`/tools/`)
- Rendered HTML at `public/tools/index.html`, same static-content pipeline, committed, `vercel.json` rewrite.
- Content: a short intro ("Free tools for print shops — built by a printer, no signup") and a **grid of tool cards**. Card = title, one-line description, link. Structure it so adding a tool later is one array entry (mirror how blog posts are listed) — don't hardcode a single card.
- First card: **Screen Printing Price Calculator** → `/tools/screen-printing-price-calculator`. Leave the structure ready for future tools (embroidery pricing, setup-fee calculator, etc.).
- SEO: `<title>` "Free Tools for Print Shops", meta description, canonical `https://inktracker.app/tools/`, `BreadcrumbList` JSON-LD, add `/tools/` to `sitemap.xml`.
- Soft CTA at the bottom to the InkTracker trial (`?ref=tools`).

## Requirements (the calculator page)
- **Static + crawlable**, same pattern as the blog/compare pages — rendered HTML in `public/tools/screen-printing-price-calculator/index.html`, served via the existing `vercel.json` rewrite pattern, committed, built by the content build. Must expose real content to crawlers, not a client-only React route.
The tool has TWO parts on one page: (A) a print-price **chart** generated from the shop's overhead, and (B) a **full-price breakdown** that stacks the other layers on top. Minimal surrounding copy — only what earns SEO.

**Part A — Build a price chart from overhead (the main tool):**
- Five sliders: monthly costs ($1,000–50,000), prints/month (50–30,000), target margin % (10–75), volume discount % (0–30), added-color cost % (0–30). Each shows its value.
- Model (reuse/parameterize the existing blog `chartCalc`): `cpp = monthlyCosts / prints`; `base = cpp / (1 − margin)`; `tierMult[0]=1, tierMult[i]=tierMult[i-1]×(1 − volDisc×0.8^(i-1))` for i=1..3; `colMult[0]=1, colMult[c]=colMult[c-1]×(1 + addColor×0.9^(c-1))` for c=1..7; `cell = base × colMult × tierMult`.
- Output: the print-price chart, **per print** (1–8 colors × [25,50,100,200]), captioned "per print, before garment." Cells are **clickable** — clicking one sets the colors + quantity for Part B and highlights that cell.

**Part B — The full price (the breakdown that teaches the layers):**
- Controls: colors (1–8, synced with the chart selection), quantity (slider; snaps to the highest tier ≤ qty and shows it), garment (blank) cost ($0–40 slider), a **"Second print location"** toggle, and a **"Setup ($25/screen)"** toggle.
- Stacked line-item breakdown (this is the point — show how each factor plays in):
  - **Print — front:** chart cell for the selected colors/tier × qty.
  - **Print — 2nd location (additional):** when toggled on, ~half the front print rate (additional locations share setup) × qty.
  - **Garment:** `garmentCost × markup`, where markup is the tiered bracket (`>$25 →1.15, >$15 →1.22, >$8 →1.30, else 1.40`) — the "markup slides down as blanks get pricier" logic from the pricing post.
  - **Setup & Screen Fees:** `(total screens across locations) × $25`.
  - **Order total** and a small **Per shirt** line.
- One short line above the breakdown, SEO-useful: "The chart is the print. Three things stack on top: garment markup, setup fees per screen, and additional print locations."
- Static-first render, forest `#2c5840`, round every number.
- Reuse the blog `chartCalc` as the shared chart source (don't fork the math); keep the blog widget print-only.
- **Supporting copy** (short, printer voice, teaches the method): a paragraph on how to read it (overhead ÷ prints = cost per print; margin isn't markup; garment + setup are separate layers). Link to the full `build-a-screen-printing-price-chart` post for the deep version. Keep it genuinely educational — this is the shareable part.
- **SEO:**
  - `<title>`: "Free Screen Printing Price Calculator" (+ short qualifier).
  - Meta description targeting the query.
  - Canonical `https://inktracker.app/tools/screen-printing-price-calculator` (non-www, matching the site's canonical convention — see SEO_CANONICAL_FIX.md).
  - JSON-LD: `WebApplication` (or `SoftwareApplication`) with name, description, `applicationCategory: "BusinessApplication"`, `offers` price 0 (it's free); plus a `BreadcrumbList`.
  - Add the URL to `sitemap.xml`.
- **Soft CTA** (on-brand, not pushy): "This is the free version of the pricing engine we built into InkTracker — it holds your chart, garment markup, and setup fees and stacks them on every quote. 14-day free trial, no card." → trial link with `?ref=calculator`.
- **Internal links:** link to/from the pricing blog posts and `/for-printers`; add a **"Free Tools"** link in the site nav (and/or the Resources menu) pointing at the **`/tools/` hub** so the whole cluster is discoverable, and link the calculator ↔ hub ↔ pricing posts.

## Verify
- `npm test` green; both `/tools/` and `/tools/screen-printing-price-calculator` render real HTML (hub shows the calculator card; calculator page works), both are in `sitemap.xml`, canonicals are non-www, and the CTA links carry `?ref=tools` / `?ref=calculator`.
- A "Free Tools" nav entry points at `/tools/`.
- Report both preview URLs.

## After it ships (promotion — this is where the links come from)
- Post it in r/screenprinting and the big FB print groups as a *useful free tool*, not an ad ("built a free price calculator, might help someone pricing jobs").
- Mention it in the outreach emails as a resource.
- It doubles as a lead magnet for the email list.
