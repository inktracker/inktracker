import { useEffect, useMemo, useState, useRef } from "react";
import { supabase } from "@/api/supabaseClient";
import ErrorBoundary from "@/components/ErrorBoundary";
import { Toaster } from "@/components/ui/toaster";
import Privacy from "./pages/Privacy.jsx";
import Terms from "./pages/Terms.jsx";
import Changelog from "./pages/Changelog.jsx";
import Security from "./pages/Security.jsx";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClientInstance } from "@/lib/query-client";
import { pagesConfig } from "./pages.config";
import { BrowserRouter as Router, Route, Routes, useLocation } from "react-router-dom";
import PageNotFound from "./lib/PageNotFound";
import { AuthProvider, useAuth } from "@/lib/AuthContext";
import LoginModal from "@/components/LoginModal";
import OnboardingWizard from "@/components/OnboardingWizard";

const { Pages, Layout, mainPage } = pagesConfig;

const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const INKTRACKER_LOGO =
  "https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/69aa650fd3e825e66ff81817/b4e2dc53f_logo.png";

const PUBLIC_PAGE_NAMES = [
  "BrokerDashboard",
  "BrokerOnboarding",
  "QuotePayment",
  "QuotePaymentSuccess",
  "QuotePaymentCancel",
  "QuoteRequest",
  "ArtApproval",
  "OrderStatus",
  "ShopFloor",
  "privacy",
  "terms",
  "changelog",
  "security",
];

const PUBLIC_PATHS = new Set(
  PUBLIC_PAGE_NAMES.flatMap((pageName) => [
    `/${pageName}`.toLowerCase(),
    `/${pageName.replace(/ /g, "-")}`.toLowerCase(),
  ])
);

const LayoutWrapper = ({ children, currentPageName }) =>
  Layout ? (
    <Layout currentPageName={currentPageName}>{children}</Layout>
  ) : (
    <>{children}</>
  );

// Feature catalog with optional media for the preview modal.
//
// Each card opens a modal showing either a static screenshot (media.type
// === "image") or a short looping demo video (media.type === "video").
// When media is null the modal renders a placeholder — TODO comments below
// note the recommended asset for each feature and the expected path under
// /public/landing/. Either asset type is acceptable per card; videos should
// be 6–10 second muted loops, MP4 + WebM, ~16:9, kept small (< 2 MB).
const FEATURE_CARDS = [
  {
    title: "Quotes & Orders",
    desc: "Build quotes with live garment pricing from S&S and AS Colour. Convert to orders with one click.",
    color: "from-indigo-500/20 to-indigo-500/5",
    // 23.5-second animated demo: a quote being built from scratch through
    // customer select, garment style autofill, size breakdown, print
    // location, live pricing count-up, and save → new row in the list.
    // Built from the design handoff at public/landing/quote-demo/.
    media: { type: "iframe", src: "/landing/quote-demo/index.html" },
  },
  {
    title: "Production Tracking",
    desc: "Visual pipeline from art approval to shipping. Your team updates progress from any device.",
    color: "from-violet-500/20 to-violet-500/5",
    // TODO: Production kanban with order cards moving through statuses.
    // Demo recommended (short drag-between-columns loop).
    // Screenshot path: /public/landing/feature-production.png
    // Demo path:       /public/landing/feature-production.mp4
    media: null,
  },
  {
    title: "Invoicing & Payments",
    desc: "Generate invoices, sync to QuickBooks, and send payment links directly to customers.",
    color: "from-emerald-500/20 to-emerald-500/5",
    // TODO: Invoice detail view with "Send to Customer" + Stripe payment link.
    // Screenshot path: /public/landing/feature-invoicing.png
    media: null,
  },
  {
    title: "Customer Management",
    desc: "Track customer history, artwork files, tax status, and payment terms. Auto-merge duplicates.",
    color: "from-blue-500/20 to-blue-500/5",
    // TODO: Customer detail panel with order history + tax-exempt flag visible.
    // Screenshot path: /public/landing/feature-customers.png
    media: null,
  },
  {
    title: "Inventory & Restock",
    desc: "Shopify inventory sync. Order blanks from S&S Activewear and AS Colour with live pricing.",
    color: "from-amber-500/20 to-amber-500/5",
    // TODO: Inventory page with low-stock badges + restock CTA.
    // Screenshot path: /public/landing/feature-inventory.png
    media: null,
  },
  {
    title: "Quote Wizard",
    desc: "Embed a quote request form on your website. Customers build orders 24/7 and you get notified.",
    color: "from-rose-500/20 to-rose-500/5",
    // TODO: The customer-facing wizard mid-flow (color/qty/imprint selection).
    // Demo recommended (short scroll-through loop).
    // Screenshot path: /public/landing/feature-wizard.png
    // Demo path:       /public/landing/feature-wizard.mp4
    media: null,
  },
  {
    title: "Broker Integration",
    desc: "Resellers submit their clients' orders through their own portal. Broker pricing and commissions tracked automatically.",
    color: "from-teal-500/20 to-teal-500/5",
    // TODO: Broker Dashboard view — assigned shops list, recent submitted
    // orders, commission summary at the top. Also worth: a side-by-side
    // showing the broker's portal vs the shop's incoming-quote view so it's
    // clear how the two sides connect.
    // Screenshot path: /public/landing/feature-broker.png
    // Demo path:       /public/landing/feature-broker.mp4 (recommended —
    //                   short loop of a broker submitting → shop receiving)
    media: null,
  },
  {
    title: "Shop Floor",
    desc: "Tablet-ready view for employees. Job tickets, checklists, and real-time production updates.",
    color: "from-orange-500/20 to-orange-500/5",
    // TODO: Shop Floor view on a tablet (or 4:3 framing). Show job ticket + checklist.
    // Screenshot path: /public/landing/feature-shopfloor.png
    media: null,
  },
  {
    title: "Mockup Designer",
    desc: "Place artwork on garment templates. Background removal, one-color conversion, and PDF proofs.",
    color: "from-purple-500/20 to-purple-500/5",
    // TODO: Mockup canvas with artwork placed on a tee template.
    // Screenshot path: /public/landing/feature-mockups.png
    media: null,
  },
];

