// ─────────────────────────────────────────────────────────────────────────
// Content source for the static comparison pages (public/compare/*.html).
//
// SEPARATION OF CONCERNS: this file is *content*. scripts/generate-compare-
// pages.mjs is the *template/renderer*. Editing copy = edit here, re-run
// `npm run build:content`.
//
// HONESTY RULES (read before editing):
//  - Every InkTracker claim here is verifiable from the product / landing page.
//  - Competitor cells are written conservatively from publicly available info
//    and are POSITIONING, not hard negative claims. Do NOT assert a competitor
//    "cannot" do something unless it's broadly documented. Anything competitor-
//    specific carries `verify: true` somewhere up the chain and is listed in the
//    PR for a human fact-check. `REVIEWED` stamps when that pass last happened.
// ─────────────────────────────────────────────────────────────────────────

export const SITE = Object.freeze({
  name: "InkTracker",
  baseUrl: "https://inktracker.app",
  logo: "https://inktracker.app/icon-512.png",
  price: "$99/mo",
  priceYear: "$999/yr",
  trial: "14-day free trial — no credit card",
  reviewed: "June 2026",
});

// Concrete, verifiable InkTracker differentiators reused across pages.
export const INKTRACKER_EDGE = Object.freeze([
  "One flat price — $99/mo (or $999/yr). One plan, no tiers, unlimited employees.",
  "Two-way QuickBooks Online sync — invoices, payments, and customers stay matched.",
  "Live garment pricing pulled straight from S&S Activewear and AS Colour as you quote.",
  "An embeddable quote wizard so customers build their own orders on your site, 24/7.",
  "A broker portal that auto-applies the markup share you set per reseller.",
  "Built by a screen printer — production tracking, shop-floor view, and artwork proofs included.",
]);

// Shared comparison rows. `it` = InkTracker (verifiable). `comp` is keyed by
// competitor slug; values are conservative and flagged for human review.
// "—" means "not a documented focus / not advertised" — never "impossible".
const ROW = (feature, it, comp) => ({ feature, it, comp });

