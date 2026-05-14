import { createPageUrl } from "@/utils";
import { Link } from "react-router-dom";
import { useState, useEffect } from "react";
import { base44 } from "@/api/supabaseClient";
import { Home, FileText, Package, Users, Archive, Receipt, Wand2, Code2, Settings, BarChart2, ShieldCheck, Menu, X, Palette, Lock, Truck, ChevronDown, ChevronRight } from "lucide-react";
import GlobalSearch from "./components/GlobalSearch";
import NotificationBell from "./components/NotificationBell";
import { canAccess, getEffectiveTier } from "@/lib/billing";

const ICON_MAP = {
  Dashboard: Home,
  BrokerDashboard: FileText,
  Quotes: FileText,
  Production: Package,
  Customers: Users,
  Inventory: Archive,
  PurchaseOrders: Truck,
  Invoices: Receipt,
  Performance: BarChart2,
  Wizard: Wand2,
  Embed: Code2,
  Mockups: Palette,
  Account: Settings,
  AdminPanel: ShieldCheck,
};

const NAV = [
  { label: "Dashboard", page: "Dashboard" },
  { label: "Quotes", page: "Quotes" },
  { label: "Production", page: "Production" },
  { label: "Customers", page: "Customers" },
  {
    label: "Inventory",
    page: "Inventory",
    children: [
      { label: "Purchase Orders", page: "PurchaseOrders" },
    ],
  },
  { label: "Invoices", page: "Invoices" },
  { label: "Performance", page: "Performance", feature: "reports" },
  { label: "Mockups", page: "Mockups", feature: "mockups" },
  { label: "Wizard", page: "Wizard", feature: "wizard" },
  { label: "Embed", page: "Embed", feature: "wizard" },
  { label: "Account", page: "Account" },
];

// Pages that should auto-expand a parent group when active.
const PARENT_OF = (() => {
  const m = {};
  for (const n of NAV) {
    if (n.children) for (const c of n.children) m[c.page] = n.page;
  }
  return m;
})();

// Map page names to required billing features
const PAGE_FEATURES = {
  Performance: "reports",
  Mockups: "mockups",
  Wizard: "wizard",
  Embed: "wizard",
};

const MOBILE_NAV = NAV.filter(n => !["Wizard", "Embed"].includes(n.page));