// Modal for previewing a feature. Shows feature.media (image or video) or a
// placeholder if media isn't supplied yet. Closes on backdrop click, X
// button, or Escape. Locks body scroll while open.
function FeaturePreviewModal({ feature, onClose }) {
  useEffect(() => {
    if (!feature) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [feature, onClose]);

  if (!feature) return null;
  const media = feature.media;

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 sm:p-8 animate-in fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${feature.title} preview`}
    >
      <div
        className="bg-slate-900 border border-white/10 rounded-2xl max-w-5xl w-full overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div>
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-0.5">Preview</div>
            <h3 className="text-lg font-bold text-white">{feature.title}</h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close preview"
            className="text-slate-400 hover:text-white text-2xl leading-none w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/5 transition"
          >
            ×
          </button>
        </div>

        <div className="bg-slate-800/60 flex items-center justify-center" style={{ aspectRatio: "16 / 9" }}>
          {media?.type === "image" && (
            <img src={media.src} alt={media.alt || `${feature.title} screenshot`} className="w-full h-full object-cover" />
          )}
          {media?.type === "video" && (
            <video
              src={media.src}
              autoPlay
              loop
              muted
              playsInline
              className="w-full h-full object-cover"
              aria-label={`${feature.title} demo`}
            />
          )}
          {media?.type === "iframe" && (
            <iframe
              src={media.src}
              title={`${feature.title} interactive demo`}
              className="w-full h-full border-0"
              loading="lazy"
              // sandbox keeps the embedded React demo from accessing the
              // parent page; allow-scripts + allow-same-origin are needed
              // for the demo's localStorage playhead + Babel JSX compile.
              sandbox="allow-scripts allow-same-origin"
            />
          )}
          {!media && (
            <div className="text-slate-500 text-sm font-medium">
              Preview — to be supplied
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-white/10">
          <p className="text-sm text-slate-300 leading-relaxed">{feature.desc}</p>
        </div>
      </div>
    </div>
  );
}

// Hero headline animated as a typewriter — line 1 in white, brief pause,
// line 2 in indigo, then a slow blinking cursor parked at the end. Single
// keystroke is ~55ms, line break is 350ms. After typing finishes, the
// cursor keeps blinking so the hero never goes fully static.
function TypewriterHeadline() {
  const LINE1 = "Run your print shop";
  const LINE2 = "without the chaos.";
  const KEY_MS = 55;
  const PAUSE_MS = 350;

  const [shown1, setShown1] = useState("");
  const [shown2, setShown2] = useState("");
  const [phase, setPhase] = useState("line1"); // line1 → pause → line2 → done
  const [blink, setBlink] = useState(true);

  useEffect(() => {
    if (phase === "line1") {
      if (shown1.length < LINE1.length) {
        const t = setTimeout(() => setShown1(LINE1.slice(0, shown1.length + 1)), KEY_MS);
        return () => clearTimeout(t);
      }
      const t = setTimeout(() => setPhase("line2"), PAUSE_MS);
      return () => clearTimeout(t);
    }
    if (phase === "line2") {
      if (shown2.length < LINE2.length) {
        const t = setTimeout(() => setShown2(LINE2.slice(0, shown2.length + 1)), KEY_MS);
        return () => clearTimeout(t);
      }
      setPhase("done");
    }
  }, [phase, shown1, shown2]);

  useEffect(() => {
    const t = setInterval(() => setBlink((b) => !b), 520);
    return () => clearInterval(t);
  }, []);

  const cursorOnLine2 = phase === "line2" || phase === "done";

  // Reserve vertical space so the page doesn't reflow while typing.
  // Two lines × responsive line-height roughly matches the headline height.
  return (
    <div className="mb-6" aria-label={`${LINE1} ${LINE2}`}>
      <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold leading-tight tracking-tight text-white min-h-[1.1em]">
        {shown1}
        {!cursorOnLine2 && (
          <span
            className={`inline-block w-[3px] md:w-[4px] h-[0.85em] align-[-0.1em] ml-1 bg-indigo-400 rounded-sm ${blink ? "opacity-100" : "opacity-0"}`}
            aria-hidden="true"
          />
        )}
      </h1>
      <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold leading-tight tracking-tight bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent min-h-[1.1em]">
        {shown2}
        {cursorOnLine2 && (
          <span
            className={`inline-block w-[3px] md:w-[4px] h-[0.85em] align-[-0.1em] ml-1 bg-indigo-400 rounded-sm ${blink ? "opacity-100" : "opacity-0"}`}
            aria-hidden="true"
          />
        )}
      </h1>
    </div>
  );
}

function PublicLandingPage() {
  const [showLogin, setShowLogin] = useState(false);
  const [loginMode, setLoginMode] = useState("signin");
  const [previewFeature, setPreviewFeature] = useState(null);

  function openSignup() { setLoginMode("signup"); setShowLogin(true); }
  function openLogin() { setLoginMode("signin"); setShowLogin(true); }

  return (
    <>
      <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-indigo-950 text-white">
        {/* Nav */}
        <nav className="fixed top-0 left-0 right-0 z-50 bg-slate-950/80 backdrop-blur-lg border-b border-white/5">
          <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <img src={INKTRACKER_LOGO} alt="InkTracker" className="w-8 h-8 rounded-lg" />
              <span className="text-lg font-bold">InkTracker</span>
            </div>
            <div className="flex items-center gap-4">
              <a href="#features" className="text-sm text-slate-400 hover:text-white transition hidden md:block">Features</a>
              <a href="#pricing" className="text-sm text-slate-400 hover:text-white transition hidden md:block">Pricing</a>
              <a href="#conservation" className="text-sm text-slate-400 hover:text-white transition hidden md:block">Mission</a>
              <button onClick={openLogin}
                className="text-sm font-semibold text-slate-300 hover:text-white transition">
                Log In
              </button>
              <button onClick={openSignup}
                className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition">
                Start Free Trial
              </button>
            </div>
          </div>
        </nav>

        {/* Hero — single centered column. No product visual for now; that
            slot returns when we have a real screenshot worth showing. */}
        <section className="pt-32 md:pt-40 pb-16 md:pb-24 px-6">
          <div className="max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-4 py-1.5 mb-8">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-semibold text-slate-300">14-day free trial · No credit card required</span>
            </div>

            {/* Brand: logo + wordmark. The logo sits inside an expanding,
                fading indigo ring (animate-ping) so the drop has a subtle
                heartbeat — same effect the demo banner lockup used. */}
            <div className="flex items-center justify-center gap-4 mb-10">
              <span className="relative inline-flex w-14 h-14">
                <span className="absolute inset-0 rounded-2xl bg-indigo-400/40 animate-ping" />
                <img
                  src={INKTRACKER_LOGO}
                  alt="InkTracker"
                  className="relative w-14 h-14 rounded-2xl"
                />
              </span>
              <span className="text-4xl md:text-5xl font-extrabold tracking-tight">
                InkTracker
              </span>
            </div>

            <TypewriterHeadline />

            <p className="text-sm md:text-base text-slate-400 mb-10 max-w-xl mx-auto leading-relaxed">
              Built for screen print and embroidery shops running 1–10 presses.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-5">
              <button onClick={openSignup}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-7 py-4 rounded-2xl text-base transition shadow-lg shadow-indigo-900/50 w-full sm:w-auto">
                Start Free Trial
              </button>
              <a href="#features"
                className="text-slate-300 font-semibold px-5 py-4 rounded-2xl hover:bg-white/5 transition text-base">
                See Features →
              </a>
            </div>

            {/* TODO (founding member program — separate PR): when the
                internal founding-member counter is wired up, render
                "Founding spots remaining: X of 100" here in muted text
                above the price line. Source the count from the public
                view / edge function described in src/lib/billing.js. */}
            <p className="text-xs text-slate-500">
              Founding member pricing — $99/mo after trial · Cancel anytime
            </p>
          </div>
        </section>

        {/* Stats */}
        <section className="py-10 border-y border-white/5">
          <div className="max-w-4xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            {[
              { num: "All-in-one", sub: "one plan, every feature" },
              { num: "2 min", sub: "setup time" },
              { num: "Live", sub: "QuickBooks sync" },
              { num: "14 days", sub: "free trial" },
            ].map(s => (
              <div key={s.sub}>
                <div className="text-xl md:text-2xl font-extrabold text-white">{s.num}</div>
                <div className="text-xs text-slate-500 mt-1">{s.sub}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Integrations */}
        <section className="py-12 px-6">
          <div className="max-w-3xl mx-auto text-center">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">Integrates with the tools you already use</p>
            <p className="text-sm text-slate-300 mb-6 leading-relaxed">
              Live garment pricing from S&amp;S Activewear and AS Colour. Two-way QuickBooks sync. Stripe-powered payments. Shopify inventory in sync.
            </p>
            <div className="flex items-center justify-center gap-8 flex-wrap">
              {[
                { name: "QuickBooks", color: "#2CA01C" },
                { name: "Shopify", color: "#96BF48" },
                { name: "Stripe", color: "#635BFF" },
                { name: "S&S Activewear", color: "#E53935" },
                { name: "AS Colour", color: "#94a3b8" },
              ].map(i => (
                <span key={i.name} className="text-sm font-bold" style={{ color: i.color }}>{i.name}</span>
              ))}
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="py-24 px-6">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-14">
              <h2 className="text-3xl font-extrabold">Everything your shop needs</h2>
              <p className="text-slate-400 mt-3 max-w-lg mx-auto">No tiers, no feature locks. Every tool included from day one.</p>
            </div>
            <p className="text-center text-xs text-slate-500 mb-8">Click any feature to preview it.</p>
            <div className="grid md:grid-cols-3 gap-5">
              {FEATURE_CARDS.map(f => (
                <button
                  key={f.title}
                  type="button"
                  onClick={() => setPreviewFeature(f)}
                  className={`group relative text-left bg-gradient-to-b ${f.color} border border-white/10 rounded-2xl p-6 hover:border-white/30 hover:-translate-y-0.5 transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400`}
                  aria-label={`Preview ${f.title}`}
                >
                  <h3 className="text-base font-bold text-white mb-2 pr-8">{f.title}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed mb-3">{f.desc}</p>
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-300 group-hover:text-indigo-200 transition">
                    Preview <span aria-hidden="true">→</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="py-20 px-6 border-t border-white/5">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-14">
              <h2 className="text-3xl font-extrabold">Up and running in minutes</h2>
            </div>
            <div className="grid md:grid-cols-4 gap-8">
              {[
                { step: "1", title: "Sign up", desc: "Create your account and set up your shop. Takes under two minutes." },
                { step: "2", title: "Connect QuickBooks", desc: "Link your QB account with one click. Invoices and expenses sync automatically." },
                { step: "3", title: "Send your first quote", desc: "Build a quote with live garment pricing. Send it. Customer approves and pays online." },
                { step: "4", title: "Track production", desc: "Move orders through your pipeline. Your team updates from tablets or phones." },
              ].map(s => (
                <div key={s.step} className="text-center">
                  <div className="w-10 h-10 rounded-full bg-indigo-600 text-white font-bold flex items-center justify-center mx-auto mb-3 text-sm">{s.step}</div>
                  <h3 className="text-sm font-bold text-white mb-1">{s.title}</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Founder / origin story */}
        <section className="py-24 px-6 border-t border-white/5">
          <div className="max-w-5xl mx-auto">
            <div className="grid md:grid-cols-2 gap-12 items-center">
              <div className="order-2 md:order-1">
                <img
                  src="/landing/joe.jpg"
                  alt="Joe Grennan, founder of InkTracker, at the Biota MFG screen print shop in Reno, Nevada."
                  className="w-full max-w-md mx-auto rounded-2xl shadow-2xl shadow-black/40 object-cover"
                  style={{ aspectRatio: "4 / 5" }}
                  loading="lazy"
                />
              </div>

              <div className="order-1 md:order-2">
                <p className="text-xs font-semibold text-indigo-400 uppercase tracking-widest mb-3">
                  Why InkTracker exists
                </p>
                <h2 className="text-3xl font-extrabold mb-5 leading-tight">
                  Built by a screen printer,<br/>for screen printers.
                </h2>
                <p className="text-slate-300 leading-relaxed mb-5">
                  I run Biota MFG, a screen print shop in Reno, Nevada. After 13 years on the press, I kept finding the same software gap — tools that either tried to do everything (and did most of it badly) or did one thing but missed the rest of the workflow. So I built the tool I actually needed: focused on the quote-to-invoice path, integrated with QuickBooks for accounting, and built around how a real shop runs. Every InkTracker subscription also funds land conservation through Biota's five-year roadmap. — Joe
                </p>
                <p className="text-xs text-slate-500">
                  Joe Grennan · Founder · joe@biotamfg.co
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="py-24 px-6 border-t border-white/5">
          <div className="max-w-xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-extrabold">Simple pricing</h2>
              <p className="text-slate-400 mt-3">One plan. Everything included. No surprises.</p>
            </div>
            <div className="bg-gradient-to-b from-indigo-600 to-indigo-700 border-2 border-indigo-400 rounded-2xl p-8 shadow-2xl shadow-indigo-900/40">
              <div className="text-center mb-6">
                <p className="text-xs font-semibold text-emerald-300 uppercase tracking-widest mb-3">
                  Founding member pricing — First 100 shops
                </p>
                <div className="mb-3">
                  <span className="text-5xl font-extrabold text-white">$99</span>
                  <span className="text-base text-indigo-200">/mo</span>
                </div>
                <p className="text-sm text-indigo-100/90 mb-3 max-w-md mx-auto leading-relaxed">
                  Founding member rate locked for the life of your subscription. Available to the first 100 shops. Standard pricing of $149/month begins thereafter.
                </p>
                <p className="text-sm text-indigo-200">14-day free trial · No credit card required</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5 mb-6 px-2">
                {[
                  "Quotes & orders",
                  "Production tracking",
                  "Invoicing & payments",
                  "Customer management",
                  "QuickBooks sync",
                  "Unlimited employees",
                  "S&S & AS Colour restock",
                  "Embeddable quote wizard",
                  "Shopify inventory sync",
                  "Mockup designer",
                  "Broker portal",
                  "Performance reports",
                ].map(f => (
                  <div key={f} className="flex items-center gap-2.5 text-sm text-indigo-100">
                    <span className="text-emerald-400 text-xs">&#10003;</span> {f}
                  </div>
                ))}
              </div>
              <p className="text-xs text-indigo-100/80 text-center mb-6 max-w-md mx-auto leading-relaxed">
                Typical shops save 5–10 hours per week on order tracking, payment follow-up, and quote-to-production handoff. Pays for itself in the first week.
              </p>
              <div className="text-center">
                <button onClick={openSignup}
                  className="bg-white text-indigo-700 hover:bg-indigo-50 font-bold px-10 py-3.5 rounded-xl text-base transition shadow-lg">
                  Start 14-Day Free Trial
                </button>
                <p className="text-xs text-indigo-200 mt-3">
                  Have a question?{" "}
                  <a href="mailto:joe@biotamfg.co" className="underline underline-offset-4 hover:text-white transition">
                    Email joe@biotamfg.co
                  </a>
                </p>
              </div>
            </div>

            {/* Conservation anchor — scrolls to the Conservation Mission section below. */}
            <div className="text-center mt-6">
              <a href="#conservation" className="text-sm font-semibold text-emerald-400 hover:text-emerald-300 transition">
                10% of every subscription funds land conservation. →
              </a>
            </div>
          </div>
        </section>

        {/* Conservation */}
        <section id="conservation" className="py-24 px-6 border-t border-white/5">
          <div className="max-w-4xl mx-auto">
            <div className="grid md:grid-cols-2 gap-12 items-center">
              <div>
                <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-4 py-1.5 mb-6">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-xs font-semibold text-emerald-400">Conservation Mission</span>
                </div>
                <h2 className="text-3xl font-extrabold mb-4">Built by printers.<br/>Funded for conservation.</h2>
                <p className="text-slate-400 leading-relaxed mb-4">
                  InkTracker is built by Biota Mfg, a mission-driven print shop in Reno, NV. A portion of all revenue goes toward protecting natural landscapes for the long term.
                </p>
                <p className="text-slate-400 leading-relaxed mb-6">
                  Every InkTracker subscription directly contributes to this mission. When your shop grows, conservation funding grows with it.
                </p>
                <a href="https://www.biotamfg.co/pages/conservation" target="_blank" rel="noopener noreferrer"
                  className="text-sm font-semibold text-emerald-400 hover:text-emerald-300 transition">
                  Read our conservation roadmap &rarr;
                </a>
              </div>
              <div className="space-y-4">
                {[
                  { year: "Year 1", title: "Foundation", desc: "Setting aside revenue and defining clear conservation goals with transparent operations." },
                  { year: "Year 2", title: "Partnerships", desc: "Consulting with land trusts and environmental organizations to identify opportunities." },
                  { year: "Year 3", title: "First Action", desc: "Funds begin supporting conservation through strategic partnerships or land acquisition." },
                  { year: "Year 4", title: "Stewardship", desc: "Caring for protected land and expanding impact responsibly." },
                  { year: "Year 5", title: "Lasting Protection", desc: "Conservation easements, partnerships, and permanent protections." },
                ].map((y, i) => (
                  <div key={i} className="flex gap-4 items-start">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-bold text-emerald-400">{i + 1}</span>
                    </div>
                    <div>
                      <div className="text-sm font-bold text-white">{y.year} — {y.title}</div>
                      <p className="text-xs text-slate-500 leading-relaxed mt-0.5">{y.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="py-24 px-6 border-t border-white/5">
          <div className="max-w-3xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-extrabold">Frequently asked questions</h2>
            </div>
            <div className="space-y-3">
              {[
                {
                  q: "Can I import data from Printavo, Shopworks, or another shop management tool?",
                  a: "Yes. CSV import is supported for customers, quotes, and orders. If you're switching from another platform, contact support and we'll help map the data over.",
                },
                {
                  q: "Does InkTracker work for embroidery shops too, or only screen printing?",
                  a: "Both. The quote-to-invoice workflow, customer management, production tracking, and QuickBooks integration work the same way for either method. We're focused on screen print and embroidery to start — other decoration methods aren't on the v1 roadmap.",
                },
                {
                  q: "What happens to my data if I cancel?",
                  a: "You can export all your data — customers, quotes, orders, invoices — as CSV at any time, including the moment of cancellation. Your data is yours.",
                },
                {
                  q: "Is there a long-term contract?",
                  a: "No. InkTracker is month-to-month. Cancel anytime. Founding members who cancel will lose their $99/month rate; re-signups will pay the standard $149/month rate.",
                },
                {
                  q: "How do I know InkTracker won't disappear in six months?",
                  a: "InkTracker is built and maintained by Biota MFG, a 13-year-old screen print business based in Reno, Nevada. The shop dogfoods the software daily — if it stops being maintained, our own production stops. The financial structure also funds land conservation, which gives the project a long-horizon commitment the team takes seriously.",
                },
                {
                  q: "Why is the price going up to $149/month?",
                  a: "$99/month is our founding member rate, available to the first 100 shops. As we scale the product, support, and infrastructure, standard pricing reflects the actual cost to deliver and support InkTracker reliably. Founding members keep $99/month for as long as they remain subscribed.",
                },
                {
                  q: "How does the conservation contribution actually work?",
                  a: "A portion of every InkTracker subscription is allocated to a long-term land conservation fund operated by Biota MFG. The full five-year plan — including how funds are set aside, deployed, and reported — is published at biotamfg.co/pages/conservation.",
                },
              ].map((item) => (
                <details key={item.q} className="group bg-white/[0.02] border border-white/10 rounded-2xl hover:border-white/20 transition">
                  <summary className="cursor-pointer list-none px-6 py-4 flex items-center justify-between gap-4">
                    <span className="text-sm md:text-base font-semibold text-white text-left">{item.q}</span>
                    <span className="text-slate-400 text-xl font-light shrink-0 transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <div className="px-6 pb-5 -mt-1">
                    <p className="text-sm text-slate-400 leading-relaxed">{item.a}</p>
                  </div>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-24 px-6 border-t border-white/5">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-3xl font-extrabold mb-4">Your shop, organized.</h2>
            <p className="text-slate-400 mb-8">Try InkTracker free for 14 days. No credit card required.</p>
            <button onClick={openSignup}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-8 py-4 rounded-2xl text-base transition shadow-lg shadow-indigo-900/50">
              Start Your Free Trial
            </button>
          </div>
        </section>

        {/* Footer */}
        <footer className="py-10 px-6 border-t border-white/5">
          <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <img src={INKTRACKER_LOGO} alt="InkTracker" className="w-6 h-6 rounded" />
              <span className="text-sm font-semibold text-slate-500">InkTracker</span>
              <span className="text-xs text-slate-600 ml-2">Built by screen printers in Reno, NV</span>
            </div>
            <div className="flex gap-6 text-xs text-slate-600">
              <a href="/changelog" className="hover:text-slate-400">Changelog</a>
              <a href="/security" className="hover:text-slate-400">Security</a>
              <a href="/privacy" className="hover:text-slate-400">Privacy</a>
              <a href="/terms" className="hover:text-slate-400">Terms</a>
              <a href="mailto:support@inktracker.app" className="hover:text-slate-400">Support</a>
            </div>
          </div>
        </footer>
      </div>

      <LoginModal isOpen={showLogin} onClose={() => setShowLogin(false)} defaultMode={loginMode} />
      <FeaturePreviewModal feature={previewFeature} onClose={() => setPreviewFeature(null)} />
    </>
  );
}

function PendingApprovalPage() {
  const { checkAppState, logout, user } = useAuth();
  const [isSwitchingUser, setIsSwitchingUser] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      checkAppState();
    }, 30000);

    return () => clearInterval(interval);
  }, [checkAppState]);

  const handleSwitchUser = async () => {
    try {
      setIsSwitchingUser(true);
      await logout(true);
    } catch (error) {
      console.error("Failed to switch user:", error);
      setIsSwitchingUser(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F3EFE6] flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-xl bg-white rounded-3xl shadow-lg border border-slate-200 overflow-hidden">
        <div className="px-10 pt-10 pb-8 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
            <svg
              className="h-8 w-8 text-amber-600"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
          </div>

          <h1 className="text-3xl font-bold text-slate-900">
            Account pending review
          </h1>

          <p className="text-base text-slate-600 mt-4 leading-7">
            Your account has been created successfully.
          </p>
        </div>

        <div className="px-8 pb-10">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-6 py-6">
            <p className="text-sm text-slate-700 leading-7">
              We review new accounts within 1 business day. You'll automatically get access as soon as you're approved — no need to do anything else.
            </p>
          </div>

          <div className="mt-6 text-center">
            <p className="text-sm text-slate-500 leading-6">
              This page checks for approval automatically every 30 seconds.
            </p>
            {user?.email ? (
              <p className="text-sm text-slate-500 leading-6 mt-2">
                Signed in as <span className="font-medium text-slate-700">{user.email}</span>
              </p>
            ) : null}
          </div>

          <div className="mt-8">
            <button
              onClick={handleSwitchUser}
              disabled={isSwitchingUser}
              className="w-full inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-semibold py-3 px-4 transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSwitchingUser ? "Switching Account..." : "Use a Different Account"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FullScreenSpinner() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-white">
      <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
    </div>
  );
}

// Spinner shown right after email confirmation while the activate_trial RPC
// runs. If the role transition doesn't propagate (RPC failed / cache miss /
// auth listener missed an event), surface a manual refresh after 4s and
// auto-reload after 8s so the user is never stranded.
function PostConfirmSpinner() {
  const [showRefresh, setShowRefresh] = useState(false);
  useEffect(() => {
    const showT = setTimeout(() => setShowRefresh(true), 4000);
    const reloadT = setTimeout(() => window.location.reload(), 8000);
    return () => { clearTimeout(showT); clearTimeout(reloadT); };
  }, []);
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-white gap-4">
      <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      <div className="text-sm text-slate-500">Setting up your account…</div>
      {showRefresh && (
        <button
          onClick={() => window.location.reload()}
          className="mt-2 px-4 py-2 text-sm font-semibold text-indigo-600 hover:text-indigo-700"
        >
          Taking too long? Click to refresh
        </button>
      )}
    </div>
  );
}

function AppRoutes() {
  return (
    <Routes>
        <Route
          path="/"
          element={
            <LayoutWrapper currentPageName={mainPageKey}>
              <MainPage />
            </LayoutWrapper>
          }
        />

        {Object.entries(Pages).map(([path, Page]) => (
          <Route
            key={path}
            path={`/${path}`}
            element={
              <LayoutWrapper currentPageName={path}>
                <Page />
              </LayoutWrapper>
            }
          />
        ))}

        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/changelog" element={<Changelog />} />
        <Route path="/security" element={<Security />} />

        <Route path="*" element={<PageNotFound />} />
      </Routes>
  );
}

const AuthenticatedApp = () => {
  const { isLoadingAuth, isAuthenticated, user, checkAppState } = useAuth();
  const location = useLocation();
  const trialActivatingRef = useRef(false);

  const isPublicRoute = useMemo(() => {
    const pathname = (location.pathname || "/").toLowerCase();
    return PUBLIC_PATHS.has(pathname);
  }, [location.pathname]);

  // Auto-activate trial for new signups (must be before any early returns to satisfy hooks rules)
  useEffect(() => {
    if (!isAuthenticated || user?.role !== "user" || trialActivatingRef.current) return;
    trialActivatingRef.current = true;
    (async () => {
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (authUser) {
          const { error } = await supabase.rpc("activate_trial", { user_auth_id: authUser.id });
          console.log("[Trial] RPC result:", error || "success");
        }
      } catch (err) {
        console.error("[Trial] activation failed:", err);
      }
      await new Promise(r => setTimeout(r, 500));
      trialActivatingRef.current = false;
      checkAppState({ silent: false });
    })();
  }, [isAuthenticated, user?.role]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isPublicRoute) {
    return <AppRoutes />;
  }

  if (isLoadingAuth) {
    return <FullScreenSpinner />;
  }

  if (!isAuthenticated) {
    return <PublicLandingPage />;
  }

  if (user?.role === "user") {
    return <PostConfirmSpinner />;
  }

  if (!user?.role) {
    return <PendingApprovalPage />;
  }

  // Brokers belong in their own portal
  if (user.role === "broker") {
    window.location.replace("/BrokerDashboard");
    return <FullScreenSpinner />;
  }

  // Managers get full app access — no onboarding needed (they inherit shop from owner)
  // They skip the admin panel check in Layout.jsx

  // Employees get the read-only shop floor view — no onboarding
  if (user.role === "employee") {
    if (location.pathname !== "/ShopFloor") {
      window.location.replace("/ShopFloor");
      return <FullScreenSpinner />;
    }
    return <AppRoutes />;
  }

  // Check trial expiry
  const trialExpired = user?.subscription_tier === "trial" && user?.trial_ends_at && new Date(user.trial_ends_at) < new Date();
  const isExpired = trialExpired || user?.subscription_tier === "expired" || user?.subscription_status === "canceled";

  // Show onboarding if the user hasn't set a shop name yet (owners only — managers/employees inherit)
  const needsOnboarding = !user?.shop_name && user?.role !== "manager" && user?.role !== "employee";

  if (needsOnboarding) {
    return <OnboardingWizard user={user} onComplete={() => window.location.href = "/"} />;
  }

  return (
    <>
      <AppRoutes />
      {isExpired && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-red-600 text-white px-4 py-3 flex items-center justify-center gap-4 shadow-lg">
          <span className="text-sm font-semibold">Your trial has expired. Upgrade to keep creating quotes and orders.</span>
          <a href="/Account?billing=1" className="bg-white text-red-700 font-bold text-sm px-4 py-1.5 rounded-lg hover:bg-red-50 transition">
            View Plans
          </a>
        </div>
      )}
    </>
  );
};

function PublicRouteGuard() {
  const location = useLocation();
  const pathname = (location.pathname || "/").toLowerCase();
  const isPublic = PUBLIC_PATHS.has(pathname);

  if (isPublic) {
    return <AppRoutes />;
  }

  return (
    <AuthProvider>
      <AuthenticatedApp />
    </AuthProvider>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ErrorBoundary>
            <PublicRouteGuard />
          </ErrorBoundary>
        </Router>
        <Toaster />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;