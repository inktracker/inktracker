# InkTracker Blog — strategy that drives signups (and survives a solo founder)

Your instinct (publish weekly) is right — but split it into two tracks that do different jobs, because "weekly industry news" alone won't rank, won't convert, and won't survive.

## The honest reframe
- **What ranks and converts printers = evergreen how-to / decision content**, not news. Printers google "how to price screen printing," "Printavo alternative," "screen printing production workflow" — for years. These pieces pull their weight forever and bring in people *actively shopping*.
- **What builds audience + habit + social/email fuel = a light weekly brief.** Cheap to produce, keeps you visible, gives you something to post in the FB groups every week, grows an email list.

Do both. The evergreen track earns the signups; the weekly brief keeps you top-of-mind and feeds the funnel. They link to each other.

---

## Track A — Evergreen cornerstone posts (the workhorses; priority)
Publish these first, one every 1–2 weeks, and keep them updated. Each targets a real search a printer makes, and ends with a soft trial CTA + a link to `/for-printers` and `/compare`.

**Bottom-funnel (shopping → signup) — write these FIRST:**
1. "Printavo alternatives in 2026: an honest comparison" (you already have `/compare` — expand it)
2. "Best screen printing shop management software (what to actually look for)"
3. "How much does print-shop software cost? (real pricing breakdown)"
4. "Spreadsheets vs. software for a print shop: when to switch"

**Middle-funnel (how-to that shows your product is the answer):**
5. "How to price a screen printing job (with a free calculator)" ← lead magnet, huge search volume
6. "Sales tax for print shops, explained (and how to stop dreading it)" ← you *just* wrote the tax help content; repurpose it
7. "A production workflow that keeps your press schedule sane"
8. "How to write a screen printing quote your customer actually approves"
9. "Setting up QuickBooks for a print shop without double entry"

**Top-funnel (authority / shareable):**
10. "The real cost of a disorganized shop (rework, missed dates, dead time)"
11. "Screen printing pricing mistakes that quietly kill your margin"
12. "From side hustle to real shop: the systems you need at each stage"

Each post: ~800–1,500 words, one clear search target, a screenshot or two, an honest printer voice, one CTA. Internal-link them to each other and to `/for-printers`.

## Track B — "The Print Shop Brief" (your sustainable weekly)
A short weekly roundup — this is the version of "weekly industry updates" that's actually maintainable:
- **Format:** 3–5 links that matter to shop owners (blank/garment price moves, supplier news, ink/equipment, e-comm/DTG/DTF trends, tariffs, seasonal demand) — each with **one line of *your* take as a printer.** The take is the value; anyone can link.
- **Length:** 200–400 words. 30–45 min to produce once you have the habit.
- **Doubles as:** an email newsletter (start collecting emails now) AND a weekly FB-group / Reddit post ("This week in print shops: …").
- **Why it works:** low effort, builds a subscriber list you own, keeps you visible weekly, and the "printer's take" is your moat — trade pubs can't do that voice.

---

## The system (so it doesn't die)
- **Cadence that survives:** 1 evergreen post every 2 weeks + the weekly Brief. That's sustainable solo. Don't promise weekly *essays*.
- **Batch it.** Draft a month of Briefs' skeletons in one sitting; fill takes as news breaks.
- **Founder-voice-in, AI-polish-out.** The winning content is *your* shop experience. Workflow: you brain-dump 5–10 bullets or a 2-min voice memo → hand it to your writing assistant → it drafts → you keep the parts only a printer would say. Never ship generic AI filler — Google's helpful-content updates punish it and printers smell it instantly.
- **Repurpose everything.** Each evergreen post → a FB-group post + 3 short social snippets + a Brief mention. One piece of work, five placements.
- **Every post ends the same way:** one honest CTA ("We built InkTracker to fix exactly this — 14-day free trial, no card") + internal links.

## SEO mechanics (plug into what you already have)
- You already have `scripts/generate-compare-pages.mjs`, SEO foundation, and JSON-LD — extend that setup to render `/blog` and `/blog/<slug>` as static pages (fast, indexable).
- Each post: unique title/meta, `Article` JSON-LD, a hero image, internal links, and a canonical URL. Add posts to your `sitemap.xml`.
- Link cluster: cornerstone posts ↔ each other ↔ `/for-printers` ↔ `/compare` ↔ trial. That internal linking is half the SEO win.

## Measure
- Track: organic sessions to `/blog/*`, email subscribers, and signups attributed to blog (tag CTAs `?ref=blog`).
- Leading indicator month 1–3: are the bottom-funnel posts (1–5) getting *any* impressions in Search Console? That tells you if it's landing before signups show up.

## Don't
- Don't do weekly original long essays (burnout).
- Don't publish thin AI-generated news restated from trade pubs (hurts SEO + credibility).
- Don't point CTAs at the homepage — use `/for-printers` and the trial.

---

## Fastest path to live
1. **Build the blog infra** (static `/blog` + `/blog/<slug>`, MDX or your existing content-gen, Article JSON-LD, sitemap). Small, one-time.
2. **Ship 3 cornerstone posts** to launch with (#1 Printavo alternatives, #5 pricing + calculator, #6 sales tax — you already have raw material for the last two). A blog with 3 real posts converts; a blog with 1 "hello world" doesn't.
3. **Start the weekly Brief** + an email capture box on every post.

Want me to (a) write the blog-infra build prompt for your terminal agent, and (b) draft the first cornerstone post (I'd start with the pricing one — highest search volume, and it doubles as the free calculator lead magnet)? Say go and I'll produce both.
