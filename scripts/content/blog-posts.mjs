// ─────────────────────────────────────────────────────────────────────────
// Blog content. Read by scripts/generate-blog.mjs, which renders static,
// crawlable HTML → public/blog/. Mirrors the /compare content pattern.
//
// HONESTY RULES (same as comparisons.mjs):
//   - Every InkTracker claim must be verifiable in the live product.
//   - No negative claims about competitors. These posts teach pricing; they
//     don't knock other tools.
//   - The trial REQUIRES a card (since 2026-07-02) — never write "no card" /
//     "no credit card". Enforced by scripts/__tests__/blogPosts.test.js.
//
// `body` is an ordered list of blocks the renderer understands:
//   { type:'p', html }              — paragraph (html allowed; author-trusted)
//   { type:'h2', text }             — section heading
//   { type:'ul', items:[html,…] }   — bullet list
//   { type:'callout', title, html } — highlighted aside
//   { type:'calculator', kind }     — interactive widget: 'job'|'chart'|'embroidery'
// ─────────────────────────────────────────────────────────────────────────

import { SITE } from "./comparisons.mjs";
export { SITE };

// End-of-post CTA + related links are appended by the renderer (cta:true),
// so posts don't repeat that markup.
//
// Optional `faqs: [{ q, a }]` renders a visible "Common questions" <dl> at the
// end of the post AND emits matching FAQPage JSON-LD (both or neither — Google
// requires the FAQ text to be visible on the page).