export const PAGES = [
  {
    slug: "inktracker-vs-printavo",
    competitor: "Printavo",
    competitorUrl: "https://www.printavo.com",
    title: "InkTracker vs Printavo — Screen Printing Software Compared (2026)",
    metaDescription:
      "InkTracker vs Printavo: a fair, up-to-date comparison of pricing, QuickBooks sync, live garment pricing, and production tools for screen printing shops.",
    h1: "InkTracker vs Printavo",
    intro: [
      "Printavo is one of the best-known names in screen-printing shop management — a web-based platform for quoting, scheduling, online approvals, and invoicing, now part of the Inktavo family of brands. If you've shopped for print-shop software, you've heard of it.",
      "InkTracker covers the same core jobs — quoting, production, invoicing — with a different bet: one transparent price, live supplier pricing baked into every quote, and a two-way QuickBooks Online sync. Here's an honest side-by-side so you can decide which fits your shop.",
    ],
    competitorGood:
      "Printavo is established, widely used, and battle-tested. Its calendar-driven scheduling and online approval flow are popular with growing shops, and being part of Inktavo means it sits alongside web-store and design tools.",
    table: [
      ROW("Pricing", `${SITE.price} flat · ${SITE.priceYear}`, "Quote-based (Inktavo bundles)"),
      ROW("Free trial", SITE.trial, "Demo / sales call"),
      ROW("Plan tiers", "One plan, everything included", "Bundled / tiered"),
      ROW("Two-way QuickBooks Online sync", "✓ Invoices, payments, customers", "QuickBooks integration available"),
      ROW("Live garment pricing (S&S + AS Colour)", "✓ Built into quoting", "—"),
      ROW("Embeddable quote wizard", "✓ Customer self-serve on your site", "Online stores / quote requests"),
      ROW("Broker / reseller portal", "✓ Per-broker markup share", "—"),
      ROW("Production tracking + shop-floor view", "✓ Included", "✓ Calendar scheduling"),
      ROW("Artwork proofs + approvals", "✓ Included", "✓ Online approvals"),
      ROW("Unlimited employees", "✓ At one price", "Varies by plan"),
    ],
    faqs: [
      {
        q: "Is InkTracker a Printavo alternative?",
        a: "Yes. InkTracker handles the same core workflow — quoting, production, invoicing — with a single flat price, live S&S/AS Colour garment pricing, and a two-way QuickBooks Online sync. Many shops evaluate the two side by side.",
      },
      {
        q: "How much does InkTracker cost compared to Printavo?",
        a: "InkTracker is a flat $99/mo (or $999/yr) with every feature and unlimited employees included, and a 14-day free trial with no credit card. Printavo's pricing is quote-based as part of the Inktavo bundle — check their site for a current number.",
      },
      {
        q: "Does InkTracker sync with QuickBooks?",
        a: "Yes — InkTracker has a two-way QuickBooks Online sync that keeps invoices, payments, and customers matched, so your books reflect exactly what you sent.",
      },
    ],
  },

  {
    slug: "inktracker-vs-yoprint",
    competitor: "YoPrint",
    competitorUrl: "https://www.yoprint.com",
    title: "InkTracker vs YoPrint — Screen Printing Software Compared (2026)",
    metaDescription:
      "InkTracker vs YoPrint: pricing, QuickBooks sync, live garment pricing, broker tools, and production features compared for print shops.",
    h1: "InkTracker vs YoPrint",
    intro: [
      "YoPrint is a modern, production-focused shop management platform with a strong QuickBooks story and published pricing — a frequent shortlist pick for shops that want clean order and production management.",
      "InkTracker and YoPrint overlap heavily on QuickBooks and production. Where InkTracker leans in: live garment pricing from S&S and AS Colour inside the quote, an embeddable customer wizard, a broker portal, and a single flat price with everything on.",
    ],
    competitorGood:
      "YoPrint is well-built and modern, with solid production management and a QuickBooks integration shops like. Its published pricing (including a free starting tier) makes it easy to try.",
    table: [
      ROW("Pricing", `${SITE.price} flat · ${SITE.priceYear}`, "Tiered (free tier available)"),
      ROW("Free trial / tier", SITE.trial, "Free tier + paid plans"),
      ROW("Two-way QuickBooks Online sync", "✓ Invoices, payments, customers", "✓ QuickBooks integration"),
      ROW("Live garment pricing (S&S + AS Colour)", "✓ Built into quoting", "Supplier catalogs"),
      ROW("Embeddable quote wizard", "✓ Customer self-serve on your site", "Online order forms"),
      ROW("Broker / reseller portal", "✓ Per-broker markup share", "—"),
      ROW("Production tracking + shop-floor view", "✓ Included", "✓ Production management"),
      ROW("Artwork proofs + approvals", "✓ Included", "✓ Approvals"),
      ROW("Unlimited employees", "✓ At one price", "Varies by tier"),
    ],
    faqs: [
      {
        q: "Is InkTracker or YoPrint cheaper?",
        a: "It depends on your size. InkTracker is a flat $99/mo with unlimited employees and every feature included. YoPrint is tiered with a free starting plan, so very small shops may start lower, while costs can rise with seats and features.",
      },
      {
        q: "Do both sync with QuickBooks Online?",
        a: "Yes — both integrate with QuickBooks Online. InkTracker's sync is two-way across invoices, payments, and customers so the books mirror what you sent.",
      },
      {
        q: "What does InkTracker do that's different?",
        a: "Live garment pricing from S&S and AS Colour inside quoting, an embeddable customer-facing quote wizard, and a broker portal that auto-applies a per-reseller markup share.",
      },
    ],
  },

  {
    slug: "inktracker-vs-inksoft",
    competitor: "InkSoft",
    competitorUrl: "https://www.inksoft.com",
    title: "InkTracker vs InkSoft — Screen Printing Software Compared (2026)",
    metaDescription:
      "InkTracker vs InkSoft: online stores vs end-to-end shop management. Compare pricing, QuickBooks sync, quoting, and production for print shops.",
    h1: "InkTracker vs InkSoft",
    intro: [
      "InkSoft (also part of Inktavo) is best known for selling — online stores, fundraising, group ordering, and the sales tools that help shops put apparel in front of customers and take orders online.",
      "InkTracker's focus is the other half of the shop: turning those orders into quotes, production, and paid invoices, with a two-way QuickBooks sync. If your gap is operations rather than storefronts, that's the contrast that matters.",
    ],
    competitorGood:
      "InkSoft shines at the front of the funnel: customizable online stores, group/fundraising stores, and sales tooling. For shops whose priority is selling online, that's its strength.",
    table: [
      ROW("Pricing", `${SITE.price} flat · ${SITE.priceYear}`, "Quote-based (Inktavo)"),
      ROW("Free trial", SITE.trial, "Demo / sales call"),
      ROW("Primary focus", "End-to-end shop operations", "Online stores & sales"),
      ROW("Two-way QuickBooks Online sync", "✓ Invoices, payments, customers", "—"),
      ROW("Live garment pricing (S&S + AS Colour)", "✓ Built into quoting", "—"),
      ROW("Quoting → production → invoicing", "✓ One workflow", "Stores / order intake"),
      ROW("Broker / reseller portal", "✓ Per-broker markup share", "Online stores"),
      ROW("Embeddable quote wizard", "✓ Customer self-serve on your site", "✓ Online stores"),
      ROW("Unlimited employees", "✓ At one price", "Varies by plan"),
    ],
    faqs: [
      {
        q: "Is InkTracker a replacement for InkSoft?",
        a: "They solve different halves of the shop. InkSoft is strongest at online stores and selling; InkTracker is built for operations — quoting, production, invoicing, and QuickBooks sync. Some shops use a storefront tool for sales and InkTracker to run the work.",
      },
      {
        q: "Does InkTracker have online stores?",
        a: "InkTracker offers an embeddable quote wizard and customer quote requests rather than full e-commerce storefronts. Its strength is turning orders into produced, invoiced, paid jobs.",
      },
    ],
  },

  {
    slug: "inktracker-vs-deconetwork",
    competitor: "DecoNetwork",
    competitorUrl: "https://www.deconetwork.com",
    title: "InkTracker vs DecoNetwork — Screen Printing Software Compared (2026)",
    metaDescription:
      "InkTracker vs DecoNetwork: an all-in-one web-to-print suite vs focused, flat-priced shop management. Compare pricing, QuickBooks, and production.",
    h1: "InkTracker vs DecoNetwork",
    intro: [
      "DecoNetwork is an all-in-one web-to-print suite — online stores, a design studio, and business management bundled together, typically on tiered pricing. It's a lot of platform for shops that want everything under one roof.",
      "InkTracker is the opposite trade-off: a focused operations tool at one flat price, with live supplier pricing and a two-way QuickBooks Online sync. If you don't need a full web-to-print suite, the lighter, cheaper path can be the right one.",
    ],
    competitorGood:
      "DecoNetwork is comprehensive — storefronts, an online designer, and production/business tools in one suite. For shops that want a single all-in-one with web-to-print, that breadth is the draw.",
    table: [
      ROW("Pricing", `${SITE.price} flat · ${SITE.priceYear}`, "Tiered (suite plans)"),
      ROW("Free trial", SITE.trial, "Trial / demo"),
      ROW("Scope", "Focused shop operations", "All-in-one web-to-print suite"),
      ROW("Two-way QuickBooks Online sync", "✓ Invoices, payments, customers", "Accounting integrations"),
      ROW("Live garment pricing (S&S + AS Colour)", "✓ Built into quoting", "Supplier catalogs"),
      ROW("Embeddable quote wizard", "✓ Customer self-serve on your site", "✓ Stores + designer"),
      ROW("Broker / reseller portal", "✓ Per-broker markup share", "—"),
      ROW("Production tracking + shop-floor view", "✓ Included", "✓ Business tools"),
      ROW("Setup complexity", "Sign up and quote same day", "Suite onboarding"),
    ],
    faqs: [
      {
        q: "Is InkTracker simpler than DecoNetwork?",
        a: "Generally yes. DecoNetwork is an all-in-one web-to-print suite; InkTracker is a focused operations tool you can sign up for and quote from the same day, at one flat price.",
      },
      {
        q: "Do I lose features by choosing InkTracker?",
        a: "If you need full e-commerce storefronts and an online design studio, a suite like DecoNetwork covers more. If your priority is quoting, production, invoicing, and QuickBooks, InkTracker covers that for less and with less setup.",
      },
    ],
  },
];

