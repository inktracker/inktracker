import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/api/supabaseClient";
import { InlineLinesSkeleton } from "@/components/shared/Skeletons";
import { normalizePresses, serializePresses } from "@/lib/presses/normalizePresses";
import { notify } from "@/lib/notify";
import { shopScope } from "@/lib/shopScope";

// Shop-configured press list, extracted verbatim from Account.jsx as a pure
// decomposition — no behavior change. Drives the "Assigned Press" dropdown
// on the Order Detail modal.
export default function PressesSection({ user }) {
  // Stored as v2 objects: { name, colors }. Legacy string entries are
  // promoted on load via normalizePresses. See lib/presses/normalizePresses.
  const [presses, setPresses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!user?.email) return;
        const { data: shop } = await supabase
          .from("shops")
          .select("presses")
          .eq("owner_email", shopScope(user))
          .maybeSingle();
        if (alive) setPresses(normalizePresses(shop?.presses));
      } catch {
        if (alive) setPresses([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [user?.email]);

  function updatePressName(idx, name) {
    setPresses(prev => prev.map((p, i) => (i === idx ? { ...p, name } : p)));
  }

  function updatePressColors(idx, value) {
    // Allow blank for "unknown". Coerce numeric strings; reject negative / non-finite.
    const n = value === "" ? null : Number(value);
    const colors = Number.isFinite(n) && n > 0 ? n : null;
    setPresses(prev => prev.map((p, i) => (i === idx ? { ...p, colors } : p)));
  }

  function removePress(idx) {
    setPresses(prev => prev.filter((_, i) => i !== idx));
  }

  function addPress() {
    setPresses(prev => [...prev, { name: "", colors: null }]);
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const cleaned = serializePresses(presses);
      const { error } = await supabase
        .from("shops")
        .update({ presses: cleaned })
        .eq("owner_email", shopScope(user));
      if (error) throw error;
      setPresses(cleaned);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      notify.error("Couldn't save presses", err);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <InlineLinesSkeleton />;

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500 leading-relaxed">
        List the presses your shop runs jobs on (e.g. "Auto 1 — 8 colors", "Manual A — 6 colors"). They'll appear as picker options under <span className="font-semibold">Assigned Press</span> on each order, and the color count is shown on the Press Schedule lane so dispatchers know which press can run a given job's color count. Operators come from your Admin Panel invites.
      </p>

      <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-2">
        {presses.length === 0 ? (
          <div className="text-xs text-slate-500 italic">No presses yet — add one below.</div>
        ) : (
          <div className="space-y-1.5">
            {presses.map((press, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  value={press.name}
                  onChange={e => updatePressName(idx, e.target.value)}
                  placeholder="Press name (e.g. Auto 1)"
                  className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-300"
                />
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={press.colors ?? ""}
                    onChange={e => updatePressColors(idx, e.target.value)}
                    placeholder="—"
                    title="Number of color stations (heads). Leave blank if unknown."
                    className="w-16 text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-300 text-center"
                  />
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider">colors</span>
                </div>
                <button
                  type="button"
                  onClick={() => removePress(idx)}
                  title="Remove press"
                  className="text-slate-300 hover:text-red-500 transition w-7 h-7 flex items-center justify-center"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={addPress}
          className="text-xs font-semibold text-teal-600 hover:text-teal-700 mt-1 transition"
        >
          + Add press
        </button>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {saving ? "Saving…" : saved ? "Saved" : "Save Presses"}
        </button>
        {saved && <span className="text-xs text-emerald-600 font-semibold">Saved</span>}
      </div>
    </div>
  );
}
