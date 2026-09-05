// ─────────────────────────────────────────────────────────────────────────
// Feature-page content. Read by scripts/generate-features.mjs, which renders
// static, crawlable HTML → public/features/<slug>/index.html + a /features
// hub. Mirrors the /compare + /blog content-as-data pattern.
//
// HONESTY RULES (same as comparisons.mjs / blog-posts.mjs):
//   - Every claim must be verifiable in the live product.
//   - No competitor names on these pages at all — they describe what
//     InkTracker does, not what others don't. (Enforced by
//     scripts/__tests__/featurePages.test.js.)
//   - The trial is CARDLESS (since 2026-08-06) — never write that a card is
//     required to start.
//
// Each feature: slug, title (tab/meta), h1, metaDescription, lede,
// sections [{h2, paras[], bullets[]?}], faqs [{q,a}] (visible + FAQPage
// JSON-LD, both or neither).
// ─────────────────────────────────────────────────────────────────────────

import { SITE } from "./comparisons.mjs";
export { SITE };

export const FEATURES = Object.freeze([
  {
    slug: "shop-partnerships",
    title: "Shop-to-Shop Partnerships — InkTracker",
    h1: "Send work to another shop without losing the job",
    metaDescription:
      "InkTracker's shop partnerships let print shops subcontract to each other: per-partner trade rates, cost and margin visible while quoting, blind hand-offs, and orders split across shops.",
    lede:
      "A screen-print shop gets asked for embroidery every week. An embroidery shop gets asked for prints. Most of that work gets turned away, or handled over text messages with a shop across town and a prayer that the numbers work out. InkTracker makes the trade a first-class feature: partner shops, agreed rates, and a hand-off that keeps your customer yours.",
    sections: [
      {
        h2: "Quote the whole job, even the parts you don't make",
        paras: [
          "Invite a shop you trust as a partner. They set their trade rates for you by method and quantity, so when a customer asks for 100 printed shirts and 50 embroidered hats, you tag the hat line to your embroidery partner right in the quote. Their price fills in as your cost, your margin sits next to it, and you see what you make on every line before the quote goes out.",
        ],
      },
      {
        h2: "Blind hand-offs keep your customer yours",
        paras: [
          "When you send the work over, your partner gets the art and the job details they need to produce it. They don't get your customer's contact information, and they don't see your retail prices. Your customer deals with you the whole way through and never sees the hand-off at all.",
        ],
      },
      {
        h2: "It runs like a real order on both boards",
        paras: [
          "The hand-off lands on your partner's board as a real order. You watch its progress from yours and get a heads-up when it's done. When the job wraps, they invoice you through normal billing, at the number you both confirmed before the work started.",
        ],
        bullets: [
          "Per-partner trade rates by decoration method and quantity",
          "Partner cost and your margin visible while you quote",
          "Split one order across shops — hats to one, shirts to another",
          "Prices locked when the hand-off is confirmed, so nobody gets surprised",
        ],
      },
    ],
    faqs: [
      {
        q: "How do print shops subcontract work to each other?",
        a: "Traditionally by phone and email, with pricing renegotiated every job. In InkTracker, shops become partners once: each sets trade rates for the other, hand-offs carry the art and specs (never customer contacts or retail prices), and the receiving shop bills through its normal invoicing at a price both sides confirmed up front.",
      },
      {
        q: "Does my partner see my customer or my markup?",
        a: "No. The hand-off includes what they need to produce the job. Your customer's contact info and your retail pricing stay with you, and your customer never sees that a partner was involved.",
      },
      {
        q: "Can one order go to two different shops?",
        a: "Yes. Different lines can go to different partners — embroidery to one shop, printing to another — while you quote and bill the customer as a single job. The same line can't go to two shops, so nothing gets produced twice.",
      },
      {
        q: "What does it cost to add partners?",
        a: "Nothing extra. Partnerships are included in the one InkTracker plan, and you can connect with an unlimited number of partner shops.",
      },
    ],
  },

  {
    slug: "live-supplier-pricing",
    title: "Live Supplier Pricing — InkTracker",
    h1: "Quotes that pull today's blank prices",
    metaDescription:
      "InkTracker quotes pull live per-piece garment costs from S&S Activewear, SanMar, and AS Colour at quote time, so a supplier price change can never silently eat your margin.",
    lede:
      "Most shops price off a chart built from what blanks cost the day the chart was made. Then the supplier moves a price, the chart doesn't, and every quote after that quietly gives the difference away. InkTracker asks the supplier what the garment costs while you're building the quote.",
    sections: [
      {
        h2: "Three suppliers, live, per piece",
        paras: [
          "Search S&S Activewear, SanMar, and AS Colour from inside the quote. Pick the style and color, and the current per-piece cost comes back — size upcharges included — using your own supplier account and your pricing. Your markup rules apply on top, so the sell price is built on what the blank costs today, not last spring.",
        ],
      },
      {
        h2: "Your pricing rules do the rest",
        paras: [
          "Set your garment markup, per-color print rates by quantity tier, and setup fees once. Every quote applies them the same way, so two people quoting the same job get the same number, and the number always starts from a real cost.",
        ],
        bullets: [
          "Live per-piece costs with size upcharges at quote time",
          "Your supplier accounts and contract pricing, not list prices",
          "Customer-supplied garments quote cleanly at zero garment cost",
          "One-off products still work — live lookup is a head start, not a requirement",
        ],
      },
      {
        h2: "Why it matters more than it sounds",
        paras: [
          "A fifty-cent blank increase on a 100-piece job is fifty dollars gone if your chart didn't move. Multiply by every job in a season and stale garment costs become one of the quietest ways a shop loses money. Pricing from live cost closes that gap without anyone maintaining a spreadsheet.",
        ],
      },
    ],
    faqs: [
      {
        q: "Which suppliers does InkTracker pull live pricing from?",
        a: "S&S Activewear, SanMar, and AS Colour. Lookups run at quote time using your own supplier credentials, so the costs reflect your account's pricing.",
      },
      {
        q: "Do I need accounts with those suppliers?",
        a: "You connect your own supplier accounts, so the pricing is genuinely yours. Styles can also be added as one-off products with a cost you type in, and customer-supplied garments quote at zero garment cost.",
      },
      {
        q: "What about my existing price chart?",
        a: "Your chart's logic — markup, quantity tiers, per-color rates, setup fees — moves into your pricing settings once. The difference is the garment cost underneath it updates itself.",
      },
    ],
  },

  {
    slug: "know-your-margin",
    title: "Know Your Margin — InkTracker",
    h1: "See what you make before you hit send",
    metaDescription:
      "InkTracker shows your cost and margin on every quote line — including wholesale and subcontracted work — before the quote goes out, so a money-losing job never sneaks through.",
    lede:
      "Plenty of jobs feel profitable at the counter and settle up at break-even. The quote looked fine; the setup fees, the size upcharges, or a wholesale discount ate the rest. InkTracker puts the margin on the screen while you're still deciding, so the decision is made with the number in view.",
    sections: [
      {
        h2: "Margin on the line, not in a report",
        paras: [
          "Every quote line carries its cost — the live blank price, print work by color count and quantity, setup spread across the run — and shows what's left as yours. Discounts and rush fees move the number in front of you. If a price is too low to make money, you find out before the customer does.",
        ],
      },
      {
        h2: "The hard cases are the point",
        paras: [
          "Straight retail jobs are easy to eyeball. The jobs that lose money are the special ones: wholesale orders at broker rates, work you're subcontracting to a partner shop, the deal where you sharpened the pencil twice. InkTracker shows your true cost and take on those lines too — a loss shows up as a loss, not as a smaller win.",
        ],
        bullets: [
          "Per-line cost and margin while quoting",
          "Wholesale and broker pricing shows your real numbers, not the client-facing ones",
          "Subcontracted lines show the partner's price as your cost, with your margin beside it",
          "Saved quotes keep their numbers — the price you approved is the price that bills",
        ],
      },
    ],
    faqs: [
      {
        q: "How do I know if a screen printing job is profitable?",
        a: "Add up the real costs — blanks at today's price, print labor by colors and quantity, setup spread across the run — and compare against the quote before sending it. InkTracker does that math on every line automatically and shows the margin while you quote.",
      },
      {
        q: "Does this work for wholesale and broker orders?",
        a: "Yes, and that's where it earns its keep. Broker and wholesale lines show your actual cost and actual take, so discounted work can't disguise a loss as a thin win.",
      },
      {
        q: "Can the numbers change after I send a quote?",
        a: "Sent quotes keep the numbers they were approved with. Later edits are deliberate and visible, so the price the customer approved is the price that gets billed.",
      },
    ],
  },
]);
