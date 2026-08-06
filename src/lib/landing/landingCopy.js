// Landing-page copy shared by TWO consumers:
//   1. src/App.jsx — the live React landing page renders from these arrays
//   2. scripts/generate-landing-static.mjs — bakes the same copy into a
//      static, crawlable HTML block inside index.html's #root (replaced the
//      moment React boots)
//
// Single source so the static snapshot can never drift from the rendered
// page — same-content-both-ways is also what keeps the prerender honest
// (crawlers see what visitors see, not a keyword-stuffed shadow page).
// Pure data, no imports: the generator loads this under plain Node.

export const HERO = Object.freeze({
  // Matches the typewriter lines (lib/landing/typewriter.js) + hero section.
  h1: "Run your shop without the chaos.",
  sub: "InkTracker is shop management software for screen printing and embroidery shops — quotes, production, invoicing, and QuickBooks sync in one place. By printers, for printers.",
  trialLine: "14-day free trial · no card required · cancel anytime",
});

export const VALUE_PROPS = Object.freeze([
  {
    num: "01",
    title: "Run your shop",
    body: "Quote → production → invoice → paid. The whole job, one app — built around how a real shop runs.",
    cta: "See features",
    href: "#tour",
  },
  {
    num: "02",
    title: "Pricing that works",
    body: "Live garment costs from S&S and AS Colour, per-imprint setups, shortfalls, broker margins — handled.",
    cta: "How it works",
    href: "#how-pricing",
  },
  {
    num: "03",
    title: "Built for a mission",
    body: "Every subscription helps fund the land-conservation work we do through Biota's Wildways program.",
    cta: "Learn more",
    href: "#wildways",
  },
]);

export const PRICING_INCLUDES = Object.freeze([
  "Quotes & orders", "Production tracking",
  "Invoicing & payments", "QuickBooks Online sync",
  "Live garment pricing", "Unlimited employees",
  "Embeddable quote wizard", "Broker portal",
  "Artwork proofs", "Performance reports",
]);

export const PRICING = Object.freeze({
  price: "$99",
  per: "/mo",
  annualLine: "Or $999/year — saves $189. 14-day free trial, no card required.",
});

export const FAQ_ITEMS = Object.freeze([
  { q: "Can I import data from Printavo, Shopworks, or another shop tool?", a: "Not via a self-serve CSV upload yet — but email support@inktracker.app with an export from your old platform and we'll port your customers, quotes, or orders over manually. Self-serve import is on the roadmap." },
  { q: "Does this work for embroidery shops, or only screen printing?", a: "Both. Quote-to-invoice, customer management, production tracking, and QuickBooks sync work the same for either method. We're focused on screen print and embroidery to start — other decoration methods aren't on the v1 roadmap." },
  { q: "What happens to my data if I cancel?", a: "Yours, always. Export everything — customers, quotes, orders, invoices — as CSV at any time, including the moment of cancellation." },
  { q: "Is there a long-term contract?", a: "No. Month-to-month, cancel anytime." },
  { q: "How do I know InkTracker won't disappear in six months?", a: "Biota Mfg has been printing in the Reno/Tahoe area for ten years and we run the shop on InkTracker daily. If it stops being maintained, our own production stops. The financial structure also funds long-horizon land-conservation work — both keep this project on a multi-year commitment." },
  { q: "How does the conservation contribution actually work?", a: "A piece of every subscription is allocated to a long-term land-conservation fund operated by Biota Mfg. The full five-year plan — how funds are set aside, deployed, and reported — lives at biotamfg.com/pages/wildways." },
]);
