// Shop-wide activity feed — the change_log surfaced as "what happened
// lately" instead of per-document history. With DB triggers recording
// every quote/order/invoice change (20260911), this answers the daily
// team question — "what moved since I last looked?" — without opening
// documents one by one.
//
// Self-contained and RLS-scoped: owners and managers see their shop's
// rows; anyone without change_log read (brokers, employees) gets
// nothing rendered at all.

import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { History, Building2, Laptop, Cog, ChevronDown } from "lucide-react";
import { base44 } from "@/api/supabaseClient";
import { createPageUrl } from "@/utils";

const SOURCE_META = {
  quickbooks: { label: "QuickBooks", Icon: Building2, cls: "text-emerald-600" },
  inktracker: { label: "InkTracker", Icon: Laptop,    cls: "text-teal-600" },
  system:     { label: "Automatic",  Icon: Cog,       cls: "text-slate-500" },
};

const PAGE_FOR_ENTITY = { invoice: "Invoices", quote: "Quotes", order: "Orders" };

// Live-testing sessions create documents under the reserved TEST/DEMO code
// namespace (e.g. ORD-TEST-PREFS, ORD-DEMO-E2E) and clean them up after.
// Real codes are always ORD-<year>-<base36> (generateOrderId), so this can
// never hide a customer document. Keep the feed telling the shop's story,
// not the test bench's.
export const isTestArtifact = (e) => /^[A-Z]+-(TEST|DEMO)\b/i.test(String(e?.entity_ref || ""));

const INITIAL = 8;
const EXPANDED = 30;

export default function ActivityFeed() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await base44.entities.ChangeLog.list("-created_at", EXPANDED);
        if (!cancelled) setEntries((Array.isArray(rows) ? rows : []).filter((e) => !isTestArtifact(e)));
      } catch (err) {
        // No read access (broker/employee) or table missing — stay invisible.
        console.error("[ActivityFeed] load failed:", err?.message ?? err);
        if (!cancelled) setEntries([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading || entries.length === 0) return null;

  const visible = expanded ? entries : entries.slice(0, INITIAL);

  const dayLabel = (iso) => {
    const d = new Date(iso);
    const today = new Date();
    const yest = new Date(today); yest.setDate(today.getDate() - 1);
    const same = (a, b) => a.toDateString() === b.toDateString();
    if (same(d, today)) return "Today";
    if (same(d, yest)) return "Yesterday";
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  };

  // Group visible entries by day for scannability.
  const groups = [];
  for (const e of visible) {
    const label = dayLabel(e.created_at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(e);
    else groups.push({ label, rows: [e] });
  }

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <History className="w-4 h-4 text-slate-500" />
        <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Recent Activity</h2>
      </div>
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.label}>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">{g.label}</div>
            <div className="space-y-2.5">
              {g.rows.map((e) => {
                const meta = SOURCE_META[e.source] ?? SOURCE_META.system;
                const { Icon } = meta;
                const page = PAGE_FOR_ENTITY[e.entity_type];
                const changes = Array.isArray(e.changes) ? e.changes : [];
                const inner = (
                  <div className="flex gap-2.5 items-start">
                    <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${meta.cls}`} />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-slate-700 dark:text-slate-200 truncate">
                        <span className="font-semibold">{e.entity_ref || e.entity_type}</span>
                        {" — "}{e.summary}
                        {changes.length > 0 && (
                          <span className="text-slate-500"> · {changes.slice(0, 2).join("; ")}{changes.length > 2 ? "…" : ""}</span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {new Date(e.created_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                        {" · "}{e.actor ? e.actor : `via ${meta.label}`}
                      </div>
                    </div>
                  </div>
                );
                return page ? (
                  <Link key={e.id} to={createPageUrl(`${page}?id=${encodeURIComponent(e.entity_id)}`)} className="block hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg px-1.5 py-1 -mx-1.5 transition">
                    {inner}
                  </Link>
                ) : (
                  <div key={e.id} className="px-1.5 py-1 -mx-1.5">{inner}</div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {entries.length > INITIAL && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 flex items-center gap-1 text-xs font-semibold text-teal-600 hover:text-teal-800 transition"
        >
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
          {expanded ? "Show less" : `Show more (${entries.length - INITIAL})`}
        </button>
      )}
    </div>
  );
}
