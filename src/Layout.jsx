import { createPageUrl } from "@/utils";
import { Link } from "react-router-dom";
import { useState, useEffect } from "react";
import { base44 } from "@/api/supabaseClient";
import { Home, FileText, Package, Users, Archive, Receipt, Wand2, Code2, Settings, BarChart2, CreditCard, ShieldCheck } from "lucide-react";
import GlobalSearch from "./components/GlobalSearch";

const ICON_MAP = {
  Dashboard: Home,
  BrokerDashboard: FileText,
  Quotes: FileText,
  Production: Package,
  Customers: Users,
  Inventory: Archive,
  Invoices: Receipt,
  Expenses: CreditCard,
  Performance: BarChart2,
  Wizard: Wand2,
  Embed: Code2,
  Account: Settings,
  AdminPanel: ShieldCheck,
};

const NAV = [
  { label: "Dashboard", page: "Dashboard" },
  { label: "Quotes", page: "Quotes" },
  { label: "Production", page: "Production" },
  { label: "Clients", page: "Customers" },
  { label: "Inventory", page: "Inventory" },
  { label: "Invoices", page: "Invoices" },
  { label: "Expenses", page: "Expenses" },
  { label: "Performance", page: "Performance" },
  { label: "Wizard", page: "Wizard" },
  { label: "Embed", page: "Embed" },
  { label: "Account", page: "Account" },
];

const MOBILE_NAV = NAV.filter(n => !["Wizard", "Embed"].includes(n.page));

export default function Layout({ children, currentPageName }) {
  const [shopName, setShopName] = useState("Loading...");
  const [logoUrl, setLogoUrl] = useState("");
  const [user, setUser] = useState(null);

  // Public pages that bypass auth entirely
  const PUBLIC_PAGES = ["BrokerDashboard", "BrokerOnboarding", "QuotePayment", "QuotePaymentSuccess", "QuotePaymentCancel", "QuoteRequest"];

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
        setUser(currentUser);
        setShopName(currentUser.shop_name || "My Shop");
        setLogoUrl(currentUser.logo_url || "");
      } catch (error) {
        await base44.auth.redirectToLogin();
      }
    }
    loadUser();
  }, [currentPageName]);

  // Public pages render with no layout chrome
  if (PUBLIC_PAGES.includes(currentPageName)) {
    return children;
  }

  if (!user) {
    return children;
  }

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar — desktop only */}
      <aside className="hidden md:flex w-56 bg-white border-r border-slate-100 flex-col fixed h-full z-20">
        <div className="px-5 py-5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            {logoUrl ? (
              <img src={logoUrl} alt="Logo" className="w-8 h-8 object-contain" />
            ) : (
              <img src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/69aa650fd3e825e66ff81817/b4e2dc53f_logo.png" alt="InkTracker" className="w-8 h-8 object-contain" />
            )}
            <div className="text-base font-bold text-slate-900">{shopName}</div>
          </div>
          <div className="text-xs text-slate-400 mt-0.5">Shop Manager</div>
        </div>
        <nav className="flex-1 py-4 space-y-0.5 px-2">
          {NAV.map(n => {
            const active = currentPageName === n.page;
            const IconComponent = ICON_MAP[n.page];
            return (
              <Link key={n.page} to={createPageUrl(n.page)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition ${active ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"}`}>
                <IconComponent className={`w-5 h-5 ${active ? "" : "text-slate-400"}`} />
                {n.label}
              </Link>
            );
          })}
          {user?.role === "admin" && (
            <Link to={createPageUrl("AdminPanel")}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition mt-2 border-t border-slate-100 pt-3 ${currentPageName === "AdminPanel" ? "bg-indigo-600 text-white" : "text-violet-600 hover:bg-violet-50"}`}>
              <ShieldCheck className={`w-5 h-5 ${currentPageName === "AdminPanel" ? "" : "text-violet-500"}`} />
              Admin
            </Link>
          )}
        </nav>

        <div className="px-2 py-4 border-t border-slate-100">
          <GlobalSearch />
        </div>
        <div className="px-5 py-4 border-t border-slate-100">
          <div className="text-xs text-slate-300">v1.0</div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 md:ml-56 min-h-screen pb-20 md:pb-0">
        {/* Mobile header */}
        <div className="md:hidden bg-white border-b border-slate-100 px-4 py-3 flex items-center gap-2 sticky top-0 z-10">
          {logoUrl ? (
            <img src={logoUrl} alt="Logo" className="w-8 h-8 object-contain" />
          ) : (
            <img src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/69aa650fd3e825e66ff81817/b4e2dc53f_logo.png" alt="InkTracker" className="w-8 h-8 object-contain" />
          )}
          <div className="flex-1">
            <div className="text-sm font-bold text-slate-900">{shopName}</div>
            <div className="text-xs text-slate-400">{NAV.find(n=>n.page===currentPageName)?.label || ""}</div>
          </div>
          <GlobalSearch />
        </div>
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-6 md:py-8">
          {children}
        </div>
      </main>

      {/* Bottom swipeable nav — mobile only */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-100 z-20">
        <div
          className="flex overflow-x-auto"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none", WebkitOverflowScrolling: "touch" }}
        >
          {NAV.map(n => {
            const active = currentPageName === n.page;
            const IconComponent = ICON_MAP[n.page];
            return (
              <Link key={n.page} to={createPageUrl(n.page)}
                className={`flex flex-col items-center justify-center py-3 px-4 gap-0.5 text-center transition shrink-0 ${active ? "text-indigo-600 border-t-2 border-indigo-600" : "text-slate-400 border-t-2 border-transparent"}`}>
                <IconComponent className="w-5 h-5" />
                <span className="text-[10px] font-semibold whitespace-nowrap">{n.label}</span>
              </Link>
            );
          })}
          {user?.role === "admin" && (
            <Link to={createPageUrl("AdminPanel")}
              className={`flex flex-col items-center justify-center py-3 px-4 gap-0.5 text-center transition shrink-0 ${currentPageName === "AdminPanel" ? "text-indigo-600 border-t-2 border-indigo-600" : "text-violet-500 border-t-2 border-transparent"}`}>
              <ShieldCheck className="w-5 h-5" />
              <span className="text-[10px] font-semibold whitespace-nowrap">Admin</span>
            </Link>
          )}
        </div>
      </nav>
    </div>
  );
}