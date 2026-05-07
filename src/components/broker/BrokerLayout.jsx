import { Link } from "react-router-dom";
import { useState } from "react";
import {
  BarChart2, Users, Package, TrendingUp, MessageSquare,
  Paperclip, FolderOpen, FileText, UserCircle, Menu, X, LogOut,
} from "lucide-react";
import { base44 } from "@/api/supabaseClient";

const INKTRACKER_LOGO =
  "https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/69aa650fd3e825e66ff81817/b4e2dc53f_logo.png";

const NAV = [
  { id: "quotes", label: "Overview", icon: BarChart2 },
  { id: "clients", label: "Clients", icon: Users },
  { id: "orders", label: "Orders", icon: Package },
  { id: "performance", label: "Performance", icon: TrendingUp },
  { id: "messages", label: "Messages", icon: MessageSquare },
  { id: "documents", label: "Documents", icon: Paperclip },
  { id: "jobfiles", label: "Files", icon: FolderOpen },
  { id: "invoices", label: "Invoices", icon: FileText },
  { id: "profile", label: "Profile", icon: UserCircle },
];

export default function BrokerLayout({ user, tab, setTab, children }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const displayName = user?.display_name || user?.full_name || "Broker";
  const companyName = user?.company_name || "";

  return (
    <div className="min-h-screen bg-slate-50 flex overflow-x-hidden">
      {/* Sidebar — desktop only */}
      <aside className="hidden md:flex w-56 bg-white border-r border-slate-100 flex-col fixed h-full z-20">
        <div className="px-5 py-5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <img src={INKTRACKER_LOGO} alt="InkTracker" className="w-8 h-8 object-contain" />
            <div className="text-base font-bold text-slate-900">Broker Portal</div>
          </div>
          <div className="text-xs text-slate-400 mt-0.5 truncate">
            {displayName}{companyName ? ` · ${companyName}` : ""}
          </div>
        </div>
        <nav className="flex-1 py-4 space-y-0.5 px-2">
          {NAV.map(({ id, label, icon: Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition ${
                  active
                    ? "bg-indigo-600 text-white"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                }`}
              >
                <Icon className={`w-5 h-5 ${active ? "" : "text-slate-400"}`} />
                {label}
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
            <div className="text-sm font-bold text-slate-900 truncate">Broker Portal</div>
          </div>
        </div>

        {/* Mobile slide-out menu */}
        {mobileMenuOpen && (
          <div className="md:hidden fixed inset-0 z-40">
            <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobileMenuOpen(false)} />
            <div className="absolute left-0 top-0 bottom-0 w-64 bg-white shadow-xl flex flex-col">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <img src={INKTRACKER_LOGO} alt="InkTracker" className="w-8 h-8 object-contain" />
                  <div className="text-sm font-bold text-slate-900">Broker Portal</div>
                </div>
                <button onClick={() => setMobileMenuOpen(false)} className="p-1 text-slate-400 hover:text-slate-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
                {NAV.map(({ id, label, icon: Icon }) => {
                  const active = tab === id;
                  return (
                    <button
                      key={id}
                      onClick={() => { setTab(id); setMobileMenuOpen(false); }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition ${
                        active
                          ? "bg-indigo-600 text-white"
                          : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                      }`}
                    >
                      <Icon className={`w-5 h-5 ${active ? "" : "text-slate-400"}`} />
                      {label}
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
    </div>
  );
}
