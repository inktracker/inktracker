import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { createPageUrl } from "@/utils";
import {
  BarChart2, Users, Package, TrendingUp, MessageSquare,
  FileText, UserCircle, Menu, X, LogOut, FilePen,
} from "lucide-react";
import { base44 } from "@/api/supabaseClient";
import OnboardingAssistant from "../onboarding/OnboardingAssistant";

const INKTRACKER_LOGO =
  "https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/69aa650fd3e825e66ff81817/b4e2dc53f_logo.png";

// Quotes promoted to its own section on 2026-05-27 so the broker
// portal mirrors the shop's sidebar layout. Overview keeps KPIs +
// action feed + performance summary; the full filterable quotes list
// now lives under Quotes. The old `?tab=quotes` URL param continues
// to resolve cleanly — it now lands on the dedicated Quotes page.
const NAV = [
  { id: "overview", label: "Overview", icon: BarChart2 },
  { id: "quotes", label: "Quotes", icon: FilePen },
  { id: "clients", label: "Clients", icon: Users },
  { id: "orders", label: "Orders", icon: Package },
  { id: "performance", label: "Performance", icon: TrendingUp },
  // Paperwork + Job Files folded into Messages — file sharing now happens
  // as message attachments so there's one inbox the broker and shop both
  // watch, instead of three siloed lists.
  { id: "messages", label: "Messages", icon: MessageSquare },
  { id: "invoices", label: "Invoices", icon: FileText },
  { id: "profile", label: "Profile", icon: UserCircle },
];

// Sections with their own top-level routes — clicking them in the
// sidebar pushes a real URL instead of calling setTab. Lets brokers
// share routes with the shop side (/Quotes works for both). As each
// new section gets a dispatcher in pages.config.js, add it here.
// Sections NOT in this map keep using setTab + ?tab= within
// /BrokerDashboard (cleanest until they're each lifted out in their
// own follow-up PR).
const SECTION_ROUTES = {
  quotes: "Quotes",
  orders: "Orders",
  // Broker calls them "clients"; shop calls them "customers". Same
  // shared route — /Customers — different audience labels.
  clients: "Customers",
  invoices: "Invoices",
  performance: "Performance",
};

