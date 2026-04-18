import { useEffect, useMemo, useState } from "react";
import ErrorBoundary from "@/components/ErrorBoundary";
import { Toaster } from "@/components/ui/toaster";
import Production from "./pages/Production.jsx";
import Expenses from "./pages/Expenses.jsx";
import Privacy from "./pages/Privacy.jsx";
import Terms from "./pages/Terms.jsx";
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
  "privacy",
  "terms",
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

function PublicLandingPage() {
  const [showLogin, setShowLogin] = useState(false);

  return (
    <>
      <div className="min-h-screen bg-[#F3EFE6] flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-lg bg-white rounded-3xl shadow-lg border border-slate-200 overflow-hidden">
          <div className="px-10 pt-10 pb-8 text-center">
            <img
              src={INKTRACKER_LOGO}
              alt="InkTracker"
              className="h-16 w-16 mx-auto mb-5 rounded-full shadow"
            />

            <h1 className="text-3xl font-bold text-slate-900">
              InkTracker
            </h1>

            <p className="text-sm text-slate-500 mt-2">
              Print shop management, simplified
            </p>

            <p className="text-lg text-slate-700 mt-5 font-medium leading-relaxed">
              Quotes, orders, production tracking, and invoicing — built for screen printers.
            </p>
          </div>

          <div className="px-8 pb-2">
            <div className="grid grid-cols-2 gap-2 text-xs">
              {["Quotes & Invoices", "Production Calendar", "QuickBooks Sync", "Customer Portal"].map(f => (
                <div key={f} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-600 font-medium flex items-center gap-1.5">
                  <span className="text-indigo-500">✓</span> {f}
                </div>
              ))}
            </div>
          </div>

          <div className="px-8 pt-6 pb-8">
            <button
              onClick={() => setShowLogin(true)}
              className="w-full text-center rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 px-4 transition whitespace-nowrap"
            >
              Create Account / Sign In
            </button>
          </div>
        </div>
      </div>

      <LoginModal isOpen={showLogin} onClose={() => setShowLogin(false)} />
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

      <Route
        path="/Production"
        element={
          <LayoutWrapper currentPageName="Production">
            <Production />
          </LayoutWrapper>
        }
      />

      <Route
        path="/Expenses"
        element={
          <LayoutWrapper currentPageName="Expenses">
            <Expenses />
          </LayoutWrapper>
        }
      />

      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />

      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
}

const AuthenticatedApp = () => {
  const { isLoadingAuth, isAuthenticated, user, checkAppState } = useAuth();
  const location = useLocation();

  const isPublicRoute = useMemo(() => {
    const pathname = (location.pathname || "/").toLowerCase();
    return PUBLIC_PATHS.has(pathname);
  }, [location.pathname]);

  if (isPublicRoute) {
    return <AppRoutes />;
  }

  if (isLoadingAuth) {
    return <FullScreenSpinner />;
  }

  if (!isAuthenticated) {
    return <PublicLandingPage />;
  }

  if (!user?.role || user.role === "user") {
    return <PendingApprovalPage />;
  }

  // Brokers belong in their own portal — redirect if they somehow hit the main app
  if (user.role === "broker") {
    window.location.replace("/BrokerDashboard");
    return <FullScreenSpinner />;
  }

  // Show onboarding if the user hasn't set a shop name yet
  const needsOnboarding = !user?.shop_name;

  return (
    <>
      <AppRoutes />
      {needsOnboarding && (
        <OnboardingWizard
          user={user}
          onComplete={checkAppState}
        />
      )}
    </>
  );
};

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <QueryClientProvider client={queryClientInstance}>
          <Router>
            <ErrorBoundary>
              <AuthenticatedApp />
            </ErrorBoundary>
          </Router>
          <Toaster />
        </QueryClientProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;