// Document history — who changed what, when, and where from.
//
// Reads the append-only change_log. Display only: nothing here edits
// the document, and a QuickBooks-sourced entry is a record of what QB
// did, not an offer to apply it.

import { useState, useEffect } from "react";
import { History, Building2, Laptop, Cog, ChevronRight, ChevronDown } from "lucide-react";
import { base44 } from "@/api/supabaseClient";

const SOURCE_META = {
  quickbooks: { label: "QuickBooks", Icon: Building2, cls: "text-emerald-600" },
  inktracker: { label: "InkTracker", Icon: Laptop,    cls: "text-teal-600" },
  system:     { label: "Automatic",  Icon: Cog,       cls: "text-slate-500" },
};

export default function ChangeHistory({ entityType, entityId, limit = 20 }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  // Collapsed by default (Joe, 2026-08-11): the history is reference
  // material, not something to read on every open — the header shows the
  // change count so it's clear there's something behind the chevron.
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!entityId) { setLoading(false); return; }
      try {
        const rows = await base44.entities.ChangeLog.filter(
          { entity_type: entityType, entity_id: String(entityId) },
          "-created_at",
          limit,
        );
        if (!cancelled) setEntries(Array.isArray(rows) ? rows : []);
      } catch (err) {
        // A missing table or an RLS denial must not break the modal.
        console.error("[ChangeHistory] load failed:", err?.message ?? err);
        if (!cancelled) setEntries([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [entityType, entityId, limit]);

  if (loading || entries.length === 0) return null;

  return (
    <div className="bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={`w-full flex items-center gap-2 text-left ${expanded ? "mb-3" : ""}`}
      >
        <History className="w-4 h-4 text-slate-500" />
        <div className="text-sm font-bold text-slate-900 dark:text-slate-100">History</div>
        <span className="text-xs text-slate-500">
          {entries.length} change{entries.length === 1 ? "" : "s"}
        </span>
        {expanded
          ? <ChevronDown className="w-4 h-4 text-slate-400 ml-auto" />
          : <ChevronRight className="w-4 h-4 text-slate-400 ml-auto" />}
      </button>
      {expanded && (
      <div className="space-y-3">
        {entries.map((e) => {
          const meta = SOURCE_META[e.source] ?? SOURCE_META.system;
          const { Icon } = meta;
          const changes = Array.isArray(e.changes) ? e.changes : [];
          return (
            <div key={e.id} className="flex gap-3">
              <Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${meta.cls}`} />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-slate-800 dark:text-slate-100">{e.summary}</div>
                {changes.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {changes.map((c, i) => (
                      <li key={i} className="text-xs text-slate-500 dark:text-slate-400 break-words">• {c}</li>
                    ))}
                  </ul>
                )}
                <div className="text-[10px] text-slate-500 mt-1">
                  {new Date(e.created_at).toLocaleString()}
                  {" · "}
                  {/* QuickBooks doesn't report the acting user on the
                      invoice payload, so QB rows show the source alone
                      rather than a fabricated name. */}
                  {e.actor ? `${e.actor} · in ${meta.label}` : `in ${meta.label}`}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}