// Pillar / listicle page — targets the high-intent "printavo alternatives" query.
export const PILLAR = Object.freeze({
  slug: "printavo-alternatives",
  title: "Printavo Alternatives for Screen Printing Shops (2026)",
  metaDescription:
    "Looking for a Printavo alternative? An honest 2026 rundown of screen-printing shop software — InkTracker, YoPrint, InkSoft, DecoNetwork — by price, QuickBooks, and focus.",
  h1: "Printavo Alternatives for Screen Printing Shops",
  intro: [
    "Printavo is a solid, well-known platform — but it isn't the only way to run a print shop, and shops look for alternatives for all kinds of reasons: pricing, QuickBooks needs, supplier pricing, or just a different fit.",
    "Here's an honest look at the leading options as of June 2026. Details change — always confirm current pricing and features on each vendor's own site.",
  ],
  options: [
    {
      name: "InkTracker",
      url: "https://inktracker.app/",
      pitch:
        "Flat $99/mo, everything included. Live garment pricing from S&S and AS Colour inside quoting, a two-way QuickBooks Online sync, an embeddable customer quote wizard, and a broker portal. Built by a screen printer for running the shop end to end.",
      bestFor: "Shops that want transparent pricing and tight QuickBooks + supplier integration.",
    },
    {
      name: "YoPrint",
      url: "https://www.yoprint.com",
      pitch:
        "Modern, production-focused management with a QuickBooks integration and published tiered pricing (including a free starting tier).",
      bestFor: "Shops that want clean production management and a free way to start.",
    },
    {
      name: "InkSoft",
      url: "https://www.inksoft.com",
      pitch:
        "Part of Inktavo; strongest at online stores, group/fundraising stores, and sales tools for selling apparel online.",
      bestFor: "Shops whose priority is selling online and group ordering.",
    },
    {
      name: "DecoNetwork",
      url: "https://www.deconetwork.com",
      pitch:
        "An all-in-one web-to-print suite — storefronts, an online designer, and business tools bundled on tiered plans.",
      bestFor: "Shops that want a single all-in-one platform with web-to-print.",
    },
  ],
});
