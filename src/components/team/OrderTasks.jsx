import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/api/supabaseClient";
import { notify } from "@/lib/notify";
import { CheckSquare, Loader2, Plus, Trash2, CalendarDays } from "lucide-react";

// Tasks anchored to one order: create, assign (roster-validated server-side),
// date, complete. Writes go through the teamTasks edge function so
// assignment pings ride the notification rails; reads are direct under RLS.

function isOverdue(t) {
  return t.status === "open" && t.due_date && t.due_date < new Date().toISOString().slice(0, 10);
}

export default function OrderTasks({ order, user }) {
  const [tasks, setTasks] = useState(null);
  const [roster, setRoster] = useState([]);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [posting, setPosting] = useState(false);

  const shopOwner = order?.shop_owner || user?.shop_owner || user?.email;
  const orderId = order?.order_id;
  const isOwner = user && (user.email === shopOwner || user.role === "admin");

  const load = useCallback(async () => {
    if (!shopOwner || !orderId) return;
    const { data, error } = await supabase
      .from("shop_tasks")
      .select("*")
      .eq("shop_owner", shopOwner)
      .eq("order_id", orderId)
      .order("status", { ascending: true })
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(100);
    if (!error) setTasks(data || []);
    else setTasks([]);
  }, [shopOwner, orderId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await supabase.functions.invoke("orderComments", { body: { action: "roster" } });
        if (active && Array.isArray(data?.roster)) setRoster(data.roster);
      } catch { /* assignment dropdown just stays empty */ }
    })();
    return () => { active = false; };
  }, []);

  async function callTasks(body) {
    const { data, error } = await supabase.functions.invoke("teamTasks", { body });
    if (error) throw new Error(error.message || "Task update failed");
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async function createTask() {
    if (!title.trim() || posting) return;
    setPosting(true);
    try {
      await callTasks({ action: "create", title, orderId, assigneeEmail: assignee || null, dueDate: dueDate || null });
      setTitle(""); setAssignee(""); setDueDate(""); setAdding(false);
      await load();
    } catch (err) {
      notify.error(err?.message || "Couldn't create task");
    } finally {
      setPosting(false);
    }
  }

  async function toggle(t) {
    setBusyId(t.id);
    try {
      await callTasks({ action: t.status === "open" ? "complete" : "reopen", taskId: t.id });
      await load();
    } catch (err) {
      notify.error(err?.message || "Couldn't update task");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(t) {
    if (!window.confirm(`Delete task "${t.title}"?`)) return;
    setBusyId(t.id);
    try {
      await callTasks({ action: "remove", taskId: t.id });
      await load();
    } catch (err) {
      notify.error(err?.message || "Couldn't delete task");
    } finally {
      setBusyId(null);
    }
  }

  const open = (tasks || []).filter((t) => t.status === "open");
  const done = (tasks || []).filter((t) => t.status === "done");

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <CheckSquare className="w-4 h-4 text-teal-600" />
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Tasks</h3>
          {open.length > 0 && <span className="text-xs text-slate-400">{open.length} open</span>}
        </div>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-900"
          >
            <Plus className="w-3.5 h-3.5" /> Add task
          </button>
        )}
      </div>

      {tasks === null ? (
        <div className="py-3 text-center"><Loader2 className="w-4 h-4 animate-spin mx-auto text-slate-400" /></div>
      ) : tasks.length === 0 && !adding ? (
        <p className="text-xs text-slate-400">
          No tasks yet. Assign a teammate a step on this job — they'll get a notification.
        </p>
      ) : (
        <div className="space-y-1.5">
          {[...open, ...done].map((t) => (
            <div key={t.id} className={`flex items-center gap-2 text-sm rounded-lg px-2 py-1.5 ${t.status === "done" ? "opacity-50" : ""}`}>
              <button
                type="button"
                onClick={() => toggle(t)}
                disabled={busyId === t.id}
                className={`w-4 h-4 shrink-0 rounded border-2 flex items-center justify-center transition ${
                  t.status === "done" ? "bg-teal-600 border-teal-600 text-white" : "border-slate-300 hover:border-teal-500"
                }`}
                aria-label={t.status === "done" ? "Reopen task" : "Complete task"}
              >
                {t.status === "done" && <span className="text-[10px] leading-none">✓</span>}
              </button>
              <span className={`flex-1 min-w-0 truncate ${t.status === "done" ? "line-through" : "text-slate-800 dark:text-slate-200"}`}>
                {t.title}
              </span>
              {t.assignee_name && (
                <span className="text-[10px] font-semibold bg-teal-50 text-teal-700 border border-teal-200 rounded-full px-2 py-0.5 shrink-0">
                  {t.assignee_name}
                </span>
              )}
              {t.due_date && (
                <span className={`text-[10px] font-semibold shrink-0 flex items-center gap-1 ${isOverdue(t) ? "text-red-600" : "text-slate-400"}`}>
                  <CalendarDays className="w-3 h-3" /> {t.due_date.slice(5)}
                </span>
              )}
              {isOwner && (
                <button type="button" onClick={() => remove(t)} disabled={busyId === t.id}
                  className="text-slate-300 hover:text-red-500 shrink-0" aria-label="Delete task">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {adding && (
        <div className="mt-3 space-y-2 border-t border-slate-100 dark:border-slate-800 pt-3">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") createTask(); if (e.key === "Escape") setAdding(false); }}
            placeholder="What needs doing?"
            className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-300"
          />
          <div className="flex flex-wrap gap-2">
            <select
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              className="text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-800"
            >
              <option value="">Unassigned</option>
              {roster.map((m) => (
                <option key={m.email} value={m.email}>{m.name}</option>
              ))}
            </select>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-800"
            />
            <span className="flex-1" />
            <button type="button" onClick={() => setAdding(false)}
              className="text-xs font-semibold text-slate-500 px-2 py-1.5">Cancel</button>
            <button
              type="button"
              onClick={createTask}
              disabled={posting || !title.trim()}
              className="text-xs font-semibold bg-teal-600 text-white rounded-lg px-3 py-1.5 disabled:opacity-40"
            >
              {posting ? "Adding…" : "Add task"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
