import { useState, useMemo } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import ModalBackdrop from "@/components/shared/ModalBackdrop";
import { describeMergeFor, formatMergeValue } from "@/lib/customers/mergeCustomerData";
import { Loader2, GitMerge, Check, AlertTriangle, RefreshCw } from "lucide-react";
import { notify } from "@/lib/notify";

export default function MergeDuplicatesModal({ customers, user, onMerge, onClose, supabaseFuncUrl }) {
  const [merging, setMerging] = useState(false);
  const [merged, setMerged] = useState([]);
  // Confirm dialog state — single overlay shared across groups.
  const [confirm, setConfirm] = useState(null); // { key, primary, duplicates, descriptions }
  // QB reconcile state, keyed by group index → { loading, results: [{id, status, ...}] }
  const [reconcile, setReconcile] = useState({});

  const duplicateGroups = useMemo(() => {
    const groups = [];
    const used = new Set();
    const normalize = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

    for (let i = 0; i < customers.length; i++) {
      if (used.has(customers[i].id)) continue;
      const group = [customers[i]];
      const companyKey = normalize(customers[i].company);
      const emailKey = (customers[i].email || "").toLowerCase().trim();

      for (let j = i + 1; j < customers.length; j++) {
        if (used.has(customers[j].id)) continue;
        const c2 = normalize(customers[j].company);
        const e2 = (customers[j].email || "").toLowerCase().trim();

        const companyMatch = companyKey && c2 && (companyKey === c2 || companyKey.includes(c2) || c2.includes(companyKey));
        const emailMatch = emailKey && e2 && emailKey === e2;

        if (companyMatch || emailMatch) {
          group.push(customers[j]);
          used.add(customers[j].id);
        }
      }
      if (group.length > 1) {
        used.add(customers[i].id);
        groups.push(group);
      }
    }
    return groups;
  }, [customers]);

  // Stable identity for a group, independent of its position in the list.
  // State (selected keeper, merged badge, reconcile results) is keyed by this,
  // NOT the array index — after a merge the parent drops the merged ids, the
  // groups recompute and RE-INDEX, and index-keyed state would then paint the
  // "Merged" badge / selection onto a different, unmerged group.
  const groupKey = (group) => group.map((c) => c.id).sort().join("|");

  // Keeper selection per group key; reads default to 0 (first member).
  const [selected, setSelected] = useState({});

  // Per-group QB status: how many customers in the group are linked
  // to a QuickBooks customer. Drives whether we surface a merge
  // button (≤1 linked = safe) or a "merge in QB first" panel (≥2
  // linked, because an InkTracker merge would leave an orphan QB
  // customer pointing at nothing).
  function groupQbStatus(group) {
    const linked = group.filter((c) => !!c.qb_customer_id);
    return {
      linkedCount: linked.length,
      multiLinked: linked.length >= 2,
      linked,
    };
  }

  async function runActualMerge(key, primary, duplicates) {
    setMerging(true);
    try {
      await onMerge(primary, duplicates);
      setMerged(prev => [...prev, key]);
    } catch (err) {
      notify.error("Merge failed", err);
    } finally {
      setMerging(false);
    }
  }

  // Called when the operator hits "Merge into selected" on a safe
  // (≤1 QB-linked) group. Builds a per-duplicate preview of what
  // will move using describeMergeFor, opens the confirm dialog.
  function handleMergeClick(group) {
    const key = groupKey(group);
    const primaryIdx = selected[key] || 0;
    const primary = group[primaryIdx];
    const duplicates = group.filter((_, i) => i !== primaryIdx);
    const descriptions = duplicates.map((dup) => ({
      dup,
      items: describeMergeFor(primary, dup),
    }));
    setConfirm({ key, primary, duplicates, descriptions });
  }

  // Read-only QB query for every linked customer in the group. Used
  // after the operator has merged them inside QuickBooks — we ping
  // each qb_customer_id to figure out which one is now Active=false
  // (the loser of the QB merge) so we can finish the InkTracker side
  // safely. No destructive QB write is ever attempted from here.
  async function handleReconcile(group) {
    const key = groupKey(group);
    setReconcile(prev => ({ ...prev, [key]: { loading: true, results: null, error: null } }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not signed in");
      const results = [];
      for (const c of group) {
        if (!c.qb_customer_id) {
          results.push({ id: c.id, name: c.name, qbStatus: "not_linked" });
          continue;
        }
        const { data, error } = await base44.functions.invoke("qbSync", {
          action: "lookupCustomerById",
          accessToken: session.access_token,
          customerId: c.qb_customer_id,
        });
        if (error) throw error;
        results.push({
          id: c.id,
          name: c.name,
          qbStatus: data?.status || "unknown",
          mergedIntoId: data?.mergedIntoId || null,
        });
      }
      setReconcile(prev => ({ ...prev, [key]: { loading: false, results, error: null } }));
    } catch (err) {
      setReconcile(prev => ({ ...prev, [key]: { loading: false, results: null, error: err.message || String(err) } }));
    }
  }

  // After reconcile, if exactly one customer is Active in QB and the
  // others are Inactive/notfound (i.e. QB merge was already done),
  // the operator can finish the InkTracker side. We pick the active
  // one as primary and merge everyone else into it.
  function handleReconcileMerge(group) {
    const key = groupKey(group);
    const { results } = reconcile[key] || {};
    if (!results) return;
    const activeIdx = group.findIndex((c) => {
      const r = results.find(rr => rr.id === c.id);
      return r?.qbStatus === "active";
    });
    if (activeIdx < 0) {
      notify.error("Can't reconcile", "Need exactly one Active QB customer in the group.");
      return;
    }
    const primary = group[activeIdx];
    const duplicates = group.filter((_, i) => i !== activeIdx);
    const descriptions = duplicates.map((dup) => ({
      dup,
      items: describeMergeFor(primary, dup),
    }));
    setConfirm({ key, primary, duplicates, descriptions });
  }

  return (
    <ModalBackdrop onClose={onClose} z="z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <GitMerge className="w-5 h-5 text-teal-600" /> Customer Duplicates
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {duplicateGroups.length} potential duplicate group{duplicateGroups.length !== 1 ? "s" : ""} found
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {duplicateGroups.length === 0 && (
            <div className="px-6 py-12 text-center text-sm text-slate-500">No duplicates detected.</div>
          )}

          {duplicateGroups.map((group, gi) => {
            const key = groupKey(group);
            if (merged.includes(key)) return (
              <div key={key} className="px-6 py-4 border-b border-slate-50 bg-emerald-50 flex items-center gap-2 text-sm text-emerald-700 font-semibold">
                <Check className="w-4 h-4" /> Merged
              </div>
            );

            const qb = groupQbStatus(group);
            const rec = reconcile[key];
            const keeperIdx = selected[key] ?? 0;

            return (
              <div key={key} className="px-6 py-4 border-b border-slate-100">
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">
                  Group {gi + 1} — {group.length} records
                </div>
                <div className="space-y-2">
                  {group.map((c, ci) => {
                    // Reconcile result tag, if available
                    const recRow = rec?.results?.find((r) => r.id === c.id);
                    return (
                      <label key={c.id}
                        className={`flex items-center gap-3 p-3 rounded-xl border ${qb.multiLinked ? "cursor-default" : "cursor-pointer"} transition ${keeperIdx === ci && !qb.multiLinked ? "border-teal-400 bg-teal-50" : "border-slate-100 hover:border-slate-200"}`}>
                        {!qb.multiLinked && (
                          <input type="radio" name={`group-${key}`} checked={keeperIdx === ci}
                            onChange={() => setSelected(prev => ({ ...prev, [key]: ci }))}
                            className="accent-teal-600" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm text-slate-800">{c.name}</div>
                          <div className="text-xs text-slate-500 flex items-center gap-2 flex-wrap">
                            <span>{[c.company, c.email, c.phone].filter(Boolean).join(" · ") || "No details"}</span>
                            {c.qb_customer_id && <span className="text-emerald-600 font-semibold">QB linked</span>}
                            {recRow?.qbStatus === "active" && <span className="text-emerald-600 font-semibold bg-emerald-50 px-1.5 rounded">QB · Active</span>}
                            {recRow?.qbStatus === "inactive" && <span className="text-amber-600 font-semibold bg-amber-50 px-1.5 rounded">QB · Inactive</span>}
                            {recRow?.qbStatus === "notfound" && <span className="text-slate-500 font-semibold bg-slate-100 px-1.5 rounded">QB · Not found</span>}
                          </div>
                        </div>
                        {!qb.multiLinked && keeperIdx === ci && (
                          <span className="text-xs font-semibold text-teal-600 bg-teal-100 px-2 py-0.5 rounded-full">Keep</span>
                        )}
                      </label>
                    );
                  })}
                </div>

                {qb.multiLinked ? (
                  /* ─── BOTH (or more) sides are QB-linked ──────────
                     Don't expose a merge button. An InkTracker merge
                     here would orphan the loser's QB customer. The
                     correct flow is: merge them in QuickBooks first
                     (Settings → Customers → Merge), then click
                     Reconcile to let InkTracker follow what QB did.
                     The Reconcile button only reads from QB — it can
                     never damage the QB side. */
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 text-xs leading-snug text-amber-900">
                        <p className="font-semibold mb-1">{qb.linkedCount} customers are linked to QuickBooks.</p>
                        <p>
                          To merge safely, first merge them inside QuickBooks
                          (<span className="font-mono">Settings → Customers → Merge</span>). When that's done, click <span className="font-semibold">Reconcile from QuickBooks</span> below — InkTracker will follow the merge QB did. <span className="text-amber-700/80">Read-only check. Never writes to QuickBooks.</span>
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => handleReconcile(group)}
                        disabled={rec?.loading}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 px-3 py-1.5 rounded-lg transition disabled:opacity-50"
                      >
                        {rec?.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                        Reconcile from QuickBooks
                      </button>
                      {rec?.error && (
                        <span className="text-xs text-rose-600">{rec.error}</span>
                      )}
                      {rec?.results && !rec.loading && (() => {
                        const activeCount = rec.results.filter(r => r.qbStatus === "active").length;
                        if (activeCount === 1) {
                          return (
                            <button
                              onClick={() => handleReconcileMerge(group)}
                              disabled={merging}
                              className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 px-3 py-1.5 rounded-lg transition disabled:opacity-50"
                            >
                              <GitMerge className="w-3.5 h-3.5" />
                              Finish merge in InkTracker
                            </button>
                          );
                        }
                        if (activeCount === 0) {
                          return <span className="text-xs text-amber-700">No active QB record — review manually.</span>;
                        }
                        return <span className="text-xs text-amber-700">{activeCount} customers still active in QB — finish merging there first.</span>;
                      })()}
                    </div>
                  </div>
                ) : (
                  /* ─── Safe to merge in InkTracker ─────────────────
                     0 or 1 QB-linked customers in the group. The
                     additive-merge helper handles everything; the
                     confirm dialog shows the operator the exact diff
                     before any write happens. */
                  <button onClick={() => handleMergeClick(group)} disabled={merging}
                    className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 px-3 py-1.5 rounded-lg transition disabled:opacity-50">
                    {merging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitMerge className="w-3.5 h-3.5" />}
                    Merge into selected
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700">Close</button>
          <div className="text-xs text-slate-500">Select the record to keep, others will be merged into it</div>
        </div>
      </div>

      {/* Confirm dialog — exact diff before any write commits */}
      {confirm && (
        <ModalBackdrop onClose={() => setConfirm(null)} z="z-[60]">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Confirm merge</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Survivor: <span className="font-semibold text-slate-800">{confirm.primary.name}</span>
              </p>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 text-sm">
              <p className="text-xs text-slate-500">
                Every quote, order, and invoice attached to the duplicate{confirm.duplicates.length > 1 ? "s" : ""} below will be re-pointed at <span className="font-semibold text-slate-700">{confirm.primary.name}</span>. The duplicate row{confirm.duplicates.length > 1 ? "s are" : " is"} then deleted from InkTracker. Quickbooks is not changed.
              </p>
              {confirm.descriptions.map(({ dup, items }) => (
                <div key={dup.id} className="border border-slate-100 rounded-xl p-3">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">
                    Merging in: <span className="text-slate-800 normal-case">{dup.name}</span>
                  </div>
                  {items.length === 0 ? (
                    <p className="text-xs text-slate-500 italic">No new fields to copy — survivor already has everything this record had.</p>
                  ) : (
                    <ul className="text-xs space-y-1 list-disc list-inside text-slate-600">
                      {items.map((it, idx) => {
                        if (it.mode === "append" && it.field === "notes") {
                          return <li key={idx}><span className="font-semibold">Notes</span> — appended (kept primary's, added this one's)</li>;
                        }
                        if (it.mode === "union" && it.field === "saved_imprints") {
                          return <li key={idx}><span className="font-semibold">Saved imprints</span> — merged (no duplicates)</li>;
                        }
                        const label = it.field.replace(/_/g, " ");
                        return <li key={idx}>Fill <span className="font-semibold">{label}</span>: {formatMergeValue(it.to ?? it.from)}</li>;
                      })}
                    </ul>
                  )}
                </div>
              ))}
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirm(null)}
                className="text-sm font-semibold text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const { key, primary, duplicates } = confirm;
                  setConfirm(null);
                  await runActualMerge(key, primary, duplicates);
                }}
                disabled={merging}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 px-4 py-1.5 rounded-lg transition disabled:opacity-50"
              >
                <GitMerge className="w-4 h-4" />
                Merge
              </button>
            </div>
          </div>
        </ModalBackdrop>
      )}
    </ModalBackdrop>
  );
}
