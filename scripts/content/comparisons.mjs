// ─────────────────────────────────────────────────────────────────────────
// Content source for the static buyer's-guide page (public/compare/index.html).
//
// FRAMING (deliberate, 2026-06-28): a NEUTRAL buyer's guide — "how to choose
// screen-printing software" + a fair landscape roundup. No head-to-head
// "vs <company>" pages, no "<company> alternatives". Competitors are named
// respectfully as valid options; InkTracker is listed as one honest choice
// among them (alphabetical order, same neutral format for everyone).
//
// HONESTY RULES (read before editing):
//  - Every InkTracker claim is verifiable from the product / landing page.
//  - Competitor blurbs are POSITIVE and fair — describe what each is good at,
//    never a negative/"can't do" claim. Anything competitor-specific gets a
//    human fact-check (see PR). `REVIEWED` stamps when that last happened.
//
// SEPARATION OF CONCERNS: this file is *content*. scripts/generate-compare-
// pages.mjs is the *renderer*. Editing copy = edit here, re-run
// `npm run build:content`.
// ─────────────────────────────────────────────────────────────────────────

export const SITE = Object.freeze({
  name: "InkTracker",
  baseUrl: "https://inktracker.app",
  logo: "https://inktracker.app/icon-512.png",
  price: "$99/mo",
  priceYear: "$999/yr",
  trial: "14-day free trial",
  reviewed: "June 2026",
});

export const GUIDE = Object.freeze({
  url: `${SITE.baseUrl}/compare`,
  title: "Choosing Screen Printing Software: A 2026 Buyer's Guide",
  metaDescription:
    "How to choose screen-printing shop software in 2026 — pricing, QuickBooks sync, live garment pricing, and production tools — with a fair look at the leading options.",
  h1: "Choosing Screen Printing Software",
  intro: [
    "There's no single \"best\" screen-printing software — the right fit depends on how your shop runs, what you already use for accounting, and how much you want to spend. This is a neutral guide to help you decide, not a sales pitch.",
    "Below: the things worth weighing before you commit, then a fair rundown of the leading options as of June 2026 (InkTracker included). Details and pricing change — always confirm the current specifics on each vendor's own site.",
  ],

  // What to look for — neutral, helpful criteria (no "X lacks this").
  criteria: [
    {
      name: "Transparent pricing",
      why: "Some tools publish a flat price; others are tiered or quote-based bundles. Know what you'll actually pay at your size, including per-seat costs, before you commit.",
    },
    {
      name: "Accounting / QuickBooks sync",
      why: "If you run QuickBooks, a two-way sync that keeps invoices, payments, and customers matched saves hours and keeps your books accurate. Check whether the sync is one-way or two-way.",
    },
    {
      name: "Live garment & supplier pricing",
      why: "Pulling current blank prices straight from suppliers (e.g. S&S Activewear, AS Colour) as you quote means your margins reflect real costs, not stale numbers.",
    },
    {
      name: "Production tracking & shop floor",
      why: "A visual pipeline from art approval to shipping — and a mobile view your team can update from the floor — keeps jobs moving and everyone on the same page.",
    },
    {
      name: "Online quoting for customers",
      why: "An embeddable quote form or store lets customers start orders on your site 24/7, instead of every job beginning with an email.",
    },
    {
      name: "Broker / reseller support",
      why: "If you take work from resellers, look for per-reseller pricing and a portal so their orders come in correctly priced without manual math.",
    },
    {
      name: "Support, onboarding & fit",
      why: "Consider who the tool is built for, how fast you can get running, and whether you'll lean on storefronts, production, or selling — the best fit matches your actual workflow.",
    },
  ],

  // The landscape — alphabetical, fair, positive blurbs for each (incl. us).
  landscape: [
    {
      name: "DecoNetwork",
      url: "https://www.deconetwork.com",
      blurb:
        "An all-in-one web-to-print suite: online stores, an online design studio, and business-management tools bundled together on tiered plans.",
      bestFor: "Shops that want a single all-in-one platform with web-to-print built in.",
    },
    {
      name: "InkSoft",
      url: "https://www.inksoft.com",
      blurb:
        "Part of the Inktavo family, strongest at the front of the funnel — customizable online stores, group and fundraising stores, and sales tools for selling apparel online.",
      bestFor: "Shops whose priority is selling online and group ordering.",
    },
    {
      name: "InkTracker",
      url: "https://inktracker.app/",
      blurb:
        "A focused operations tool at one flat price ($99/mo, everything included): live garment pricing from S&S and AS Colour inside quoting, a two-way QuickBooks Online sync, an embeddable customer quote wizard, a broker portal, and production/shop-floor tracking. Built by a screen printer.",
      bestFor: "Shops that want transparent pricing with tight QuickBooks + supplier integration.",
    },
    {
      name: "Printavo",
      url: "https://www.printavo.com",
      blurb:
        "One of the best-known names in the space (now part of Inktavo) — established, widely used, with calendar-driven scheduling, online approvals, quoting, and invoicing.",
      bestFor: "Shops that want a proven, broadly-adopted platform with strong scheduling.",
    },
    {
      name: "YoPrint",
      url: "https://www.yoprint.com",
      blurb:
        "A modern, production-focused platform with a QuickBooks integration and published tiered pricing, including a free tier to start.",
      bestFor: "Shops that want clean production management and a free way to try it.",
    },
  ],

  faqs: [
    {
      q: "What's the best screen printing software?",
      a: "There isn't one universal best — it depends on your shop. Weigh pricing, whether it syncs with your accounting (e.g. QuickBooks), whether it pulls live supplier pricing, and whether your priority is production, online stores, or selling. Tools like Printavo, YoPrint, InkSoft, DecoNetwork, and InkTracker each fit different shops.",
    },
    {
      q: "How much does screen printing software cost?",
      a: "It ranges widely — from free starter tiers to tiered or quote-based bundles, depending on features and seats. InkTracker, for example, is a flat $99/mo (or $999/yr) with everything and unlimited employees included, plus a 14-day free trial. Always confirm current pricing on each vendor's site.",
    },
    {
      q: "Does the software need to sync with QuickBooks?",
      a: "If you run QuickBooks, a two-way sync that keeps invoices, payments, and customers matched is a big time-saver and keeps your books accurate. Several platforms integrate with QuickBooks; InkTracker's sync is two-way across invoices, payments, and customers.",
    },
    {
      q: "Can customers request quotes online?",
      a: "Many tools offer online stores or quote forms so customers can start orders 24/7. InkTracker provides an embeddable quote wizard you can drop onto your own site.",
    },
  ],
});