export default function BrokerLayout({
  user,
  tab,
  setTab,
  children,
  // Optional per-tab badge counts. Map of tab id → count (0 hides the badge).
  // Passed from BrokerDashboard which is the only place that knows the
  // current state of messages / quotes.
  badges = {},
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigate = useNavigate();

  // Section-aware click handler. Every click navigates to a URL so
  // the browser URL always reflects what's shown — no more URL-vs-
  // state drift (broker on /Quotes clicks Messages → URL stayed at
  // /Quotes pre-fix).
  //
  //   Sections with a top-level route → navigate to that route.
  //   Overview → /BrokerDashboard (clean URL, no ?tab=).
  //   Everything else (messages, profile) → /BrokerDashboard?tab=X.
  //
  // setTab prop is kept for backwards compat but no longer called
  // from here; each navigate() re-mounts BrokerDashboard and its
  // useState seed re-reads initialTab / ?tab= / default.
  function goToSection(id) {
    if (SECTION_ROUTES[id]) {
      navigate(createPageUrl(SECTION_ROUTES[id]));
      return;
    }
    if (id === "overview") {
      navigate(createPageUrl("BrokerDashboard"));
      return;
    }
    navigate(createPageUrl("BrokerDashboard") + "?tab=" + id);
  }

  const displayName = user?.display_name || user?.full_name || "Broker";
  const companyName = user?.company_name || "";

  return (
    <div className="min-h-screen bg-slate-50 flex overflow-x-hidden">
      {/* Sidebar — desktop only */}
      <aside className="hidden md:flex w-56 bg-white border-r border-slate-100 flex-col fixed h-full z-20">
        <div className="px-5 py-5 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <img src={user?.logo_url || INKTRACKER_LOGO} alt={user?.logo_url ? "Logo" : "InkTracker"} className="w-8 h-8 object-contain rounded" />
            <div className="font-display uppercase text-lg text-slate-900 leading-none">Broker Portal</div>
          </div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-slate-400 mt-2 font-bold truncate">
            {displayName}{companyName ? ` · ${companyName}` : ""}
          </div>
        </div>
        <nav className="flex-1 py-4 space-y-0.5 px-2">
          {NAV.map(({ id, label, icon: Icon }) => {
            const active = tab === id;
            const badge = badges[id] || 0;
            return (
              <button
                key={id}
                onClick={() => goToSection(id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-[0.16em] transition ${
                  active
                    ? "bg-teal-600 text-white"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                }`}
              >
                <Icon className={`w-5 h-5 ${active ? "" : "text-slate-400"}`} />
                <span className="flex-1 text-left">{label}</span>
                {badge > 0 && (
                  <span className={`text-[10px] font-bold px-1.5 min-w-[18px] h-[18px] inline-flex items-center justify-center rounded-full ${
                    active
                      ? "bg-white text-teal-600"
                      : "bg-rose-500 text-white"
                  }`}>
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="px-4 py-3 border-t border-slate-100">
          <button
            onClick={() => base44.auth.logout("/")}
            className="flex items-center gap-2 text-xs text-slate-400 hover:text-red-500 font-semibold transition w-full px-2 py-2 rounded-lg hover:bg-red-50"
          >
            <LogOut className="w-4 h-4" /> Sign Out
          </button>
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
            <div className="font-display uppercase text-base text-slate-900 truncate leading-none">Broker Portal</div>
          </div>
        </div>

        {/* Mobile slide-out menu */}
        {mobileMenuOpen && (
          <div className="md:hidden fixed inset-0 z-40">
            <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobileMenuOpen(false)} />
            <div className="absolute left-0 top-0 bottom-0 w-64 bg-white shadow-xl flex flex-col">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <img src={INKTRACKER_LOGO} alt="InkTracker" className="w-8 h-8 object-contain" />
                  <div className="font-display uppercase text-base text-slate-900 truncate leading-none">Broker Portal</div>
                </div>
                <button onClick={() => setMobileMenuOpen(false)} className="p-1 text-slate-400 hover:text-slate-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
                {NAV.map(({ id, label, icon: Icon }) => {
                  const active = tab === id;
                  const badge = badges[id] || 0;
                  return (
                    <button
                      key={id}
                      onClick={() => { goToSection(id); setMobileMenuOpen(false); }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-[0.16em] transition ${
                        active
                          ? "bg-teal-600 text-white"
                          : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                      }`}
                    >
                      <Icon className={`w-5 h-5 ${active ? "" : "text-slate-400"}`} />
                      <span className="flex-1 text-left">{label}</span>
                      {badge > 0 && (
                        <span className={`text-[10px] font-bold px-1.5 min-w-[18px] h-[18px] inline-flex items-center justify-center rounded-full ${
                          active
                            ? "bg-white text-teal-600"
                            : "bg-rose-500 text-white"
                        }`}>
                          {badge > 99 ? "99+" : badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
              <div className="px-4 py-3 border-t border-slate-100">
                <button
                  onClick={() => base44.auth.logout("/")}
                  className="flex items-center gap-2 text-xs text-slate-400 hover:text-red-500 font-semibold transition w-full px-2 py-2 rounded-lg hover:bg-red-50"
                >
                  <LogOut className="w-4 h-4" /> Sign Out
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-8 py-4 md:py-8">
          {children}
        </div>
      </main>

      {/* Help / Assistant — same widget the shop side uses. The edge
          function detects role=broker and serves the broker-specific
          system prompt + setup snapshot. */}
      {user && <OnboardingAssistant user={user} />}
    </div>
  );
}
