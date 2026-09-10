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

// QuickBooks ProAdvisor pass-through offer. InkTracker is a certified
// QuickBooks ProAdvisor, so a shop setting up QuickBooks Online can get the
// client-billed Direct Discount: 30% off their FIRST 12 MONTHS, then standard
// pricing (Intuit bills the shop, not us — zero cost to InkTracker). Copy
// stays honest about the "first year" limit. Fulfillment is manual for now:
// the shop emails support and we add them under our ProAdvisor discount.
export const QB_PARTNER = Object.freeze({
  eyebrow: "Certified QuickBooks ProAdvisor",
  title: "Setting up QuickBooks? Get 30% off your first year through us.",
  body:
    "InkTracker syncs your quotes, invoices, and payments straight to QuickBooks Online — no double entry. And because we're a certified QuickBooks ProAdvisor, if you're getting QuickBooks Online we can knock 30% off your first 12 months.",
  note: "Already on QuickBooks? The sync works the same. Discount applies to new QuickBooks Online setups — 30% off for the first year, then standard pricing.",
  cta: "Ask us to set it up",
  ctaHref: "mailto:support@inktracker.app?subject=QuickBooks%20ProAdvisor%20discount&body=I'd%20like%20the%2030%25%20QuickBooks%20discount%20through%20InkTracker.",
});

// "Switch to InkTracker" concierge offer — the real value is free SETUP
// (pricing dialed in, QuickBooks connected, first quote built), NOT a full
// data migration. From Printavo only the customer LIST imports (a CSV), which
// overlaps with what connecting QuickBooks already pulls — so the copy leads
// with setup and mentions the customer import as a small, honest bonus. The
// Printavo name stays because "leaving Printavo" is the switch intent the
// first-month-free deal targets. Fulfillment is human: the shop emails us and
// we set them up + comp month one. (Checkout supports promo codes too, so a
// self-serve "first month free" code can be enabled in Stripe if wanted.)
export const SWITCH_OFFER = Object.freeze({
  eyebrow: "Coming from Printavo?",
  title: "We'll get you set up — free.",
  body:
    "We'll dial in your pricing, connect your QuickBooks, and build your first quote with you, so you're running on real jobs in a day. Bring your customer list over from Printavo in a couple of clicks.",
  printavoLine: "Switching from Printavo? Your first month is on us.",
  cta: "Get set up",
  ctaHref: "mailto:support@inktracker.app?subject=Switching%20to%20InkTracker&body=I'm%20switching%20from%20Printavo%20(or%20a%20spreadsheet)%20and%20I'd%20like%20help%20getting%20set%20up.%20My%20current%20setup%20is%3A%20",
});

export const FAQ_ITEMS = Object.freeze([
  { q: "Can I bring my data over from Printavo or another shop tool?", a: "Your customer list, yes — export it and our importer maps the columns and skips duplicates automatically. For quotes and jobs, we help you get your active work set up (older history stays in your old tool for reference). And we'll dial in your pricing and connect QuickBooks with you, free — usually done in a day. Switching from Printavo? Your first month is on us." },
  { q: "Does this work for embroidery shops, or only screen printing?", a: "Both. Quote-to-invoice, customer management, production tracking, and QuickBooks sync work the same for either method. We're focused on screen print and embroidery to start — other decoration methods aren't on the v1 roadmap." },
  { q: "Do I need QuickBooks — and can I get a discount?", a: "You don't need it to use InkTracker, but the QuickBooks Online sync — quotes, invoices, and payments with no double entry — is one of the best parts. We're a certified QuickBooks ProAdvisor, so if you're setting up QuickBooks Online we can get you 30% off your first year. Already on QuickBooks? The sync works exactly the same. Email support@inktracker.app to set up the discount." },
  { q: "What happens to my data if I cancel?", a: "Yours, always. Export everything — customers, quotes, orders, invoices — as CSV at any time, including the moment of cancellation." },
  { q: "Is there a long-term contract?", a: "No. Month-to-month, cancel anytime." },
  { q: "How do I know InkTracker won't disappear in six months?", a: "Biota Mfg has been printing in the Reno/Tahoe area for ten years and we run the shop on InkTracker daily. If it stops being maintained, our own production stops. The financial structure also funds long-horizon land-conservation work — both keep this project on a multi-year commitment." },
  { q: "How does the conservation contribution actually work?", a: "A piece of every subscription is allocated to a long-term land-conservation fund operated by Biota Mfg. The full five-year plan — how funds are set aside, deployed, and reported — lives at biotamfg.com/pages/wildways." },
]);
