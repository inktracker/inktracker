import { useState, useEffect } from "react";
import { supabase } from "@/api/supabaseClient";
import { InlineLinesSkeleton } from "@/components/shared/Skeletons";
import { Loader2 } from "lucide-react";
import { notify } from "@/lib/notify";
import { getMissingAutoDerivedTasks } from "@/lib/productionTasks";
import { shopScope } from "@/lib/shopScope";

// Per-stage production checklist editor. Each shop has its own list
// of tasks for Art Approval / Order Goods / Pre-Press / Printing.
// Empty maps fall back to DEFAULT_TASKS via getStageTasks(); shops can
// reset a stage to defaults by clearing all rows.
export default function ProductionTasksSection({ user }) {
  const [tasks, setTasks] = useState({});
  const [defaults, setDefaults] = useState({});
  const [stages, setStages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      // Dynamic import keeps Account.jsx's top-level import list short
      // and avoids pulling productionTasks helpers into Auth-only callers
      // of pricing.jsx.
      const mod = await import("@/lib/productionTasks");
      if (!alive) return;
      setStages(mod.PRODUCTION_STAGES);
      setDefaults(mod.DEFAULT_TASKS);

      try {
        const shopOwner = shopScope(user);
        if (!shopOwner) return;
        const { data: shop } = await supabase
          .from("shops")
          .select("production_tasks")
          .eq("owner_email", shopOwner)
          .maybeSingle();
        const stored = shop?.production_tasks && typeof shop.production_tasks === "object"
          ? shop.production_tasks
          : {};
        // Seed every stage from defaults; overlay anything the shop
        // already customized so editing feels stable.
        const seeded = {};
        for (const stage of mod.PRODUCTION_STAGES) {
          const fromShop = Array.isArray(stored[stage]) ? stored[stage] : null;
          seeded[stage] = fromShop && fromShop.length > 0
            ? [...fromShop]
            : [...(mod.DEFAULT_TASKS[stage] || [])];
        }
        if (alive) setTasks(seeded);
      } catch {
        // Best-effort — if the shop row isn't reachable, just show defaults.
        if (alive) {
          const seeded = {};
          for (const stage of mod.PRODUCTION_STAGES) seeded[stage] = [...(mod.DEFAULT_TASKS[stage] || [])];
          setTasks(seeded);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [user?.email]);

  function updateTask(stage, idx, value) {
    setTasks(prev => {
      const next = { ...prev, [stage]: [...(prev[stage] || [])] };
      next[stage][idx] = value;
      return next;
    });
  }

  function removeTask(stage, idx) {
    setTasks(prev => ({
      ...prev,
      [stage]: (prev[stage] || []).filter((_, i) => i !== idx),
    }));
  }

  function addTask(stage) {
    setTasks(prev => ({
      ...prev,
      [stage]: [...(prev[stage] || []), ""],
    }));
  }

  function resetStage(stage) {
    setTasks(prev => ({ ...prev, [stage]: [...(defaults[stage] || [])] }));
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      // Trim each task; drop empties so the saved JSON stays tidy.
      const cleaned = {};
      for (const stage of stages) {
        const list = (tasks[stage] || []).map(t => String(t).trim()).filter(Boolean);
        if (list.length > 0) cleaned[stage] = list;
      }
      const { error } = await supabase
        .from("shops")
        .update({ production_tasks: cleaned })
        .eq("owner_email", shopScope(user));
      if (error) throw error;
      // Push into the module-level cache so live ShopFloor / OrderDetail
      // views pick up the change without a full reload.
      const mod = await import("@/lib/productionTasks");
      mod.loadShopProductionTasks(cleaned);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      notify.error("Couldn't save production tasks", err);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <InlineLinesSkeleton />;

  return (
    <div className="space-y-5">
      <p className="text-xs text-slate-500 leading-relaxed">
        Customize the checklist shown on Shop Floor + Order Detail for each production stage. Tasks render in the order shown. The Order Goods tasks "Place blank order" and "Receive goods" auto-check from per-size goods tracking — keep those exact names to preserve auto-derive.
      </p>

      {stages.map(stage => {
        // Warn explicitly when the shop has renamed/removed either of
        // the two Order Goods tasks that auto-check from per-size goods
        // tracking — without the warning, auto-derive silently stops
        // firing and operators have to check those tasks manually.
        const missingAutoTasks = getMissingAutoDerivedTasks(stage, tasks[stage]);
        return (
        <div key={stage} className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-slate-700 dark:text-slate-200">{stage}</div>
            <button
              type="button"
              onClick={() => resetStage(stage)}
              className="text-[10px] font-semibold text-slate-500 hover:text-teal-600 transition"
              title={`Reset ${stage} tasks to InkTracker defaults`}
            >
              Reset to defaults
            </button>
          </div>
          {missingAutoTasks.length > 0 && (
            <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 leading-relaxed">
              <strong>Heads up:</strong> {missingAutoTasks.join(" and ")} {missingAutoTasks.length === 1 ? "is" : "are"} missing — auto-check from per-size goods tracking will stop firing for {missingAutoTasks.length === 1 ? "it" : "them"}. Add the exact name{missingAutoTasks.length === 1 ? "" : "s"} back or operators will need to check manually.
            </div>
          )}
          {(tasks[stage] || []).length === 0 ? (
            <div className="text-xs text-slate-500 italic">No tasks — this stage will fall back to defaults.</div>
          ) : (
            <div className="space-y-1.5">
              {(tasks[stage] || []).map((task, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={task}
                    onChange={e => updateTask(stage, idx, e.target.value)}
                    placeholder="Task description"
                    className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-300"
                  />
                  <button
                    type="button"
                    onClick={() => removeTask(stage, idx)}
                    title="Remove task"
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
            onClick={() => addTask(stage)}
            className="text-xs font-semibold text-teal-600 hover:text-teal-700 mt-1 transition"
          >
            + Add task
          </button>
        </div>
        );
      })}

      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {saving ? "Saving…" : saved ? "Saved" : "Save Production Tasks"}
        </button>
        <button
          onClick={() => {
            if (window.confirm("Reset every stage to InkTracker's default task lists? Your customizations will be wiped. You'll still need to click Save to persist the reset.")) {
              const fresh = {};
              for (const stage of stages) fresh[stage] = [...(defaults[stage] || [])];
              setTasks(fresh);
            }
          }}
          className="text-xs text-slate-500 hover:text-slate-700 font-semibold"
        >
          Reset to Defaults
        </button>
        {saved && <span className="text-xs text-emerald-600 font-semibold">Saved</span>}
      </div>
    </div>
  );
}
