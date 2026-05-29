import { useEffect, useMemo, useState, useRef } from "react";
import { supabase } from "@/api/supabaseClient";
import ErrorBoundary, { RouteErrorBoundary } from "@/components/ErrorBoundary";
import ModalBackdrop from "@/components/shared/ModalBackdrop";
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
import { BROKER_ALLOWED_PAGES } from "@/lib/broker/roleRedirect";
import LoginModal from "@/components/LoginModal";
import OnboardingWizard from "@/components/OnboardingWizard";
import {
  TYPEWRITER_LINES,
  INITIAL_STATE as TYPEWRITER_INITIAL_STATE,
  advanceTypewriter,
} from "@/lib/landing/typewriter";
import {
  interpretActivationResponse,
  activationRetryDelayMs,
  ACTIVATION_STATES,
  MAX_ACTIVATION_ATTEMPTS,
} from "@/lib/auth/trialActivation";

const { Pages, Layout, mainPage } = pagesConfig;

const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const INKTRACKER_LOGO =
  "https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/69aa650fd3e825e66ff81817/b4e2dc53f_logo.png";

const PUBLIC_PAGE_NAMES = [
  "BrokerDashboard",
  "BrokerOnboarding",
  "EmployeeOnboarding",
  "QuotePayment",
  "QuotePaymentSuccess",
  "QuotePaymentCancel",
  "QuoteRequest",
  "ArtApproval",
  "OrderStatus",
  "ShopFloor",
  "ResetPassword",
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
    color: "from-teal-500/20 to-teal-500/5",
    // 23.5-second animated demo: a quote being built from scratch through
    // customer select, garment style autofill, size breakdown, print
    // location, live pricing count-up, and save → new row in the list.
    // Built from the design handoff at public/landing/quote-demo/.
    media: { type: "iframe", src: "/landing/quote-demo/index.html" },
  },
  {
    title: "Production Tracking",
    desc: "Visual pipeline from art approval to shipping. Your team updates progress from any device.",
    color: "from-green-500/20 to-green-500/5",
    // 25-second animated demo of the production kanban — cards moving
    // from art-approval through pre-press, printing, finishing, QC,
    // ready-to-ship, and completed. Built from the design handoff at
    // public/landing/production-demo/.
    media: { type: "iframe", src: "/landing/production-demo/index.html" },
  },
  {
    title: "Invoicing & Payments",
    desc: "Generate invoices, sync to QuickBooks, and send payment links directly to customers.",
    color: "from-emerald-500/20 to-emerald-500/5",
    media: { type: "iframe", src: "/landing/invoicing-demo/index.html" },
  },
  {
    title: "Customer Management",
    desc: "Track customer history, artwork files, tax status, and payment terms. Auto-merge duplicates.",
    color: "from-blue-500/20 to-blue-500/5",
    // 22-second animated demo — customer list, detail panel with order
    // history, tax-exempt flag. Built from the design handoff at
    // public/landing/customer-demo/.
    media: { type: "iframe", src: "/landing/customer-demo/index.html" },
  },
  {
    title: "Inventory & Restock",
    desc: "Order blanks from S&S Activewear and AS Colour with live pricing.",
    color: "from-amber-500/20 to-amber-500/5",
    media: { type: "iframe", src: "/landing/inventory-demo/index.html" },
  },
  {
    title: "Quote Wizard",
    desc: "Embed a quote request form on your website. Customers build orders 24/7 and you get notified.",
    color: "from-rose-500/20 to-rose-500/5",
    // 25-second animated demo of the customer-facing wizard — color
    // picker, qty/imprint selection, submitting the request. Built
    // from the design handoff at public/landing/wizard-demo/.
    media: { type: "iframe", src: "/landing/wizard-demo/index.html" },
  },
  {
    title: "Broker Integration",
    desc: "Resellers submit their clients' orders through their own portal — automatically priced with the markup share you set per broker.",
    color: "from-teal-500/20 to-teal-500/5",
    media: { type: "iframe", src: "/landing/broker-demo/index.html" },
  },
  {
    title: "Shop Floor",
    desc: "Mobile-ready view for employees. Job tickets, checklists, and real-time production updates.",
    color: "from-orange-500/20 to-orange-500/5",
    media: { type: "iframe", src: "/landing/shopfloor-demo/index.html" },
  },
  {
    title: "Artwork Proofs",
    desc: "Place artwork on garment templates. Background removal, one-color conversion, and PDF proofs.",
    color: "from-teal-500/20 to-teal-500/5",
    media: { type: "iframe", src: "/landing/artwork-proofs-demo/index.html" },
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
    <ModalBackdrop onClose={onClose} z="z-50" bg="bg-black/80" className="animate-in fade-in">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${feature.title} preview`}
        className="bg-black border border-white/10 rounded-2xl max-w-5xl w-full max-h-[90vh] overflow-y-auto shadow-2xl"
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

        <div className="bg-black flex items-center justify-center" style={{ aspectRatio: "16 / 9" }}>
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
    </ModalBackdrop>
  );
}

// Hero headline animated as a typewriter — line 1 in white, brief pause,
// line 2 in indigo, then a slow blinking cursor parked at the end. Single
// keystroke is ~55ms, line break is 350ms. After typing finishes, the
// cursor keeps blinking so the hero never goes fully static.
const TYPEWRITER_TIMERS = { key: 55, pause: 350, hold: 1400, fade: 1500 };
const [LINE1, LINE2] = TYPEWRITER_LINES;

function TypewriterHeadline({ onRevealReady }) {
  const [state, setState] = useState(TYPEWRITER_INITIAL_STATE);
  const [blink, setBlink] = useState(true);
  const revealedRef = useRef(false);

  useEffect(() => {
    const step = advanceTypewriter(state);
    if (step.reveal && !revealedRef.current) {
      revealedRef.current = true;
      onRevealReady?.();
    }
    if (step.next === "none") {
      // Terminal step (fading → gone). No further timer, but the
      // phase still needs to commit so the component unmounts and its
      // slot in the layout collapses — otherwise the typewriter
      // remains in the DOM at opacity-0, leaving an empty void where
      // it used to sit.
      if (step.phase !== state.phase) setState(step);
      return;
    }
    const t = setTimeout(() => setState(step), TYPEWRITER_TIMERS[step.next]);
    return () => clearTimeout(t);
  }, [state, onRevealReady]);

  useEffect(() => {
    const t = setInterval(() => setBlink((b) => !b), 520);
    return () => clearInterval(t);
  }, []);

  if (state.phase === "gone") return null;

  const cursorOnLine2 =
    state.phase === "line2" || state.phase === "done" || state.phase === "fading";
  const fading = state.phase === "fading";
  const shown1 = LINE1.slice(0, state.line1);
  const shown2 = LINE2.slice(0, state.line2);

  return (
    <div
      className="mb-6 transition-opacity ease-out"
      style={{ opacity: fading ? 0 : 1, transitionDuration: `${TYPEWRITER_TIMERS.fade}ms` }}
      aria-label={`${LINE1} ${LINE2}`}
    >
      <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold leading-tight tracking-tight text-white min-h-[1.1em]">
        {shown1}
        {!cursorOnLine2 && (
          <span
            className={`inline-block w-[3px] md:w-[4px] h-[0.85em] align-[-0.1em] ml-1 bg-teal-400 rounded-sm ${blink ? "opacity-100" : "opacity-0"}`}
            aria-hidden="true"
          />
        )}
      </h1>
      <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold leading-tight tracking-tight bg-gradient-to-r from-teal-400 to-green-400 bg-clip-text text-transparent min-h-[1.1em]">
        {shown2}
        {cursorOnLine2 && (
          <span
            className={`inline-block w-[3px] md:w-[4px] h-[0.85em] align-[-0.1em] ml-1 bg-teal-400 rounded-sm ${blink ? "opacity-100" : "opacity-0"}`}
            aria-hidden="true"
          />
        )}
      </h1>
    </div>
  );
}

// Landing page — modeled on biotamfg.com: white surface, Anton condensed
// display caps, Inter body, a single forest-green accent, photo-led full-bleed
// moments, generous whitespace, hairline rules. No textures, no halftones,
// no decorative stamps — restraint is the look.
function PublicLandingPage() {
  const [showLogin, setShowLogin] = useState(false);
  const [loginMode, setLoginMode] = useState("signin");
  const [previewFeature, setPreviewFeature] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  function openSignup() { setLoginMode("signup"); setShowLogin(true); }
  function openLogin() { setLoginMode("signin"); setShowLogin(true); }
  function jumpToAnchor(hash) { setMobileMenuOpen(false); window.location.hash = hash; }

  const INK = "#0e0e0e";
  const MUTED = "#6b6b6b";
  const HAIRLINE = "#e5e5e5";
  const FOREST = "#2c5840";
  const FOREST_DARK = "#1a3a28";

  const H_FONT = '"Anton", "Oswald", "Arial Narrow", sans-serif';
  const B_FONT = '"Inter", -apple-system, BlinkMacSystemFont, sans-serif';

  const eyebrow = "text-[11px] font-semibold tracking-[0.28em] uppercase";
  const navLink = "text-[12px] font-semibold tracking-[0.22em] uppercase transition";
  const btnPrimary = "inline-block text-[12px] font-bold tracking-[0.22em] uppercase px-7 py-3.5 transition";
  const btnOutlineLight = "inline-block text-[12px] font-bold tracking-[0.22em] uppercase px-7 py-3.5 border transition";

  const FAQ_ITEMS = [
    { q: "Can I import data from Printavo, Shopworks, or another shop tool?", a: "Not via a self-serve CSV upload yet — but email support@inktracker.app with an export from your old platform and we'll port your customers, quotes, or orders over manually. Self-serve import is on the roadmap." },
    { q: "Does this work for embroidery shops, or only screen printing?", a: "Both. Quote-to-invoice, customer management, production tracking, and QuickBooks sync work the same for either method. We're focused on screen print and embroidery to start — other decoration methods aren't on the v1 roadmap." },
    { q: "What happens to my data if I cancel?", a: "Yours, always. Export everything — customers, quotes, orders, invoices — as CSV at any time, including the moment of cancellation." },
    { q: "Is there a long-term contract?", a: "No. Month-to-month, cancel anytime. Founding-rate plans aren't transferable after cancellation; re-signups pay the standard $99/mo (or $999/year)." },
    { q: "How do I know InkTracker won't disappear in six months?", a: "Biota Mfg has been printing in the Reno/Tahoe area for ten years and we run the shop on InkTracker daily. If it stops being maintained, our own production stops. The financial structure also funds long-horizon land-conservation work — both keep this project on a multi-year commitment." },
    { q: "How does the conservation contribution actually work?", a: "A piece of every subscription is allocated to a long-term land-conservation fund operated by Biota Mfg. The full five-year plan — how funds are set aside, deployed, and reported — lives at biotamfg.com/pages/wildways." },
  ];

  // Editorial three-up — numbered cards instead of icons so the section
  // doesn't read as a port of the Biota home page's bolt/tag/sprout strip.
  // Same palette + typography family, different visual spine.
  const VALUE_PROPS = [
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
  ];

  const PRICING_INCLUDES = [
    "Quotes & orders", "Production tracking",
    "Invoicing & payments", "QuickBooks Online sync",
    "Live garment pricing", "Unlimited employees",
    "Embeddable quote wizard", "Broker portal",
    "Artwork proofs", "Performance reports",
  ];

  return (
    <>
      <div id="top" className="min-h-screen bg-white" style={{ color: INK, fontFamily: B_FONT }}>
        {/* NAV — Juxtapoz layout: hamburger left, stacked wordmark + tagline
            centered, utility right. Sticky to the top. Bold black hairline
            rule beneath. Logo uses Anton with a skewX to fake the heavy
            italic cut of the Juxtapoz mark. */}
        <header className="sticky top-0 z-50 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/90 border-b-2" style={{ borderColor: INK }}>
          <div className="relative max-w-7xl mx-auto px-5 sm:px-6 h-[78px] md:h-[92px] flex items-center justify-between">
            {/* LEFT — hamburger (always visible) */}
            <button
              onClick={() => setMobileMenuOpen(v => !v)}
              className="p-2 -ml-2 hover:opacity-70 transition"
              aria-label="Toggle navigation menu"
              aria-expanded={mobileMenuOpen}
              style={{ color: INK }}
            >
              {mobileMenuOpen ? (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              ) : (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
              )}
            </button>

            {/* CENTER — stacked wordmark, absolute so the flanking sides don't
                squeeze it. Width-capped on mobile (max-w-[58%]) so that even
                with the absolute positioning, the wordmark stays inside the
                lane between hamburger and Start-trial button. */}
            <a href="#top" className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center pointer-events-auto" aria-label="InkTracker home">
              <span
                className="leading-none whitespace-nowrap"
                style={{
                  fontFamily: H_FONT,
                  fontSize: 'clamp(1.625rem, 5.5vw, 2.5rem)',
                  letterSpacing: '0.02em',
                  transform: 'skewX(-8deg)',
                  display: 'inline-block',
                }}
              >
                <span style={{ color: INK }}>INK</span><span style={{ color: FOREST }}>TRACKER</span>
              </span>
              <span
                className="mt-1.5 text-[9px] sm:text-[10px] tracking-[0.2em] uppercase whitespace-nowrap"
                style={{ fontFamily: B_FONT, color: MUTED, fontWeight: 400 }}
              >
                Print Shop Software
              </span>
            </a>

            {/* RIGHT — utility. Sign in collapses on mobile; trial button
                always shows. The mobile-only padding override (px-3 → px-7
                at sm+) trims the button width on phones so it doesn't crash
                into the centered wordmark. */}
            <div className="flex items-center gap-3 md:gap-4">
              <button
                onClick={openLogin}
                className={`hidden sm:inline-block ${navLink}`}
                style={{ color: INK }}
              >
                Sign in
              </button>
              <button
                onClick={openSignup}
                className="hidden sm:inline-block text-[12px] font-bold tracking-[0.22em] uppercase px-7 py-3.5 transition whitespace-nowrap"
                style={{ background: FOREST, color: '#fff' }}
              >
                Start trial
              </button>
            </div>
          </div>

          {/* Dropdown panel — opens for all viewports when hamburger is tapped */}
          {mobileMenuOpen && (
            <div className="border-t bg-white" style={{ borderColor: INK }}>
              <div className="max-w-7xl mx-auto px-6 py-2 flex flex-col">
                {[
                  ["#letter", "Letter"],
                  ["#tour", "Tour"],
                  ["#wildways", "Wildways"],
                  ["#pricing", "Pricing"],
                  ["#faq", "FAQ"],
                ].map(([h, label]) => (
                  <button key={h} onClick={() => jumpToAnchor(h)} className={`text-left py-4 border-b ${navLink}`} style={{ color: INK, borderColor: HAIRLINE }}>
                    {label}
                  </button>
                ))}
                <button onClick={() => { setMobileMenuOpen(false); openLogin(); }} className={`text-left py-4 sm:hidden ${navLink}`} style={{ color: INK }}>
                  Sign in
                </button>
                <button
                  onClick={() => { setMobileMenuOpen(false); openSignup(); }}
                  className="mt-2 mb-3 text-center text-[12px] font-bold tracking-[0.22em] uppercase px-7 py-3.5 transition sm:hidden"
                  style={{ background: FOREST, color: '#fff' }}
                >
                  Start trial
                </button>
              </div>
            </div>
          )}
        </header>

        {/* HERO — full-bleed dark moment with big condensed caps headline.
            Background video plays print-shop production shots in a loop;
            the dark forest overlay sits on top so the headline + CTAs
            still have enough contrast to read. If the MP4 doesn't load
            (file missing, mobile data-saver, etc.) the gradient + section
            color fall back automatically so it always looks intentional.

            ▸ TO REPLACE THE VIDEO: drop your shop-production clip at
              /public/landing/hero.mp4 (encoded as h.264, ideally under
              10 MB, ~15–25 seconds, looped seamlessly). A still frame
              at /public/landing/hero-poster.jpg gives mobile + slow
              connections something to render before the video kicks in. */}
        <section className="relative overflow-hidden" style={{ background: FOREST_DARK }}>
          <div className="relative h-[68vh] min-h-[520px] md:min-h-[640px] flex items-center justify-center text-center px-6">
            {/* Fallback gradient — shows through if the video never loads */}
            <div
              aria-hidden="true"
              className="absolute inset-0"
              style={{ background: `radial-gradient(ellipse at center, ${FOREST} 0%, ${FOREST_DARK} 75%, #0b1c12 100%)` }}
            />
            {/* Background video. autoPlay + muted + playsInline are
                required for autoplay on iOS Safari. Tabindex/aria hidden
                so it doesn't steal keyboard focus. */}
            <video
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              poster="/landing/hero-poster.jpg"
              aria-hidden="true"
              tabIndex={-1}
              className="absolute inset-0 w-full h-full object-cover"
            >
              <source src="/landing/hero.mp4" type="video/mp4" />
              <source src="/landing/hero.webm" type="video/webm" />
            </video>
            {/* Forest tint overlay — keeps the headline contrast high
                without muddying the video. Vertical so the bottom (where
                the body copy + CTAs sit) is darker than the top. */}
            <div
              aria-hidden="true"
              className="absolute inset-0"
              style={{
                background: `linear-gradient(180deg, rgba(26, 58, 40, 0.5) 0%, rgba(26, 58, 40, 0.65) 40%, rgba(11, 28, 18, 0.85) 100%)`,
              }}
            />
            <div className="relative max-w-5xl">
              <p className={eyebrow} style={{ color: 'rgba(255,255,255,0.7)' }}>Print-shop management software</p>
              <h1
                className="text-white mt-7 uppercase tracking-[0.01em] whitespace-pre-line"
                style={{ fontFamily: H_FONT, fontSize: 'clamp(3.75rem, 13vw, 8rem)', lineHeight: 1.0 }}
              >
                By printers,{'\n'}for printers.
              </h1>
              <p className="text-white/85 mt-8 text-base md:text-lg leading-[1.65] max-w-xl mx-auto">
                Quotes, production, invoicing — built in a Reno/Tahoe shop after
                17 years of using tools that didn't quite fit.
              </p>
              <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
                <button onClick={openSignup} className={btnPrimary} style={{ background: '#fff', color: INK }}>
                  Start 14-day trial
                </button>
                <a href="#tour" className={btnOutlineLight} style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.55)' }}>
                  Take a tour
                </a>
              </div>
              <p className="text-white/55 text-xs mt-6 tracking-wide">No credit card · cancel anytime</p>
            </div>
          </div>
        </section>

        {/* THREE-UP — editorial numbered cards, left-aligned. Same palette
            and type family as Biota, but a different visual spine: numerals
            + hairline rule instead of the bolt/tag/sprout icon set, and an
            underlined arrow link in place of a solid green button. */}
        <section className="bg-white py-24 md:py-32 px-6">
          <div className="max-w-6xl mx-auto grid md:grid-cols-3 gap-x-10 gap-y-14">
            {VALUE_PROPS.map(v => (
              <div key={v.title} className="text-left">
                <div className="flex items-baseline gap-4 mb-5">
                  <span
                    className="leading-none"
                    style={{ fontFamily: H_FONT, fontSize: 'clamp(2.25rem, 4vw, 3rem)', color: FOREST, letterSpacing: '0.02em' }}
                  >
                    {v.num}
                  </span>
                  <span className="flex-1 h-px" style={{ background: INK }} />
                </div>
                <h3 className="uppercase tracking-[0.04em] text-xl md:text-2xl leading-tight mb-3" style={{ fontFamily: H_FONT, color: INK }}>
                  {v.title}
                </h3>
                <p className="text-[15px] leading-[1.7] mb-6 max-w-sm" style={{ color: MUTED }}>
                  {v.body}
                </p>
                <a
                  href={v.href}
                  className="inline-flex items-baseline gap-2 text-[11px] font-bold tracking-[0.22em] uppercase pb-1 border-b transition hover:gap-3"
                  style={{ color: FOREST, borderColor: FOREST }}
                >
                  {v.cta} <span aria-hidden="true">→</span>
                </a>
              </div>
            ))}
          </div>
        </section>

        {/* TOUR — featured modules grid. Big clean tiles, hairline borders,
            hover lifts to a soft shadow. Tile opens existing iframe modal. */}
        <section id="tour" className="bg-[#fafaf8] py-24 md:py-32 px-6 border-y" style={{ borderColor: HAIRLINE }}>
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-16 md:mb-20">
              <p className={eyebrow} style={{ color: MUTED }}>Inside the app</p>
              <h2 className="uppercase tracking-[0.02em] mt-4 leading-[0.95]" style={{ fontFamily: H_FONT, fontSize: 'clamp(2rem, 4.5vw, 3.75rem)', color: INK }}>
                Featured modules
              </h2>
              <p className="mt-6 text-base md:text-lg max-w-xl mx-auto leading-[1.65]" style={{ color: MUTED }}>
                Each module is a real piece of the shop. Tap any tile to watch it move.
              </p>
            </div>

            {/* MOBILE — timeline accordion. Each module shows its number
                in a circle (Y1/Y2-style from Biota's Wildways page) with
                the title beneath. Tap to expand: description + PREVIEW
                button that opens the same FeaturePreviewModal as the
                desktop grid. Connecting vertical line drawn behind via a
                centered pseudo-stripe. */}
            <div className="md:hidden relative">
              {/* Vertical connecting rail */}
              <span
                aria-hidden="true"
                className="absolute left-1/2 -translate-x-1/2 top-6 bottom-6 w-px"
                style={{ background: HAIRLINE }}
              />
              <div className="relative flex flex-col items-stretch gap-1">
                {FEATURE_CARDS.map((f, i) => (
                  <details key={f.title} className="group">
                    <summary className="list-none cursor-pointer flex flex-col items-center py-4 outline-none focus-visible:[&_div]:ring-2 focus-visible:[&_div]:ring-offset-2">
                      <div
                        className="relative w-14 h-14 rounded-full flex items-center justify-center transition-colors group-open:bg-[--open-bg]"
                        style={{
                          background: '#fff',
                          border: `2px solid ${FOREST}`,
                          '--open-bg': FOREST,
                        }}
                      >
                        <span
                          className="text-lg leading-none transition-colors group-open:text-white"
                          style={{ fontFamily: H_FONT, color: FOREST, letterSpacing: '0.04em' }}
                        >
                          {String(i + 1).padStart(2, '0')}
                        </span>
                      </div>
                      <span
                        className="mt-3 text-[11px] font-bold tracking-[0.2em] uppercase text-center"
                        style={{ color: INK, fontFamily: B_FONT }}
                      >
                        {f.title}
                      </span>
                    </summary>
                    <div
                      className="mx-3 mt-3 mb-6 p-5 border-l-4 bg-white"
                      style={{ borderColor: FOREST, borderTop: `1px solid ${HAIRLINE}`, borderRight: `1px solid ${HAIRLINE}`, borderBottom: `1px solid ${HAIRLINE}` }}
                    >
                      <p
                        className="text-[10px] font-bold tracking-[0.22em] uppercase mb-3"
                        style={{ color: FOREST, fontFamily: B_FONT }}
                      >
                        Module {String(i + 1).padStart(2, '0')}
                      </p>
                      <h3
                        className="uppercase tracking-[0.03em] text-lg leading-tight mb-3"
                        style={{ fontFamily: H_FONT, color: INK }}
                      >
                        {f.title}
                      </h3>
                      <p className="text-sm leading-[1.65] mb-5" style={{ color: MUTED }}>
                        {f.desc}
                      </p>
                      <button
                        type="button"
                        onClick={() => setPreviewFeature(f)}
                        className="inline-flex items-center gap-2 text-[11px] font-bold tracking-[0.22em] uppercase px-5 py-3 transition"
                        style={{ background: FOREST, color: '#fff' }}
                      >
                        Preview <span aria-hidden="true">▸</span>
                      </button>
                    </div>
                  </details>
                ))}
              </div>
            </div>

            {/* DESKTOP — grid of paused-iframe thumbnails. Hidden on
                mobile so the touch-target experience is the accordion above. */}
            <div className="hidden md:grid md:grid-cols-2 lg:grid-cols-3 gap-x-7 gap-y-12">
              {FEATURE_CARDS.map((f, i) => (
                <button
                  key={f.title}
                  type="button"
                  onClick={() => setPreviewFeature(f)}
                  className="text-left group focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                  style={{ '--tw-ring-color': FOREST, '--tw-ring-offset-color': '#fafaf8' }}
                  aria-label={`Preview ${f.title}`}
                >
                  <div
                    className="relative overflow-hidden border bg-black transition-shadow group-hover:shadow-[0_18px_50px_-12px_rgba(0,0,0,0.18)]"
                    style={{ borderColor: HAIRLINE, aspectRatio: '16 / 9' }}
                  >
                    {f.media?.type === 'iframe' && f.media?.src ? (
                      <iframe
                        src={`${f.media.src}?paused=1&t=2.5`}
                        title=""
                        aria-hidden="true"
                        tabIndex={-1}
                        loading="lazy"
                        sandbox="allow-scripts allow-same-origin"
                        className="absolute inset-0 w-full h-full border-0 pointer-events-none"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center" style={{ background: '#f1f0ec' }}>
                        <span
                          className="leading-none"
                          style={{ fontFamily: H_FONT, fontSize: 'clamp(4.5rem, 9vw, 7rem)', color: FOREST, letterSpacing: '0.02em' }}
                        >
                          {String(i + 1).padStart(2, '0')}
                        </span>
                      </div>
                    )}
                    <span
                      className="absolute bottom-3 right-3 text-[10px] font-bold tracking-[0.22em] uppercase px-2.5 py-1.5"
                      style={{ background: INK, color: '#fff' }}
                    >
                      Play ▸
                    </span>
                  </div>
                  <h3 className="mt-5 uppercase tracking-[0.03em] text-lg md:text-xl leading-tight" style={{ fontFamily: H_FONT, color: INK }}>
                    {f.title}
                  </h3>
                  <p className="mt-2 text-[14px] leading-[1.65]" style={{ color: MUTED }}>
                    {f.desc}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* HOW PRICING WORKS — explains the pricing engine itself (live blank
            costs, color tiers, per-imprint setups, broker margins). This is
            NOT the $99/mo cost section — that lives further down at #pricing. */}
        <section id="how-pricing" className="bg-white py-24 md:py-32 px-6 border-t" style={{ borderColor: HAIRLINE }}>
          <div className="max-w-6xl mx-auto">
            <div className="md:grid md:grid-cols-[5fr_7fr] md:gap-x-16 mb-14 md:mb-20 items-end">
              <div>
                <p className={eyebrow} style={{ color: MUTED }}>How it works</p>
                <h2 className="uppercase tracking-[0.02em] mt-4 leading-[0.95]" style={{ fontFamily: H_FONT, fontSize: 'clamp(2rem, 4.5vw, 3.75rem)', color: INK }}>
                  Pricing that knows your shop.
                </h2>
              </div>
              <p className="mt-8 md:mt-0 text-base md:text-lg leading-[1.7]" style={{ color: MUTED }}>
                Most shop-management tools make you punch in every cost by hand.
                InkTracker pulls real numbers from your suppliers, applies your
                shop's tiered logic, and writes the math down so the quote a
                customer sees is the invoice they get.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-x-10 gap-y-10 md:gap-y-12 border-t" style={{ borderColor: INK }}>
              {[
                {
                  label: "Blanks",
                  title: "Live garment costs",
                  body: "Pricing pulled straight from S&S Activewear and AS Colour, scoped to your shop's accounts. Cost basis updates without you copying a spreadsheet.",
                },
                {
                  label: "Imprints",
                  title: "Color tiers + setup fees",
                  body: "Screen-print pricing climbs by ink count using your shop's tier table. Setups apply per imprint location, not per shirt. Embroidery stitch counts price the same way.",
                },
                {
                  label: "Brokers",
                  title: "Markup share, calculated",
                  body: "Resellers submit through their own portal. Your wholesale price and their markup share land on every quote automatically — and the customer-facing version hides the math.",
                },
                {
                  label: "Snapshots",
                  title: "What you quote is what you bill",
                  body: "Every saved quote freezes its pricing. Reopen it six months later, send the invoice, and the numbers match — even if your tiers have shifted since.",
                },
              ].map((row, i) => (
                <div key={row.title} className={`pt-8 ${i % 2 === 0 ? "" : ""}`}>
                  <p className="text-[10px] font-bold tracking-[0.28em] uppercase mb-3" style={{ color: FOREST }}>
                    {row.label}
                  </p>
                  <h3 className="uppercase tracking-[0.02em] text-lg md:text-xl leading-tight mb-3" style={{ fontFamily: H_FONT, color: INK }}>
                    {row.title}
                  </h3>
                  <p className="text-[15px] leading-[1.7]" style={{ color: MUTED }}>
                    {row.body}
                  </p>
                </div>
              ))}
            </div>

            <p className="mt-14 text-[13px] leading-[1.7] max-w-2xl" style={{ color: MUTED }}>
              Want to see the engine on a real quote?{' '}
              <a href="#tour" className="underline underline-offset-2" style={{ color: INK }}>Tap the Quotes &amp; Orders module in the tour</a>{' '}
              — the demo walks through a 23-second quote build with live pricing count-up.
            </p>
          </div>
        </section>

        {/* LETTER — clean editorial founder block. */}
        <section id="letter" className="bg-white py-24 md:py-32 px-6">
          <div className="max-w-6xl mx-auto grid md:grid-cols-[5fr_7fr] gap-12 md:gap-20 items-center">
            <div className="overflow-hidden bg-[#f1f0ec]" style={{ aspectRatio: '4 / 5' }}>
              <img
                src="/landing/joe.jpg"
                alt="Joe Grennan, founder of InkTracker, at Biota Mfg in the Reno/Tahoe area."
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </div>
            <div>
              <p className={eyebrow} style={{ color: MUTED }}>A note from the shop</p>
              <h2 className="uppercase tracking-[0.02em] mt-4 leading-[0.95]" style={{ fontFamily: H_FONT, fontSize: 'clamp(1.875rem, 4vw, 3.25rem)', color: INK }}>
                Built in a shop, for a shop.
              </h2>
              <div className="mt-8 space-y-5 text-[16px] md:text-[17px] leading-[1.7]" style={{ color: '#2a2a2a' }}>
                <p>
                  I've been screen printing for 17 years. The last 10 in my own
                  shop — <strong>Biota Mfg</strong>, here in the Reno/Tahoe area.
                  We started
                  in a garage. We're still small.
                </p>
                <p>
                  The shop-management tools I tried always missed something
                  obvious — the kind of thing only a printer would catch.
                  Pricing engines that couldn't handle a per-imprint setup.
                  Production boards that didn't know what a misprint was.
                </p>
                <p>
                  So I built InkTracker. We run our shop on it every day — if it
                  stops working, our orders stop shipping. And a piece of every
                  subscription funds the land-conservation work we do through
                  Biota's Wildways program.
                </p>
              </div>
              <p className="mt-8 text-[11px] font-bold tracking-[0.25em] uppercase" style={{ color: MUTED }}>
                — Joe Grennan, Biota Mfg
              </p>
            </div>
          </div>
        </section>

        {/* WILDWAYS — two-column "conservation mission" block on a dark
            forest backdrop. Left column: eyebrow chip, headline, body,
            link out to the Biota Mfg roadmap. Right column: numbered
            5-year plan (square forest tiles, sage numerals, white year
            titles, muted body). Theme tokens — Anton for the headline,
            Inter for body, sage accent on the chip + numerals + link
            arrow, square corners on everything to match the rest of
            the landing surface. */}
        <section id="wildways" className="relative overflow-hidden py-24 md:py-32 px-6" style={{ background: '#0e1a13' }}>
          <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-12 md:gap-20">
            {/* LEFT — mission statement */}
            <div>
              <div
                className="inline-flex items-center gap-2 border px-3 py-1.5"
                style={{ borderColor: 'rgba(134, 168, 154, 0.4)', background: 'rgba(44, 88, 64, 0.18)' }}
              >
                <span className="w-1.5 h-1.5" style={{ background: '#86A89A' }} />
                <span className="text-[10px] font-bold tracking-[0.22em] uppercase" style={{ color: '#86A89A', fontFamily: B_FONT }}>
                  Conservation Mission
                </span>
              </div>

              <h2
                className="text-white uppercase mt-7 leading-[0.95] tracking-[0.02em]"
                style={{ fontFamily: H_FONT, fontSize: 'clamp(2rem, 4.5vw, 3.5rem)' }}
              >
                Driven by conservation.
              </h2>

              <div className="mt-7 space-y-5 text-base md:text-lg leading-[1.7]" style={{ color: 'rgba(255,255,255,0.75)', fontFamily: B_FONT }}>
                <p>
                  InkTracker is built by <strong style={{ color: '#fff' }}>Biota Mfg</strong>,
                  a mission-driven print shop in the Reno/Tahoe area. A portion of all
                  revenue goes toward protecting natural landscapes for the
                  long term.
                </p>
                <p>
                  Every InkTracker subscription directly contributes to this
                  mission. When your shop grows, conservation funding grows
                  with it.
                </p>
              </div>

              <a
                href="https://biotamfg.com/pages/wildways"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-baseline gap-2 mt-10 text-[12px] font-bold tracking-[0.22em] uppercase border-b pb-1 transition hover:gap-3"
                style={{ color: '#86A89A', borderColor: '#86A89A', fontFamily: B_FONT }}
              >
                Read our roadmap <span aria-hidden="true">→</span>
              </a>
            </div>

            {/* RIGHT — 5-year plan */}
            <div className="space-y-6 md:space-y-7 md:mt-2">
              {[
                { year: 'Year 1', title: 'Foundation',          desc: 'Setting aside revenue and defining clear conservation goals with transparent operations.' },
                { year: 'Year 2', title: 'Partnerships',        desc: 'Consulting with land trusts and environmental organizations to identify opportunities.' },
                { year: 'Year 3', title: 'First Action',        desc: 'Funds begin supporting conservation through strategic partnerships or land acquisition.' },
                { year: 'Year 4', title: 'Stewardship',         desc: 'Caring for protected land and expanding impact responsibly.' },
                { year: 'Year 5', title: 'Lasting Protection',  desc: 'Conservation easements, partnerships, and permanent protections.' },
              ].map((step, idx) => (
                <div key={step.title} className="flex gap-5 items-start">
                  <div
                    className="shrink-0 w-12 h-12 flex items-center justify-center border"
                    style={{ borderColor: 'rgba(134, 168, 154, 0.5)', background: 'rgba(44, 88, 64, 0.25)' }}
                  >
                    <span className="text-xl leading-none" style={{ fontFamily: H_FONT, color: '#86A89A' }}>
                      {idx + 1}
                    </span>
                  </div>
                  <div className="flex-1 pt-1.5">
                    <div className="text-base md:text-[17px] uppercase tracking-[0.03em] leading-tight text-white" style={{ fontFamily: H_FONT }}>
                      {step.year} — {step.title}
                    </div>
                    <p className="mt-2 text-sm md:text-[15px] leading-[1.65]" style={{ color: 'rgba(255,255,255,0.6)', fontFamily: B_FONT }}>
                      {step.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* PRICING — clean white card with a single big number and a green CTA. */}
        <section id="pricing" className="bg-white py-24 md:py-32 px-6">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-14">
              <p className={eyebrow} style={{ color: MUTED }}>One plan · no tiers</p>
              <h2 className="uppercase tracking-[0.02em] mt-4 leading-[0.95]" style={{ fontFamily: H_FONT, fontSize: 'clamp(2rem, 4.5vw, 3.75rem)', color: INK }}>
                Pricing
              </h2>
            </div>

            <div className="border p-10 md:p-16 text-center" style={{ borderColor: HAIRLINE }}>
              <div className="mb-4 flex items-baseline justify-center">
                <span className="leading-none" style={{ fontFamily: H_FONT, fontSize: 'clamp(4rem, 9vw, 6.5rem)', color: INK, letterSpacing: '0.01em' }}>
                  $99
                </span>
                <span className="text-xl md:text-2xl ml-3" style={{ color: MUTED }}>/mo</span>
              </div>
              <p className="text-[15px] md:text-base" style={{ color: MUTED }}>
                Or <strong style={{ color: INK }}>$999/year</strong> — saves $189.
                14-day free trial, no credit card.
              </p>

              <div className="my-10 mx-auto max-w-2xl grid sm:grid-cols-2 gap-x-8 gap-y-3 text-left">
                {PRICING_INCLUDES.map(f => (
                  <div key={f} className="text-[14px] md:text-[15px] flex items-baseline gap-3" style={{ color: '#2a2a2a' }}>
                    <span aria-hidden="true" className="text-base" style={{ color: FOREST }}>—</span>
                    {f}
                  </div>
                ))}
              </div>

              <button onClick={openSignup} className={btnPrimary} style={{ background: FOREST, color: '#fff' }}>
                Start free trial
              </button>

              <p className="mt-6 text-xs" style={{ color: MUTED }}>
                Cancel anytime · export your data anytime · questions →{' '}
                <a href="mailto:support@inktracker.app" className="underline underline-offset-2" style={{ color: INK }}>support@inktracker.app</a>
              </p>
            </div>
          </div>
        </section>

        {/* FAQ — massive title, full-width accordion rows with hairline rules. */}
        <section id="faq" className="bg-white py-24 md:py-32 px-6 border-t" style={{ borderColor: HAIRLINE }}>
          <div className="max-w-4xl mx-auto">
            <h2 className="uppercase tracking-[0.02em] text-center mb-14 leading-[0.95]" style={{ fontFamily: H_FONT, fontSize: 'clamp(2rem, 4.5vw, 3.75rem)', color: INK }}>
              Frequently asked questions
            </h2>
            <div className="border-t" style={{ borderColor: HAIRLINE }}>
              {FAQ_ITEMS.map((item) => (
                <details key={item.q} className="group border-b" style={{ borderColor: HAIRLINE }}>
                  <summary className="cursor-pointer list-none flex items-center justify-between gap-6 py-6 md:py-7">
                    <span className="uppercase tracking-[0.04em] leading-tight" style={{ fontFamily: H_FONT, color: INK, fontSize: 'clamp(1rem, 1.6vw, 1.25rem)' }}>
                      {item.q}
                    </span>
                    <span className="text-2xl leading-none shrink-0 transition-transform group-open:rotate-45" style={{ color: MUTED }}>+</span>
                  </summary>
                  <p className="pb-7 pr-10 text-[15px] md:text-base leading-[1.7]" style={{ color: MUTED }}>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* FINAL CTA */}
        <section className="bg-white py-24 md:py-32 px-6 text-center border-t" style={{ borderColor: HAIRLINE }}>
          <div className="max-w-3xl mx-auto">
            <h2 className="uppercase tracking-[0.02em] leading-[0.95]" style={{ fontFamily: H_FONT, fontSize: 'clamp(2rem, 5vw, 4.25rem)', color: INK }}>
              Run your shop
              <br />
              like you mean it.
            </h2>
            <div className="mt-10">
              <button onClick={openSignup} className={btnPrimary} style={{ background: FOREST, color: '#fff' }}>
                Start 14-day trial
              </button>
            </div>
            <p className="mt-6 text-xs tracking-wide" style={{ color: MUTED }}>
              No credit card · 90-second signup
            </p>
          </div>
        </section>

        {/* FOOTER — minimal, hairline top border. */}
        <footer className="bg-white border-t py-12 md:py-14 px-6" style={{ borderColor: HAIRLINE }}>
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center md:items-start justify-between gap-8 text-center md:text-left">
            <div className="max-w-sm">
              <p className="uppercase tracking-[0.04em] text-lg leading-none mb-3" style={{ fontFamily: H_FONT, color: INK }}>
                Ink<span style={{ color: FOREST }}>Tracker</span>
              </p>
              <p className="text-[13px] leading-[1.65]" style={{ color: MUTED }}>
                Made by{' '}
                <a href="https://biotamfg.com" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2" style={{ color: INK }}>Biota Mfg</a>
                {' '}in the Reno/Tahoe area. Every subscription funds land conservation through{' '}
                <a href="https://biotamfg.com/pages/wildways" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2" style={{ color: FOREST }}>Wildways</a>.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center md:justify-end gap-x-7 gap-y-3">
              {[
                ["#tour", "Tour"],
                ["#wildways", "Wildways"],
                ["#pricing", "Pricing"],
                ["#faq", "FAQ"],
                ["mailto:support@inktracker.app", "Support"],
                ["/privacy", "Privacy"],
                ["/terms", "Terms"],
              ].map(([href, label]) => (
                <a key={label} href={href} className={navLink} style={{ color: MUTED }}>
                  {label}
                </a>
              ))}
            </div>
          </div>
          <p className="mt-10 pt-6 border-t text-[11px] tracking-[0.22em] uppercase text-center" style={{ borderColor: HAIRLINE, color: MUTED, fontFamily: H_FONT }}>
            © 2026 Biota Mfg · Reno/Tahoe
          </p>
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
// Activation backstop. After 20260517_harden_trial_activation.sql, new
// self-signups land at role='shop' directly and this component should
// almost never render. It only fires when a user's profile is somehow
// stuck at role='user' — legacy data, partial trigger failure, manual
// DB edit, etc.
//
// On mount: calls activate_trial RPC, interprets the response via the
// pure helper in src/lib/auth/trialActivation.js, retries on transient
// failures with bounded backoff, surfaces real errors to the user with
// a retry button. NEVER fail silently; NEVER auto-reload the page (the
// old behavior dumped users straight to PendingApprovalPage with no
// signal of what went wrong).
function PostConfirmSpinner() {
  const { checkAppState } = useAuth();
  const [attempt, setAttempt]   = useState(0);  // increments to trigger retries
  const [phase, setPhase]       = useState("activating"); // 'activating' | 'success' | 'error'
  const [errorMessage, setErrorMessage] = useState("");
  const [errorRetryable, setErrorRetryable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Walk the backoff schedule. Attempt 0 fires immediately; later
      // attempts wait `activationRetryDelayMs(n)` between tries.
      const delay = attempt === 0 ? 0 : activationRetryDelayMs(attempt);
      if (delay === null) {
        // Exhausted retries — show an error with manual retry.
        if (!cancelled) {
          setPhase("error");
          setErrorMessage("Activation kept failing. Please try again or contact support@inktracker.app.");
          setErrorRetryable(true);
        }
        return;
      }
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      if (cancelled) return;

      let rpcResult = null;
      let rpcError = null;
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (!authUser) {
          rpcError = { message: "No authenticated user found" };
        } else {
          const out = await supabase.rpc("activate_trial", { user_auth_id: authUser.id });
          rpcResult = out.data;
          rpcError = out.error;
        }
      } catch (err) {
        rpcError = err;
      }
      if (cancelled) return;

      const decision = interpretActivationResponse({ rpcResult, rpcError });
      if (decision.state === ACTIVATION_STATES.SUCCESS) {
        setPhase("success");
        // Refetch profile so the parent unmounts this component.
        checkAppState({ silent: false });
        return;
      }
      if (decision.state === ACTIVATION_STATES.RETRYABLE && attempt < MAX_ACTIVATION_ATTEMPTS) {
        setAttempt((a) => a + 1);
        return;
      }
      // PERMANENT, or retry attempts exhausted.
      setPhase("error");
      setErrorMessage(decision.message);
      setErrorRetryable(decision.retryable);
    })();
    return () => { cancelled = true; };
  }, [attempt, checkAppState]);

  if (phase === "error") {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-white gap-4 px-6">
        <div className="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center">
          <span className="text-rose-600 font-bold text-xl">!</span>
        </div>
        <div className="text-base font-semibold text-slate-900">Couldn't finish setup</div>
        <div className="text-sm text-slate-500 max-w-md text-center">{errorMessage}</div>
        <div className="flex gap-3 mt-2">
          {errorRetryable && (
            <button
              onClick={() => { setAttempt(0); setPhase("activating"); setErrorMessage(""); }}
              className="px-4 py-2 text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-lg"
            >
              Try again
            </button>
          )}
          <a
            href="mailto:support@inktracker.app?subject=InkTracker activation issue"
            className="px-4 py-2 text-sm font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-lg"
          >
            Email support
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-white gap-4">
      <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      <div className="text-sm text-slate-500">
        {attempt === 0 ? "Setting up your account…" : `Retrying… (${attempt}/${MAX_ACTIVATION_ATTEMPTS})`}
      </div>
      {attempt > 0 && (
        <button
          onClick={() => { setPhase("error"); setErrorMessage("Cancelled the retry loop. Try again to resume."); setErrorRetryable(true); }}
          className="mt-2 px-4 py-2 text-sm font-semibold text-slate-400 hover:text-slate-700"
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
              <RouteErrorBoundary><MainPage /></RouteErrorBoundary>
            </LayoutWrapper>
          }
        />

        {Object.entries(Pages).map(([path, Page]) => (
          <Route
            key={path}
            path={`/${path}`}
            element={
              <LayoutWrapper currentPageName={path}>
                <RouteErrorBoundary><Page /></RouteErrorBoundary>
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
  const { isLoadingAuth, isAuthenticated, user } = useAuth();
  const location = useLocation();

  const isPublicRoute = useMemo(() => {
    const pathname = (location.pathname || "/").toLowerCase();
    return PUBLIC_PATHS.has(pathname);
  }, [location.pathname]);

  // Trial activation is now handled by PostConfirmSpinner itself
  // (which is rendered when user?.role === 'user') and primarily by
  // the handle_new_user trigger which sets role='shop' directly for
  // self-signups — see supabase/migrations/20260517_harden_trial_activation.sql.
  // The previous fire-and-forget useEffect here logged failures to
  // console and let the user get stranded on PostConfirmSpinner; the
  // new spinner component retries + surfaces real errors.

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

  // Brokers belong in their own portal. As of the shared-routes
  // refactor (PRs #283/#284), brokers can also reach the shared
  // top-level routes (Quotes, Orders, Customers, Invoices,
  // Performance) which dispatch to the broker variant via the
  // *Route components in pages.config.js. Anywhere else, bounce
  // them back to /BrokerDashboard. Source of truth for the
  // allowlist is lib/broker/roleRedirect — Layout.jsx uses the same
  // list for its own check, so both layers stay in sync.
  if (user.role === "broker") {
    const pageName = location.pathname.replace(/^\//, "");
    if (!BROKER_ALLOWED_PAGES.includes(pageName)) {
      window.location.replace("/BrokerDashboard");
      return <FullScreenSpinner />;
    }
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

  // Check trial expiry. Admins (founder / staff) bypass billing
  // gating entirely — their account has permanent access regardless
  // of subscription_tier / trial_ends_at state.
  const isAdminBypass = user?.role === "admin";
  const trialExpired = user?.subscription_tier === "trial" && user?.trial_ends_at && new Date(user.trial_ends_at) < new Date();
  const isExpired = !isAdminBypass && (trialExpired || user?.subscription_tier === "expired" || user?.subscription_status === "canceled");

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

  // AuthProvider is always mounted, even on "public" routes. The provider
  // doesn't REQUIRE an authenticated user — it just makes the context
  // available. Without it, components like SendQuoteModal that call
  // useBillingGate() → useAuth() crash on the broker portal (which is in
  // PUBLIC_PATHS to bypass the shop-side role redirects). The public
  // distinction is purely about which routing tree we render — auth
  // context is universal.
  return (
    <AuthProvider>
      {isPublic ? <AppRoutes /> : <AuthenticatedApp />}
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