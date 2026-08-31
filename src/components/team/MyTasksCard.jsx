import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/api/supabaseClient";
import { notify } from "@/lib/notify";
import { CheckSquare, CalendarDays, Loader2 } from "lucide-react";

// "My Tasks" for the ShopFloor: everything assigned to me that's still
// open, ordered by due date. Checking one off calls the teamTasks edge
// function (which notifies the task's creator). Renders nothing when I
// have no open tasks — the floor stays clean.

export default function MyTasksCard({ user, onSelectOrder }) {
  const [tasks, setTasks] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const myEmail = (user?.email || "").toLowerCase();

  const load = useCallback(async () => {
    if (!myEmail) return;
    const { data, error } = await supabase
      .from("shop_tasks")
      .select("*")
      .eq("assignee_email", myEmail)
      .eq("status", "open")
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(30);
    if (!error) setTasks(data || []);
  }, [myEmail]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  async function complete(task) {
    setBusyId(task.id);
    try {
      const { data, error } = await supabase.functions.invoke("teamTasks", {
        body: { action: "complete", taskId: task.id },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      setTasks((prev) => (prev || []).filter((t) => t.id !== task.id));
    } catch (err) {
      notify.error(err?.message || "Couldn't complete task");
    } finally {
      setBusyId(null);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  if (!tasks || tasks.length === 0) return null;

  return (
    <div className="bg-white border-b-4 border-teal-500 px-5 py-3">
      <div className="flex items-center gap-2 mb-2">
        <CheckSquare className="w-4 h-4 text-teal-600" />
        <span className="text-xs font-bold uppercase tracking-widest text-slate-700">My Tasks ({tasks.length})</span>
      </div>
      <div className="space-y-1.5">
        {tasks.map((t) => {
          const overdue = t.due_date && t.due_date < today;
          return (
            <div key={t.id} className="flex items-center gap-2 text-sm">
              <button
                type="button"
                onClick={() => complete(t)}
                disabled={busyId === t.id}
                className="w-5 h-5 shrink-0 rounded border-2 border-slate-300 hover:border-teal-500 hover:bg-teal-50 transition flex items-center justify-center"
                aria-label="Mark done"
              >
                {busyId === t.id && <Loader2 className="w-3 h-3 animate-spin text-teal-600" />}
              </button>
              <span className="flex-1 min-w-0 truncate font-medium text-slate-800">{t.title}</span>
              {t.order_id && (
                <button
                  type="button"
                  onClick={() => onSelectOrder?.(t.order_id)}
                  className="text-[10px] font-semibold text-teal-700 hover:underline shrink-0"
                >
                  {t.order_id}
                </button>
              )}
              {t.due_date && (
                <span className={`text-[10px] font-semibold shrink-0 flex items-center gap-1 ${overdue ? "text-red-600" : "text-slate-400"}`}>
                  <CalendarDays className="w-3 h-3" /> {overdue ? "OVERDUE " : ""}{t.due_date.slice(5)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