export const POSTS = Object.freeze([
  // ── Post 1 — Pricing a screen printing job ───────────────────────────────
  {
    slug: "how-to-price-a-screen-printing-job",
    title: "How to price a screen printing job without leaving money on the table",
    description:
      "Blanks, printing, and setup are the only three costs in a screen printing job. Here's how to price all three the same way every time — with a calculator to try it on your own numbers.",
    category: "Pricing",
    author: "Joe",
    authorRole: "Founder, InkTracker",
    date: "2026-07-01",
    updated: "2026-07-01",
    readMin: 6,
    ogImage: SITE.logo,
    cta: true,
    body: [
      { type: "p", html: "Most shops price a screen printing job one of two ways: by gut, or by copying the last invoice for something that looked similar. Both feel fast, and both quietly cost you money. Gut pricing swings high enough to lose the job or low enough to lose the margin, and copying an old invoice carries forward whatever mistake was baked into it — usually a setup fee that never covered the screens." },
      { type: "p", html: "The good news is that a screen printing job only has three costs. Once you can name them and see how each one moves, you can price any job in about a minute and know the number is right before it ever hits the press." },

      { type: "h2", text: "The three costs in every job" },
      { type: "p", html: "That's it — every screen print job is blanks, printing, and setup. Nothing else is a cost; everything else is margin." },
      { type: "ul", items: [
        "<b>Blanks.</b> What you pay for the shirt itself, per piece. This is a hard number — it's on your supplier invoice. If you're pulling live pricing from S&amp;S or AS Colour, it's whatever the blank costs today, not what it cost last spring.",
        "<b>Printing.</b> The cost to put ink on the shirt, per piece. The key thing here: <b>the per-shirt print cost drops as the quantity goes up.</b> Running 12 shirts through the press costs about the same in labor and setup-per-print as running the 13th and 14th, so the more shirts in the run, the cheaper each print gets. That's why price charts have quantity columns.",
        "<b>Setup.</b> One screen per color, burned once for the whole run. A 3-color print needs 3 screens whether you print 24 shirts or 240. Setup is a <i>fixed</i> cost for the job, so its impact per shirt depends entirely on how many shirts you spread it across.",
      ] },
      { type: "p", html: "Keep those straight and the whole job prices itself: blanks and printing scale with quantity, setup is fixed and gets divided by it." },

      { type: "callout", title: "Try it on your own numbers", html: "The calculator below runs exactly this math — blank cost, ink colors, quantity, and your markup. Drag the sliders and watch the per-shirt price, the order total, and your actual margin move. Every input shows its value, so you can take the numbers straight to your own pricing." },
      { type: "calculator", kind: "job" },

      { type: "h2", text: "The mistake that kills margin on small runs" },
      { type: "p", html: "Here's the trap, and it catches good shops. A customer asks for 24 shirts instead of 72. You quote the same per-shirt price you'd give on a bigger run because it feels close enough, or you knock a little off to be nice. But your screen fee didn't change — a 3-color job still burns 3 screens. You just went from spreading that setup across 72 shirts to spreading it across 24." },
      { type: "p", html: "Say your setup is $60 in screens. Across 72 shirts that's $0.83 a shirt. Across 24 it's $2.50 a shirt — more than triple, on every single piece. If your per-shirt price didn't move to cover it, that $2.50 comes straight out of your margin. A markup that looked healthy on paper turns into a break-even job, and a small \"friendly\" discount on top turns it into a loss you won't notice until you tally the month." },
      { type: "p", html: "Small runs aren't bad business — they're just <i>fixed-cost-heavy</i> business. Price them like it. The setup has to land on fewer shirts, so the per-shirt number has to be higher, not the same. Slide the quantity in the calculator down to 24 and watch the margin drop if you leave everything else alone; that's the effect, live." },

      { type: "h2", text: "Price it the same way every time" },
      { type: "p", html: "The fix for gut pricing isn't a fancier spreadsheet — it's a checklist you run identically on every job:" },
      { type: "ul", items: [
        "<b>Start with the blank.</b> Pull the current cost for the exact style and color. Not last year's — today's.",
        "<b>Set the print cost by quantity.</b> Use your per-print rate for that quantity break and multiply by the number of colors.",
        "<b>Add setup as screens ÷ shirts.</b> One screen per color, divided by the actual run size. This is the step everyone skips on small runs.",
        "<b>Apply your margin — as a margin, not a markup.</b> More on that distinction in the price-chart post, but the short version: decide the profit you want to keep, and price up to it.",
        "<b>Sanity-check the per-shirt number.</b> If it looks too low to be worth pulling a squeegee, it probably is. Trust the math over the reflex to win the job.",
      ] },
      { type: "p", html: "Do that five-step pass the same way every time and two things happen: your quotes get faster because you're not reinventing the number, and your margin stops leaking on the jobs that used to sneak by. That's the whole point of a system — not to make pricing complicated, but to make it boringly consistent." },
      { type: "p", html: "This is exactly what InkTracker does on every quote automatically: it pulls the live blank price, applies your per-quantity print rates and per-color screen fees, spreads the setup across the run, and shows you the margin before you send it. You set your rates once; every quote after that just runs the checklist for you." },
    ],
    related: [
      { href: "/blog/build-a-screen-printing-price-chart", text: "Build a price chart that covers your overhead" },
      { href: "/compare", text: "The honest software buyer's guide" },
    ],
    faqs: [
      {
        q: "What's the difference between margin and markup?",
        a: "Markup is what you add on top of cost; margin is what you keep out of the final price. Mark a $6 cost up 50% and you get $9, but that $3 is only 33% of the sale — not 50%. If you want to keep half, divide cost by 0.5, not multiply by 1.5. People lose real money confusing the two.",
      },
      {
        q: "Do I really need a setup fee if my prints already cover overhead?",
        a: "Yes. Burning, taping, registering, and reclaiming a screen costs the same whether you print 25 shirts or 250. On big runs it's pennies a shirt; on a 12-piece job it's the whole difference between profit and working for free. Charge per screen, and drop to a lower re-setup rate on reorders where the screens already exist.",
      },
      {
        q: "How much should I mark up the blank garment?",
        a: "Keep garment markup on its own ladder, separate from the print price, and slide it down as blanks get pricier. 40% on a $4 tee is fine; 40% on a $30 hoodie makes you the most expensive shop in town, so a hoodie might get 15%. Keeping it separate is what lets you swap a tee for a hoodie without rebuilding the quote.",
      },
    ],
  },

  // ── Post 2 — Building a price chart ───────────────────────────────────────
  {
    slug: "build-a-screen-printing-price-chart",
    title: "How I build a screen printing price chart",
    description:
      "Your print prices worked out ahead of time — every color count, every quantity — built on what your shop actually costs to run. Cost per print, real margin, two percentages to fill the grid, and the fees that decide small runs.",
    category: "Pricing",
    author: "Joe",
    authorRole: "Founder, InkTracker",
    date: "2026-07-01",
    updated: "2026-07-02",
    readMin: 8,
    ogImage: SITE.logo,
    cta: true,
    ctaHeading: "Build it once, stop guessing at the counter.",
    ctaBody:
      "InkTracker holds your print chart, garment markup, and fees and stacks them on every quote — we run it in our own shop every day.",
    body: [
      { type: "p", html: "When I started out I priced jobs off a competitor's website and a gut feeling. Some made money, plenty didn't, and I couldn't tell which was which until the numbers came in at the end of the month." },
      { type: "p", html: "A price chart is how you stop guessing. It's your print prices worked out ahead of time — every color count, every quantity — so you quote off a number you trust instead of one you pulled out of the air. Most charts float on nothing, though. This one's built on what your shop actually costs to run." },

      { type: "h2", text: "Start with what a print actually costs you" },
      { type: "p", html: "Not the ink. Everything. Rent, power, the light bill, a tube of emulsion, and your own paycheck. Two numbers get you there and you already know both — what your shop costs to run in a month, and how many shirts you print in that month. Divide one by the other. Spend $14k a month, push 4,000 shirts, and every print costs you about $3.50 before you've made a dime." },
      { type: "p", html: "Then decide what you want to keep. Want 45%? Your base isn't cost times something — it's cost divided by 0.55. That $3.50 turns into $6.36. Write it down. That's the cheapest square on your whole chart: one color, smallest run. Everything else grows from it." },
      { type: "calculator", kind: "chart" },

      { type: "h2", text: "Let percentages do the boring part" },
      { type: "p", html: "You don't type in 32 prices. You set two rules and the chart fills itself. Bigger runs cost less per shirt, because setup is the same whether you print 25 or 250 — so knock a chunk off at each size break, around 10% for the first jump and a little less each time after. More colors cost more, but not double. The first color's the expensive one; it carries the setup. Every color after is just another screen and another pass, so each one adds a slice — call it 10% — and that slice shrinks as the count climbs." },
      { type: "p", html: "Build it this way and the chart moves as one. Want to bump prices 5% next year? Change your base. Beats retyping a spreadsheet." },

      { type: "h2", text: "Margin isn't markup (this one cost me)" },
      { type: "p", html: "Mark a $6 cost up 50% and you get $9. Feels like half of it's profit. It isn't — $3 out of $9 is 33%. If you actually want to keep half, you divide by 0.5 and charge $12. I priced a whole season on \"cost times 1.5\" thinking I was at 50 points. I was at 33. Don't be me." },

      { type: "h2", text: "The chart is half the shirt. Here's the rest." },
      { type: "p", html: "<b>Garment.</b> You don't sell blanks at cost, but the markup slides down as they get pricier. Forty percent on a $4 tee is easy. Forty percent on a $30 hoodie makes you the priciest shop in town — so a hoodie gets maybe 15%. Keep it on its own ladder, away from the print chart. That's what lets you swap a tee for a hoodie without rebuilding anything." },
      { type: "p", html: "<b>Screens.</b> Every color's a screen, and a screen is time — burn it, tape it, register it, reclaim it later. Charge a setup fee per screen. Three-color front, three screens. Reorder the same art and the screens already exist, so drop to a small re-setup rate. On 200 shirts it's pennies each. On a 12-piece job it's the whole difference between a profit and a thank-you card." },
      { type: "p", html: "<b>Extras and rush.</b> A PMS match, a heavy discharge print, tags in the neck — all cost more, all get a line, some once and some per shirt. And if somebody needs 100 shirts in three days while everyone else waits, that's a rush percentage on the order." },
      { type: "p", html: "Stack it up and a real quote is: print + garment×markup + screens + extras + rush. Say 100 shirts, two-color front, $4 tee — print's about $5.77 a shirt, garment's $5.60, two screens is fifty bucks (fifty cents a shirt). Roughly $11.87 each, call it $1,187, before rush. Leave the screens off and you just ran a hundred shirts for fifty dollars under cost. Nobody does that on purpose. Lots of new printers do it by accident." },

      { type: "h2", text: "Build it once" },
      { type: "p", html: "Set it up one time — a base you can defend, a couple of percentages to shape the rest, garment and fees kept separate — and stop guessing at the counter. That's the whole system." },
    ],
    related: [
      { href: "/blog/how-to-price-a-screen-printing-job", text: "How to price a single screen printing job" },
      { href: "/compare", text: "The honest software buyer's guide" },
    ],
    faqs: [
      {
        q: "What should the cheapest price on my chart be?",
        a: "One color, smallest run. That square is your cost per print divided by (1 minus your target margin). Spend $14k a month, push 4,000 shirts, and each print costs about $3.50 — at a 45% margin that base is $6.36. Every other cell on the chart grows from that number.",
      },
      {
        q: "How do I set the price breaks without typing in every cell?",
        a: "Two rules fill the whole chart. Bigger runs cost less per shirt because setup is fixed, so knock roughly 10% off at each size break, a little less each time. More colors cost more but not double — the first color carries the setup, so each color after adds a shrinking slice. Set the two percentages and the chart moves as one when you change your base.",
      },
      {
        q: "How often should I rebuild my price chart?",
        a: "You don't rebuild it — you change the base. Because the chart is built off one cost-per-print number and a couple of percentages, bumping prices 5% next year is a one-number edit, not a spreadsheet retype. Revisit the base whenever your overhead or volume shifts enough to move that cost-per-print figure.",
      },
    ],
  },

  // ── Post 3 — Pricing embroidery ───────────────────────────────────────────
  {
    slug: "how-to-price-embroidery",
    title: "How to price embroidery: stitch count is the number that matters",
    description:
      "Screen printing prices by color. Embroidery prices by stitch count — because the machine bills in run time and stitches are run time. Here's how to price it, including digitizing, with a calculator to try your own numbers.",
    category: "Pricing",
    author: "Joe",
    authorRole: "Founder, InkTracker",
    date: "2026-07-01",
    updated: "2026-07-01",
    readMin: 6,
    ogImage: SITE.logo,
    cta: true,
    body: [
      { type: "p", html: "If you came to embroidery from screen printing, the instinct is to price it by colors — that's the lever you know. Drop it. Embroidery doesn't care much about colors. It cares about <b>stitch count</b>, because stitch count is run time, and run time is what the machine actually costs you." },
      { type: "p", html: "An embroidery machine bills you in minutes. A design with 12,000 stitches sits on the head roughly twice as long as one with 6,000, so it ties up the machine — and your operator's attention — twice as long. Swapping a thread color takes a few seconds; stitching takes minutes. So the number that drives your cost is stitches, and everything else is a rounding error by comparison." },

      { type: "h2", text: "Stitch count, not colors" },
      { type: "p", html: "Your digitizer gives you the stitch count for every design — it's right there in the stitch file. That one number tells you which price tier the job lands in. Instead of a colors × quantity grid like screen printing, an embroidery chart is <b>stitch-tier × quantity</b>: a few bands of stitch count (say, under 5,000, 5–10K, 10–15K, 15K and up) down the side, quantity breaks across the top." },
      { type: "p", html: "Colors barely move the price because they barely move the machine. A left-chest logo in one thread color and the same logo in five colors run for nearly the same time if they're the same stitch count — the head just picks up a different cone between color blocks. So don't build a color surcharge into embroidery the way you would for screens. Build stitch tiers, get the count from your digitizer, and drop the job in the right band." },
      { type: "callout", title: "Get the stitch count first", html: "Before you quote embroidery, have the design digitized (or at least estimated) so you know the stitch count. Quoting embroidery without it is like quoting screen print without knowing the color count — you're guessing at the one input that sets the price." },

      { type: "p", html: "The grid below prices embroidery the right way: stitch tiers down the side, quantities across the top, overhead spread across every piece, and margin applied on top. Set your numbers and watch it fill in — it's the same shape as the embroidery chart InkTracker keeps for you." },
      { type: "calculator", kind: "embroidery" },

      { type: "h2", text: "Don't forget digitizing" },
      { type: "p", html: "There's one cost embroidery has that screen printing doesn't: <b>digitizing</b>. Before the machine can stitch a logo, someone has to \"punch\" the artwork into a stitch file — mapping every stitch, direction, and density. It's skilled work, and it's a one-time cost per design, usually somewhere around <b>$40–75</b> depending on complexity." },
      { type: "p", html: "The key is that it's <i>one-time</i>. You pay to digitize a logo once, and then you own the stitch file forever — every reorder of that design runs off the same file at no extra digitizing cost. So charge the digitizing fee once, on the first order for a new design, and don't bury it in the per-piece price where it either scares off the first order or vanishes on the reorders. Bill it as its own line, reuse the file, and both you and the customer come out ahead." },

      { type: "h2", text: "Margin isn't markup here either" },
      { type: "p", html: "The same margin lesson from screen printing carries straight over: every cell in your embroidery chart should be <code>price = cost ÷ (1 − margin)</code>, not cost plus a markup percentage. A \"50% markup\" on a $6 per-piece cost is $9 — a 33% margin, not 50%. If you want to actually keep half, it's <code>6 ÷ (1 − 0.50) = $12</code>. Build the grid on margin so the profit you decided on is the profit you get, on every piece, at every stitch tier." },

      { type: "h2", text: "Set it once" },
      { type: "p", html: "Just like the screen-print chart, the embroidery chart is something you build once and then stop thinking about. Set your stitch tiers, your quantity breaks, your overhead-per-piece, and your margin, and every embroidery quote reads the right cell." },
      { type: "p", html: "In InkTracker, the embroidery chart lives right next to the screen-print one — same idea, stitch tiers instead of colors. You configure it once, and every quote that involves a stitched logo pulls its price from that grid and adds the one-time digitizing fee when it's a new design. Set your rates the way <a href=\"/blog/build-a-screen-printing-price-chart\">the price-chart post</a> lays out, and the app runs the same disciplined math on embroidery that it runs on <a href=\"/blog/how-to-price-a-screen-printing-job\">screen printing</a> — automatically, on every quote." },
    ],
    related: [
      { href: "/blog/how-to-price-a-screen-printing-job", text: "How to price a screen printing job" },
      { href: "/blog/build-a-screen-printing-price-chart", text: "Build a price chart that covers overhead" },
    ],
    faqs: [
      {
        q: "What sets the price on an embroidery job?",
        a: "Stitch count. It's the embroidery equivalent of color count on a screen print — the one input that drives the number. Get the design digitized (or at least estimated) so you know the stitch count before you quote. Quote without it and you're guessing at the thing that sets the price.",
      },
      {
        q: "Should I charge for digitizing?",
        a: "Yes, once per design. Digitizing a new logo runs around $50 of one-time work; charge it on the first order and reuse the file forever after. Don't bury it in the per-piece price — it's a one-time line, not a running cost.",
      },
    ],
  },

  // ── Post 4 — Sales tax (stub draft, sourced from docs/tax-help-content.md) ─
  {
    slug: "sales-tax-for-print-shops",
    title: "Sales tax for print shops: the short version",
    description:
      "How sales tax actually works for a print shop — destination-based rates, when you need address-level accuracy, and how software handles it. A plain-English primer (not tax advice).",
    category: "Money",
    author: "Joe",
    authorRole: "Founder, InkTracker",
    date: "2026-07-01",
    updated: "2026-07-01",
    readMin: 3,
    ogImage: SITE.logo,
    cta: true,
    body: [
      { type: "callout", title: "Not tax advice", html: "This explains the mechanics of how sales tax gets calculated on a print order. It isn't tax advice. For what you're actually required to collect — rates, nexus, whether a specific product is taxable in a specific state — check with your accountant or your state's Department of Revenue." },
      { type: "p", html: "Sales tax on apparel is <b>destination-based</b> in most states: the rate that applies is the rate at the address where the goods end up, not where your shop sits. Sell a run to a customer across the state line and, if you're registered to collect there, you charge <i>their</i> rate — which combines state, county, and sometimes city into a single number that's hard to eyeball." },
      { type: "h2", text: "When a flat rate is fine — and when it isn't" },
      { type: "p", html: "If nearly all your work stays local, a single flat rate you set is usually close enough to start. The moment you sell into more than one jurisdiction, a flat rate starts to under- or over-collect, and the gap is your problem at filing time. That's when address-based rates stop being a nicety and start being the thing that keeps your books clean." },
      { type: "p", html: "This is why InkTracker calculates tax two ways. Without QuickBooks connected, it applies the single flat rate you set and labels it \"Est.\" on the customer's page, so nobody mistakes an estimate for a looked-up number. With QuickBooks Online connected, QuickBooks' Automated Sales Tax becomes the authority — it reads the customer's ship-to address, applies the correct destination rate, handles exemptions on the invoice, and records every sale for filing. InkTracker mirrors that number so what the customer sees matches what your books will bill." },
      { type: "p", html: "The practical takeaway: pick flat-rate to get moving, and connect QuickBooks before you're selling across state lines at any volume. Either way, keep your exemption certificates on file and let the software carry the arithmetic — it's one less place for a rounding error to become a filing headache." },
    ],
    related: [
      { href: "/blog/how-to-price-a-screen-printing-job", text: "How to price a screen printing job" },
      { href: "/compare", text: "The honest software buyer's guide" },
    ],
    faqs: [
      {
        q: "Do I charge sales tax on a print order?",
        a: "Usually yes on retail sales to the end customer, but it depends on your state and the customer. Resale (a customer reselling the shirts) is typically exempt with a valid resale certificate. Rates, nexus, and what's taxable vary by state — this is the mechanics, not tax advice; confirm your specifics with your accountant or state Department of Revenue.",
      },
      {
        q: "Is the tax calculated on the garment, the printing, or both?",
        a: "In most states the taxable amount is the full sale — garment plus decoration — because you're selling a finished product, not a service on the customer's own goods. Customer-supplied garments can change that. Again, state-specific; check your Department of Revenue.",
      },
    ],
  },

  // ── Post 5 — The honest software comparison (narrative /compare) ──────────
  // Same HONESTY RULES as comparisons.mjs: no negative competitor claims,
  // alphabetical + same-format landscape, facts kept consistent with the
  // `landscape` and `criteria` arrays in that file (REVIEWED June 2026).
  {
    slug: "screen-printing-software-honest-comparison",
    title: "How to choose screen printing software (I'm not going to trash my competitors)",
    description:
      "An honest look at the leading screen printing software in 2026 — Printavo, YoPrint, InkSoft, DecoNetwork, and InkTracker — including where each one wins. No trash talk, from someone who sells one of them.",
    category: "Software",
    author: "Joe",
    authorRole: "Founder, InkTracker",
    date: "2026-07-02",
    updated: "2026-07-02",
    readMin: 7,
    ogImage: SITE.logo,
    cta: true,
    body: [
      { type: "p", html: "When I was a kid, I remember watching the fast food chains at war with each other on TV. Every other commercial was one of them taking shots at the other: their beef's frozen, their coffee tastes burnt, whatever it was that week. And I remember thinking that if the only way you can get me to eat your burger is by telling me the other guy's burger is garbage, then yours probably isn't very good. The quality of the burger should speak for itself." },
      { type: "p", html: "That stuck with me." },
      { type: "p", html: "Because here's what I love about this industry. Screen printers help each other. I've had competitors — real ones, shops a twenty-minute drive away that bid against me for the same jobs — walk me through a fix on the phone when I was cursing at a press at 9pm. People post their setups, trade ink recipes, warn each other about a bad box of blanks before it burns somebody else. For a trade where we're all technically fighting over the same work, printers are about the most generous group of people I've ever been around." },
      { type: "p", html: "So I'm not going to sell you on InkTracker by telling you the other software is bad. It isn't. Most of it is good, built by people who actually care about this trade, and honestly better than mine at certain things. This started life as <a href=\"/compare\">our comparison page</a>, and a few people told me it was the most useful thing on the site precisely because it wasn't a hit piece. So here's the long version." },

      { type: "h2", text: "There's no single best one" },
      { type: "p", html: "I'll save you the suspense: there is no \"best screen printing software.\" There's the one that fits how your shop actually runs. A three-person shop cranking out contract work has completely different needs than a shop whose whole business is selling spirit wear online. Anybody who tells you there's one right answer is selling you something. Which, fair, so am I — but I'd rather you land on the thing that fits than sign up for mine and bounce in a month." },

      { type: "h2", text: "What actually matters when you're choosing" },
      { type: "p", html: "Before you look at any specific tool, get clear on what you're actually shopping for. These are the things that separate them:" },
      { type: "ul", items: [
        "<b>What you'll really pay.</b> Some tools post a flat price. Others are tiered, per-seat, or a quote-based bundle where the number depends on a sales call. Neither is wrong, but figure out what it costs at YOUR size with YOUR number of users before you fall in love with a demo.",
        "<b>Whether it talks to your accounting.</b> If you run QuickBooks, a two-way sync that keeps invoices, payments, and customers matched saves you hours and keeps your books honest. Check whether a tool's sync is actually two-way or just pushes one direction.",
        "<b>Live garment pricing.</b> Pulling current blank prices straight from your supplier while you quote means your margins reflect what the shirt costs today, not what it cost last spring. If you quote off stale numbers, you find out at the worst time.",
        "<b>Production tracking your whole shop can see.</b> A visual board from art approval to shipping, and a floor view your crew can update from their phones, is the difference between a schedule and a group text.",
        "<b>Online quoting.</b> An embeddable form or store lets a customer start an order on your site at midnight instead of every job beginning with an email you have to answer.",
        "<b>Broker support, if you take reseller work.</b> Per-reseller pricing and a portal so their orders come in already priced right, without you doing the math by hand every time.",
      ] },

      { type: "h2", text: "The honest landscape" },
      { type: "p", html: "Alphabetical, me included, same treatment for everyone. What each one is genuinely good at — not a list of what they can't do. Details and pricing change, so confirm the specifics on each company's own site before you commit. This was last reviewed June 2026." },
      { type: "ul", items: [
        "<b>DecoNetwork</b> — an all-in-one web-to-print suite. Online stores, an online design studio, and business-management tools bundled together on tiered plans. If you want one platform with the whole web-to-print side built in, this is squarely aimed at you.",
        "<b>InkSoft</b> — part of the Inktavo family, and strongest at the front of the funnel. Customizable online stores, group and fundraising stores, sales tools for actually selling apparel online. If your priority is selling and group ordering, they're very good at it.",
        "<b>InkTracker</b> — mine. One flat price, $99 a month, everything included and unlimited employees. Live garment pricing from S&amp;S and AS Colour right inside quoting, a two-way QuickBooks Online sync across invoices, payments, and customers, an embeddable customer quote wizard, a broker portal, and production and shop-floor tracking. I built it as a screen printer who was sick of paying per seat and doing double entry into QuickBooks. It's an operations tool, not a storefront platform.",
        "<b>Printavo</b> — one of the best-known names in the space, now part of Inktavo. Established, widely used, with calendar-driven scheduling, online approvals, quoting, and invoicing. If you want a proven platform that a ton of shops already run, there's a real comfort in that.",
        "<b>YoPrint</b> — modern, production-focused, with a QuickBooks integration and published tiered pricing that includes a free tier. If you want clean production management and a free way to kick the tires before you spend anything, start there.",
      ] },

      { type: "callout", title: "Where InkTracker probably isn't your answer", html: "If your whole business is selling online — spirit wear, fundraisers, custom stores for a hundred different groups — InkSoft or DecoNetwork are built for that and I'm not. If you want the biggest, most-adopted name with years of shops behind it, that's Printavo. If you want to spend zero dollars this week and just try something, YoPrint has a free tier and I don't. I'm the answer when you want transparent flat pricing with tight QuickBooks and live supplier pricing, and you care more about running the shop than running a storefront." },

      { type: "p", html: "That's the real map. Pick the one that matches the shape of your business. If that's not mine, no hard feelings — genuinely. I'd rather you tell another printer \"the guy at InkTracker pointed me the right way\" than have you resent a tool that was never built for you." },
      { type: "p", html: "If flat pricing and tight QuickBooks does sound like your shop, the full side-by-side with the criteria and current details lives on <a href=\"/compare\">our comparison page</a>, and you can try InkTracker free for 14 days. And if you land somewhere else, come back and tell me how it's going anyway. We're all in this together." },
    ],
    related: [
      { href: "/compare", text: "The honest software buyer's guide" },
      { href: "/blog/how-to-price-a-screen-printing-job", text: "How to price a screen printing job" },
    ],
    faqs: [
      {
        q: "What's the best screen printing software?",
        a: "There isn't one best — it depends on your shop. Weigh what you'll actually pay at your size, whether it syncs two-way with your accounting, whether it pulls live supplier pricing, and whether your priority is production, online stores, or selling. Printavo, YoPrint, InkSoft, DecoNetwork, and InkTracker each fit different shops.",
      },
      {
        q: "How much does screen printing software cost?",
        a: "It ranges from free starter tiers to tiered or quote-based bundles, depending on features and seats. InkTracker is a flat $99/mo (or $999/yr) with everything and unlimited employees included, plus a 14-day free trial. Confirm current pricing on each vendor's own site.",
      },
      {
        q: "Why would a software company recommend its competitors?",
        a: "Because the right fit matters more than the sale. If a shop signs up for a tool that was never built for how they work, they leave unhappy and tell other printers. I'd rather point you to the tool that fits — even if it's not mine — and earn the ones InkTracker is genuinely right for.",
      },
    ],
  },
]);