export default function Layout({ children, currentPageName }) {
  const [shopName, setShopName] = useState("Loading...");
  const [logoUrl, setLogoUrl] = useState("");
  const [user, setUser] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(null);
  // Collapsable nav groups. Persisted to localStorage so the user's
  // preference sticks across reloads. Auto-expand whichever group
  // contains the current page so deep links don't land in a collapsed
  // group with the active link hidden.
  const [expandedGroups, setExpandedGroups] = useState(() => {
    let initial = {};
    try {
      const stored = JSON.parse(localStorage.getItem("inktracker-nav-expanded") || "{}");
      if (stored && typeof stored === "object") initial = stored;
    } catch {}
    const activeParent = PARENT_OF[currentPageName] || (NAV.find(n => n.page === currentPageName && n.children)?.page);
    if (activeParent) initial = { ...initial, [activeParent]: true };
    return initial;
  });
  function toggleGroup(page) {
    setExpandedGroups((prev) => {
      const next = { ...prev, [page]: !prev[page] };
      try { localStorage.setItem("inktracker-nav-expanded", JSON.stringify(next)); } catch {}
      return next;
    });
  }

  // Render a NAV item, including locked / parent-with-children / leaf
  // shapes. `mobile` swaps in the mobile-flavoured hover classes and
  // closes the slide-out menu on click. `child` styles a sub-item:
  // smaller icon, indented, no chevron of its own.
  function renderNavItem(n, { mobile = false, child = false } = {}) {
    const active = currentPageName === n.page;
    const IconComponent = ICON_MAP[n.page];
    const locked = n.feature && !canAccess(tier, n.feature);
    const hoverCls = mobile
      ? "hover:bg-slate-50 hover:text-slate-800"
      : "hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200";
    const baseTextCls = mobile ? "text-slate-500" : "text-slate-500 dark:text-slate-400";
    const onLinkClick = mobile ? () => setMobileMenuOpen(false) : undefined;

    if (locked) {
      return (
        <button
          key={n.page}
          onClick={() => { if (mobile) setMobileMenuOpen(false); setShowUpgrade(n.feature); }}
          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition w-full text-left ${mobile ? "text-slate-300" : "text-slate-300 dark:text-slate-600 hover:text-slate-400"}`}
        >
          <IconComponent className="w-5 h-5 text-slate-300" />
          {n.label}
          <Lock className="w-3.5 h-3.5 ml-auto text-slate-300" />
        </button>
      );
    }

    const indentCls = child ? "pl-8" : "px-3";
    const iconSize = child ? "w-4 h-4" : "w-5 h-5";

    if (n.children?.length) {
      const expanded = !!expandedGroups[n.page];
      const Chevron = expanded ? ChevronDown : ChevronRight;
      return (
        <div key={n.page}>
          <div className={`flex items-stretch rounded-xl overflow-hidden ${active ? "bg-indigo-600" : ""}`}>
            <Link
              to={createPageUrl(n.page)}
              onClick={onLinkClick}
              className={`flex items-center gap-3 ${indentCls} py-2.5 text-sm font-semibold transition flex-1 min-w-0 ${active ? "text-white" : `${baseTextCls} ${hoverCls}`}`}
            >
              <IconComponent className={`${iconSize} ${active ? "" : "text-slate-400"}`} />
              <span className="flex-1 truncate">{n.label}</span>
            </Link>
            <button
              onClick={(e) => { e.preventDefault(); toggleGroup(n.page); }}
              aria-label={expanded ? `Collapse ${n.label}` : `Expand ${n.label}`}
              className={`px-2 transition ${active ? "text-white/80 hover:text-white" : "text-slate-400 hover:text-slate-600"}`}
            >
              <Chevron className="w-4 h-4" />
            </button>
          </div>
          {expanded && (
            <div className="mt-0.5 space-y-0.5">
              {n.children.map((c) => renderNavItem(c, { mobile, child: true }))}
            </div>
          )}
        </div>
      );
    }

    return (
      <Link
        key={n.page}
        to={createPageUrl(n.page)}
        onClick={onLinkClick}
        className={`flex items-center gap-3 ${indentCls} pr-3 py-2.5 rounded-xl text-sm font-semibold transition ${active ? "bg-indigo-600 text-white" : `${baseTextCls} ${hoverCls}`}`}
      >
        <IconComponent className={`${iconSize} ${active ? "" : "text-slate-400"}`} />
        <span className="flex-1">{n.label}</span>
      </Link>
    );
  }
  // Effective tier — resolves admin bypass + trial expiry + canceled
  // subscription into a single string canAccess() can check. Without
  // this, a trial with trial_ends_at in the past still passed canAccess
  // (because the literal subscription_tier stayed 'trial').
  const tier = getEffectiveTier(user);
  useEffect(() => {
    document.documentElement.classList.remove("dark");
    localStorage.removeItem("inktracker-dark");
  }, []);

  // Public pages that bypass auth entirely
  const PUBLIC_PAGES = ["BrokerDashboard", "BrokerOnboarding", "QuotePayment", "QuotePaymentSuccess", "QuotePaymentCancel", "QuoteRequest", "ShopFloor"];

  useEffect(() => {
    if (PUBLIC_PAGES.includes(currentPageName)) return;
    async function loadUser() {
      try {
        const currentUser = await base44.auth.me();
        if (!currentUser) {
          await base44.auth.redirectToLogin();
          return;
        }
        // Brokers are completely restricted to BrokerDashboard only
        if (currentUser.role === "broker") {
          if (currentPageName !== "BrokerDashboard") {
            window.location.href = createPageUrl("BrokerDashboard");
          }
          return;
        }
        // Employees only see the shop floor
        if (currentUser.role === "employee") {
          if (currentPageName !== "ShopFloor") {
            window.location.href = createPageUrl("ShopFloor");
          }
          return;
        }
        setUser(currentUser);
        setShopName(currentUser.shop_name || "My Shop");
        setLogoUrl(currentUser.logo_url || "");
      } catch (error) {
        await base44.auth.redirectToLogin();
      }
    }
    loadUser();
  }, [currentPageName]);

  // Pages that render without sidebar
  if (PUBLIC_PAGES.includes(currentPageName) || currentPageName === "ShopFloor") {
    return children;
  }

  if (!user) {
    return children;
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex overflow-x-hidden">
      {/* Sidebar — desktop only */}
      <aside data-tour="sidebar" className="hidden md:flex w-56 bg-white dark:bg-slate-900 border-r border-slate-100 dark:border-slate-800 flex-col fixed h-full z-20">
        <div className="px-5 py-5 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            {logoUrl ? (
              <img src={logoUrl} alt="Logo" className="w-8 h-8 object-contain" />
            ) : (
              <img src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/69aa650fd3e825e66ff81817/b4e2dc53f_logo.png" alt="InkTracker" className="w-8 h-8 object-contain" />
            )}
            <div className="text-base font-bold text-slate-900 dark:text-slate-100">{shopName}</div>
          </div>
          <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Shop Manager</div>
        </div>
        <nav className="flex-1 py-4 space-y-0.5 px-2">
          {NAV.map(n => renderNavItem(n))}
          {(user?.role === "admin" || user?.role === "shop") && (
            <Link to={createPageUrl("AdminPanel")}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition mt-2 border-t border-slate-100 pt-3 ${currentPageName === "AdminPanel" ? "bg-indigo-600 text-white" : "text-violet-600 hover:bg-violet-50"}`}>
              <ShieldCheck className={`w-5 h-5 ${currentPageName === "AdminPanel" ? "" : "text-violet-500"}`} />
              Admin
            </Link>
          )}
        </nav>

        <div className="px-2 py-4 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <GlobalSearch />
          </div>
          <NotificationBell />
        </div>
        <div className="px-4 py-3 border-t border-slate-100">
          <div className="text-xs text-slate-300">v1.0</div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 md:ml-56 min-h-screen max-w-full">
        {/* Mobile header */}
        <div className="md:hidden bg-white border-b border-slate-100 px-4 py-3 flex items-center gap-2 sticky top-0 z-30">
          <button onClick={() => setMobileMenuOpen(true)} className="p-1 text-slate-500 hover:text-slate-700">
            <Menu className="w-6 h-6" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-slate-900 truncate">{shopName}</div>
          </div>
          <NotificationBell />
          <GlobalSearch />
        </div>

        {/* Mobile slide-out menu */}
        {mobileMenuOpen && (
          <div className="md:hidden fixed inset-0 z-40">
            <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobileMenuOpen(false)} />
            <div className="absolute left-0 top-0 bottom-0 w-64 bg-white shadow-xl flex flex-col">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {logoUrl ? (
                    <img src={logoUrl} alt="Logo" className="w-8 h-8 object-contain" />
                  ) : (
                    <img src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/69aa650fd3e825e66ff81817/b4e2dc53f_logo.png" alt="InkTracker" className="w-8 h-8 object-contain" />
                  )}
                  <div className="text-sm font-bold text-slate-900">{shopName}</div>
                </div>
                <button onClick={() => setMobileMenuOpen(false)} className="p-1 text-slate-400 hover:text-slate-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
                {NAV.map(n => renderNavItem(n, { mobile: true }))}
                {(user?.role === "admin" || user?.role === "shop") && (
                  <Link to={createPageUrl("AdminPanel")} onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition mt-2 border-t border-slate-100 pt-3 ${currentPageName === "AdminPanel" ? "bg-indigo-600 text-white" : "text-violet-600 hover:bg-violet-50"}`}>
                    <ShieldCheck className={`w-5 h-5 ${currentPageName === "AdminPanel" ? "" : "text-violet-500"}`} />
                    Admin
                  </Link>
                )}
              </nav>
            </div>
          </div>
        )}
        <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-8 py-4 md:py-8">
          {children}
        </div>
      </main>

      {/* Upgrade modal */}
      {showUpgrade && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onMouseDown={e => { if (e.target === e.currentTarget) setShowUpgrade(null); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center" onMouseDown={e => e.stopPropagation()}>
            <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center mx-auto mb-4">
              <Lock className="w-6 h-6 text-indigo-600" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">Upgrade to unlock</h3>
            <p className="text-sm text-slate-500 mb-5">
              This feature is available on a higher plan. Upgrade to access it and more.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setShowUpgrade(null)}
                className="flex-1 text-sm font-semibold text-slate-500 border border-slate-200 py-2.5 rounded-xl hover:bg-slate-50 transition">
                Maybe later
              </button>
              <Link to={createPageUrl("Account") + "?billing=1"} onClick={() => setShowUpgrade(null)}
                className="flex-1 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 py-2.5 rounded-xl transition text-center">
                View Plans
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}