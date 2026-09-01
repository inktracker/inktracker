import { useState, useEffect, useCallback } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import { entryMinutes, sumMinutes, fmtDuration, weekRange } from "@/lib/timesheets";
import { notify } from "@/lib/notify";
import { ChevronLeft, ChevronRight, Check, Loader2, Send, Clock } from "lucide-react";

const STATUS_BADGE = {
  open: "bg-amber-50 text-amber-700 border-amber-200",
  submitted: "bg-blue-50 text-blue-700 border-blue-200",
  approved: "bg-green-50 text-green-700 border-green-200",
};

function fmtClock(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Hours + minutes editor, mirroring the shape QuickBooks TimeActivity
// actually takes (separate Hours and Minutes fields — see qbTime.js).
// Total minutes stays the stored value; this is purely the human face.
function HoursMinutesInput({ entry, onSave, disabled }) {
  const total = entryMinutes(entry);
  const [hours, setHours] = useState(Math.floor(total / 60));
  const [mins, setMins] = useState(total % 60);

  function save(h, m) {
    const hh = Math.max(0, Math.min(24, Math.round(Number(h) || 0)));
    const mm = Math.max(0, Math.min(59, Math.round(Number(m) || 0)));
    setHours(hh);
    setMins(mm);
    onSave(entry, hh * 60 + mm);
  }

  const box =
    "w-14 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-sm bg-white dark:bg-slate-800 disabled:opacity-50";
  return (
    <span className="flex items-center gap-1">
      <input
        type="number" min="0" max="24" value={hours} disabled={disabled}
        onChange={(ev) => setHours(ev.target.value)}
        onBlur={(ev) => save(ev.target.value, mins)}
        className={box} aria-label="Hours worked"
      />
      <span className="text-xs text-slate-400">h</span>
      <input
        type="number" min="0" max="59" value={mins} disabled={disabled}
        onChange={(ev) => setMins(ev.target.value)}
        onBlur={(ev) => save(hours, ev.target.value)}
        className={box} aria-label="Minutes worked"
      />
      <span className="text-xs text-slate-400">m</span>
    </span>
  );
}

// Owner-side weekly timesheet review: approve entries, fix minutes, and
// push approved hours to QuickBooks as TimeActivity records (QBO Payroll
// reads them for hourly pay runs). Approval is enforced by RLS as an
// owner-only act — this UI is the only place entries become "approved".
export default function TimesheetsSection({ user }) {
  const [week, setWeek] = useState(() => weekRange(new Date()));
  const [entries, setEntries] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [approvingAll, setApprovingAll] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState(null);

  const shopEmail = user?.shop_owner || user?.email;

  const load = useCallback(async () => {
    if (!shopEmail) return;
    try {
      const { data, error } = await supabase
        .from("time_entries")
        .select("*")
        .eq("shop_owner", shopEmail)
        .gte("work_date", week.start)
        .lte("work_date", week.end)
        .order("work_date", { ascending: true });
      if (error) throw error;
      setEntries(data || []);
    } catch (err) {
      notify.error(err?.message || "Couldn't load timesheets");
      setEntries([]);
    }
  }, [shopEmail, week.start, week.end]);

  useEffect(() => { load(); }, [load]);

  function shiftWeek(days) {
    const d = new Date(`${week.start}T00:00:00`);
    d.setDate(d.getDate() + days);
    setWeek(weekRange(d));
    setPushResult(null);
  }

  async function approve(entry) {
    setBusyId(entry.id);
    try {
      await base44.entities.TimeEntry.update(entry.id, {
        status: "approved",
        minutes: entryMinutes(entry),
      });
      await load();
    } catch (err) {
      notify.error(err?.message || "Couldn't approve entry");
    } finally {
      setBusyId(null);
    }
  }

  // Approve every submitted entry in the visible week at once. Entries whose
  // minutes were already fixed at clock-out (the normal case) go in one
  // batched update; the rare minutes-less rows get individual updates so the
  // authoritative duration is stamped per-row, same as single approve.
  async function approveAll() {
    const targets = (entries || []).filter((e) => e.status === "submitted");
    if (targets.length === 0) return;
    const people = new Set(targets.map((e) => e.member_name || e.member_email)).size;
    const ok = window.confirm(
      `Approve ${targets.length} ${targets.length === 1 ? "entry" : "entries"} for ${people} ${people === 1 ? "person" : "people"} this week?`
    );
    if (!ok) return;
    setApprovingAll(true);
    try {
      const withMinutes = targets.filter((e) => Number.isFinite(Number(e.minutes)) && e.minutes !== null);
      const withoutMinutes = targets.filter((e) => !withMinutes.includes(e));
      if (withMinutes.length > 0) {
        const { error } = await supabase
          .from("time_entries")
          .update({ status: "approved" })
          .in("id", withMinutes.map((e) => e.id));
        if (error) throw error;
      }
      for (const e of withoutMinutes) {
        await base44.entities.TimeEntry.update(e.id, { status: "approved", minutes: entryMinutes(e) });
      }
      await load();
      notify.success(`Approved ${targets.length} ${targets.length === 1 ? "entry" : "entries"}`);
    } catch (err) {
      notify.error(err?.message || "Couldn't approve entries");
    } finally {
      setApprovingAll(false);
    }
  }

  // Owner-side close-out for a clock someone forgot to stop. Uses the entry's
  // current minutes (owner-editable in the box on the row) as the real
  // duration and back-computes clock_out from clock_in, so the runaway
  // elapsed time never becomes the paid time by accident.
  async function closeOut(entry) {
    // Cap at the DB's 1440 check — a multi-day runaway clock would otherwise
    // be rejected outright when the owner closes it without editing first.
    const mins = Math.min(1440, entryMinutes(entry));
    const name = entry.member_name || entry.member_email;
    const ok = window.confirm(
      `Close ${name}'s open entry at ${fmtDuration(mins)}? ` +
      `If that isn't the real time worked, cancel and fix the minutes box first.`
    );
    if (!ok) return;
    setBusyId(entry.id);
    try {
      const clockOut = entry.clock_in
        ? new Date(new Date(entry.clock_in).getTime() + mins * 60000).toISOString()
        : null;
      await base44.entities.TimeEntry.update(entry.id, {
        status: "submitted",
        minutes: mins,
        clock_out: clockOut,
      });
      await load();
      notify.success(`Closed ${name}'s entry at ${fmtDuration(mins)}`);
    } catch (err) {
      notify.error(err?.message || "Couldn't close the entry");
    } finally {
      setBusyId(null);
    }
  }

  async function setMinutesTotal(entry, raw) {
    const mins = Math.max(0, Math.min(1440, Math.round(Number(raw) || 0)));
    if (mins === entryMinutes(entry)) return;
    setBusyId(entry.id);
    try {
      await base44.entities.TimeEntry.update(entry.id, { minutes: mins });
      await load();
    } catch (err) {
      notify.error(err?.message || "Couldn't update minutes");
    } finally {
      setBusyId(null);
    }
  }

  async function pushToQb() {
    setPushing(true);
    setPushResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await base44.functions.invoke("qbSync", {
        action: "pushTimeEntries",
        accessToken: session?.access_token,
      });
      if (error) throw new Error(error.message || "QuickBooks push failed");
      if (data?.error) throw new Error(data.error);
      setPushResult(data);
      await load();
      if (data?.pushed > 0) notify.success(`Sent ${data.pushed} ${data.pushed === 1 ? "entry" : "entries"} to QuickBooks`);
      else notify.success("Nothing new to send — QuickBooks is up to date");
    } catch (err) {
      notify.error(err?.message || "QuickBooks push failed");
    } finally {
      setPushing(false);
    }
  }

  const byMember = {};
  for (const e of entries || []) {
    const key = e.member_name || e.member_email;
    (byMember[key] = byMember[key] || []).push(e);
  }
  const approvedUnsynced = (entries || []).filter(
    (e) => e.status === "approved" && !e.qb_time_activity_id && entryMinutes(e) > 0
  ).length;
  const submittedCount = (entries || []).filter((e) => e.status === "submitted").length;
  const crewTotal = sumMinutes(entries || []);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-teal-600" />
          <h3 className="font-bold text-slate-900 dark:text-slate-100">Timesheets</h3>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => shiftWeek(-7)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Previous week">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{week.start} → {week.end}</span>
          <button onClick={() => shiftWeek(7)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Next week">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          {submittedCount > 0 && (
            <button
              onClick={approveAll}
              disabled={approvingAll}
              className="flex items-center gap-2 text-sm font-semibold text-green-700 bg-green-50 border border-green-200 px-4 py-2 rounded-lg hover:bg-green-100 disabled:opacity-50"
            >
              {approvingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Approve all ({submittedCount})
            </button>
          )}
          <button
            onClick={pushToQb}
            disabled={pushing || approvedUnsynced === 0}
            className="flex items-center gap-2 bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40"
          >
            {pushing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Send approved to QuickBooks{approvedUnsynced > 0 ? ` (${approvedUnsynced})` : ""}
          </button>
        </div>
      </div>

      {pushResult?.unmatched?.length > 0 && (
        <div className="mb-4 text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
          No QuickBooks employee found for: {pushResult.unmatched.join(", ")}. Add them under
          Payroll → Employees in QuickBooks (same email as their InkTracker login), then send again.
        </div>
      )}
      {pushResult?.failures?.length > 0 && (
        <div className="mb-4 text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">
          {pushResult.failures.length} {pushResult.failures.length === 1 ? "entry" : "entries"} failed to send — retry, or check the QuickBooks connection.
        </div>
      )}

      {entries === null ? (
        <div className="py-10 text-center text-slate-400"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
      ) : entries.length === 0 ? (
        <p className="text-sm text-slate-500 py-6 text-center">
          No time entries this week. Employees clock in and out from the Shop Floor header.
        </p>
      ) : (
        <>
        {Object.entries(byMember).map(([member, rows]) => (
          <div key={member} className="mb-5 last:mb-0">
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-semibold text-sm text-slate-800 dark:text-slate-200">{member}</span>
              <span className="text-sm font-bold text-slate-600 dark:text-slate-400">{fmtDuration(sumMinutes(rows))}</span>
            </div>
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              {rows.map((e) => (
                <div key={e.id} className="flex flex-wrap items-center gap-3 px-3 py-2 border-b border-slate-100 dark:border-slate-800 last:border-b-0 text-sm">
                  <span className="w-24 text-slate-600 dark:text-slate-400">{e.work_date}</span>
                  <span className="w-32 text-slate-500 text-xs">{fmtClock(e.clock_in)} → {fmtClock(e.clock_out)}</span>
                  {e.status === "approved" || e.qb_time_activity_id ? (
                    <span className="w-20 font-semibold text-slate-700 dark:text-slate-300">{fmtDuration(entryMinutes(e))}</span>
                  ) : (
                    <HoursMinutesInput entry={e} onSave={setMinutesTotal} disabled={busyId === e.id} />
                  )}
                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${STATUS_BADGE[e.status] || STATUS_BADGE.open}`}>
                    {e.qb_time_activity_id ? "in QuickBooks" : e.status}
                  </span>
                  {e.notes && (
                    <span className="text-xs italic text-slate-500 dark:text-slate-400 min-w-0 truncate" title={e.notes}>
                      “{e.notes}”
                    </span>
                  )}
                  <span className="flex-1" />
                  {e.status === "open" && (
                    <button
                      onClick={() => closeOut(e)}
                      disabled={busyId === e.id}
                      className="flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg hover:bg-amber-100 disabled:opacity-50"
                    >
                      {busyId === e.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Clock className="w-3.5 h-3.5" />}
                      Close out
                    </button>
                  )}
                  {e.status === "submitted" && (
                    <button
                      onClick={() => approve(e)}
                      disabled={busyId === e.id}
                      className="flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-lg hover:bg-green-100 disabled:opacity-50"
                    >
                      {busyId === e.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      Approve
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
        <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-800">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Crew total</span>
          <span className="text-sm font-bold text-slate-900 dark:text-slate-100">{fmtDuration(crewTotal)}</span>
        </div>
        </>
      )}

      <p className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-400 dark:text-slate-500">
        Approved hours are sent to QuickBooks as time activities and matched by the
        employee's InkTracker login email — add each person under Payroll → Employees
        in QuickBooks with the same email. QuickBooks Payroll then picks the hours up
        for hourly pay runs. Entries already sent are marked "in QuickBooks" and are
        never sent twice.
      </p>
    </div>
  );
}
