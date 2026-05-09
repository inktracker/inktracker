import { useEffect, useMemo, useState, useRef, lazy, Suspense } from "react";
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

const DemoBanner = lazy(() => import("./components/landing/DemoBanner"));

function PublicLandingPage() {
  const [showLogin, setShowLogin] = useState(false);
  const [loginMode, setLoginMode] = useState("signin");

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

        {/* Hero — animated demo banner */}
        <section className="pt-20">
          <Suspense fallback={
            <div className="w-full" style={{ aspectRatio: "16/9", background: "#0B0B0E" }} />
          }>
            <DemoBanner onSignup={openSignup} />
          </Suspense>
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
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-6">Integrates with the tools you already use</p>
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
            <div className="grid md:grid-cols-3 gap-5">
              {[
                { title: "Quotes & Orders", desc: "Build quotes with live garment pricing from S&S and AS Colour. Convert to orders with one click.", color: "from-indigo-500/20 to-indigo-500/5" },
                { title: "Production Tracking", desc: "Visual pipeline from art approval to shipping. Your team updates progress from any device.", color: "from-violet-500/20 to-violet-500/5" },
                { title: "Invoicing & Payments", desc: "Generate invoices, sync to QuickBooks, and send payment links directly to customers.", color: "from-emerald-500/20 to-emerald-500/5" },
                { title: "Customer Management", desc: "Track customer history, artwork files, tax status, and payment terms. Auto-merge duplicates.", color: "from-blue-500/20 to-blue-500/5" },
                { title: "Inventory & Restock", desc: "Shopify inventory sync. Order blanks from S&S Activewear and AS Colour with live pricing.", color: "from-amber-500/20 to-amber-500/5" },
                { title: "Quote Wizard", desc: "Embed a quote request form on your website. Customers build orders 24/7 and you get notified.", color: "from-rose-500/20 to-rose-500/5" },
                { title: "QuickBooks Sync", desc: "Two-way sync for invoices, expenses, and customers. Pull live P&L, balance sheet, and cash flow.", color: "from-teal-500/20 to-teal-500/5" },
                { title: "Shop Floor", desc: "Tablet-ready view for employees. Job tickets, checklists, and real-time production updates.", color: "from-orange-500/20 to-orange-500/5" },
                { title: "Mockup Designer", desc: "Place artwork on garment templates. Background removal, one-color conversion, and PDF proofs.", color: "from-purple-500/20 to-purple-500/5" },
              ].map(f => (
                <div key={f.title} className={`bg-gradient-to-b ${f.color} border border-white/10 rounded-2xl p-6 hover:border-white/20 transition`}>
                  <h3 className="text-base font-bold text-white mb-2">{f.title}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">{f.desc}</p>
                </div>
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

        {/* Pricing */}
        <section id="pricing" className="py-24 px-6 border-t border-white/5">
          <div className="max-w-xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-extrabold">Simple pricing</h2>
              <p className="text-slate-400 mt-3">One plan. Everything included. No surprises.</p>
            </div>
            <div className="bg-gradient-to-b from-indigo-600 to-indigo-700 border-2 border-indigo-400 rounded-2xl p-8 shadow-2xl shadow-indigo-900/40">
              <div className="text-center mb-6">
                <div className="mb-3">
                  <span className="text-5xl font-extrabold text-white">$99</span>
                  <span className="text-base text-indigo-200">/mo</span>
                </div>
                <p className="text-sm text-indigo-200">14-day free trial · No credit card required</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5 mb-8 px-2">
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
              <div className="text-center">
                <button onClick={openSignup}
                  className="bg-white text-indigo-700 hover:bg-indigo-50 font-bold px-10 py-3.5 rounded-xl text-base transition shadow-lg">
                  Start 14-Day Free Trial
                </button>
              </div>
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
    return <FullScreenSpinner />;
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