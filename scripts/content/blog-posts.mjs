// ─────────────────────────────────────────────────────────────────────────
// Blog content. Read by scripts/generate-blog.mjs, which renders static,
// crawlable HTML → public/blog/. Mirrors the /compare content pattern.
//
// HONESTY RULES (same as comparisons.mjs):
//   - Every InkTracker claim must be verifiable in the live product.
//   - No negative claims about competitors. These posts teach pricing; they
//     don't knock other tools.
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
  },

  // ── Post 2 — Building a price chart ───────────────────────────────────────
  {
    slug: "build-a-screen-printing-price-chart",
    title: "Build a screen printing price chart that already covers your overhead",
    description:
      "A price chart is your price-per-print answered ahead of time for every color-count and quantity. Most shops build it from print cost alone and forget the rent. Here's how to bake overhead and real margin into the whole grid.",
    category: "Pricing",
    author: "Joe",
    authorRole: "Founder, InkTracker",
    date: "2026-07-01",
    updated: "2026-07-01",
    readMin: 6,
    ogImage: SITE.logo,
    cta: true,
    body: [
      { type: "p", html: "A price chart is just your price-per-print, answered ahead of time. Instead of doing the math fresh on every quote, you build a grid once — colors down one side, quantities across the top — and every cell holds the per-print price for that combination. Then quoting is lookup, not arithmetic." },
      { type: "p", html: "The problem is how most charts get built: straight from print cost. You figure out what it costs to push ink onto a shirt, add a markup, and fill in the grid. It looks complete. But it's missing the biggest bill you pay every month — the one that shows up whether or not the press runs. Your rent doesn't care how many shirts you printed. Neither does your power bill, your insurance, your software, your loan payment, or the paycheck you're supposed to take home." },

      { type: "h2", text: "Spread your overhead across every print" },
      { type: "p", html: "Overhead is every cost that isn't the blank or the ink: rent, utilities, insurance, software subscriptions, equipment loans, and — this is the one shops forget — <b>your own pay</b>. If you don't build your wage into the chart, every job silently underpays you and the shop looks more profitable than it is." },
      { type: "p", html: "The move is simple: add up your monthly overhead, divide by how many prints you do in a month, and you get an <b>overhead-per-print</b> number. That's the slice of the rent each print has to carry. Add it to your direct print cost <i>before</i> you apply margin, and suddenly every cell in the grid is pulling its weight on the fixed bills." },
      { type: "callout", title: "The overhead math, in one line", html: "Monthly overhead ÷ prints per month = overhead added to every print. If you spend $6,000 a month to keep the doors open and you do 3,000 prints, every print carries $2.00 of overhead before ink even enters the picture." },

      { type: "p", html: "The grid below is built exactly this way. Set your monthly overhead, your prints per month, your base print cost, and your margin — and it fills in a full colors × quantity chart with overhead already spread across every cell. It's the same shape as the pricing chart InkTracker manages for you, so what you build here is what you'd set once in the app." },
      { type: "calculator", kind: "chart" },

      { type: "h2", text: "Margin isn't markup (and the difference is real money)" },
      { type: "p", html: "This is the mistake that costs shops the most, because it hides inside a number that <i>sounds</i> right. \"I mark everything up 50%\" feels like a 50% margin. It isn't." },
      { type: "p", html: "Markup is added to your cost. Margin is a slice of your price. If a print costs you $6 and you mark it up 50%, you charge $9 — but your profit is $3 out of a $9 price, which is only a <b>33% margin</b>. You thought you were keeping half; you're keeping a third. Every cell in a chart built on markup is quietly thinner than you believe." },
      { type: "p", html: "Price by margin instead, and each cell is <code>price = cost ÷ (1 − margin)</code>. Want a true 50% margin on that $6 cost? <code>6 ÷ (1 − 0.50) = $12</code>, not $9. The formula guarantees the profit you actually decided to keep, on every square of the grid, instead of leaving it to a markup number that rounds down your paycheck. The note under the calculator shows the markup-equivalent of whatever margin you pick, so you can see the gap for yourself." },

      { type: "h2", text: "Set it once" },
      { type: "p", html: "The payoff of a chart is that you stop making pricing decisions per quote. You make them once — carefully, with overhead and real margin baked in — and then every quote just reads the right cell." },
      { type: "p", html: "That grid you just built is your pricing chart. In InkTracker, it's not a spreadsheet you keep in a drawer; it's the live pricing config. You set your color counts, your quantity breaks, your overhead assumptions, and your margin one time, and every quote the shop sends pulls its numbers straight from that chart — including the small-run setup math from <a href=\"/blog/how-to-price-a-screen-printing-job\">the pricing basics post</a>. Change your overhead when your rent goes up, and every future quote updates itself. That's the difference between a chart that sits still and one that actually runs your shop." },
    ],
    related: [
      { href: "/blog/how-to-price-a-screen-printing-job", text: "How to price a single screen printing job" },
      { href: "/compare", text: "The honest software buyer's guide" },
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
  },
]);
