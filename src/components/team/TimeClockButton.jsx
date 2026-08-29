import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/supabaseClient";
import { entryMinutes, fmtDuration } from "@/lib/timesheets";
import { displayFullName } from "@/lib/displayName";
import { todayInShopTz } from "@/lib/shopTimezone";
import { notify } from "@/lib/notify";
import { Clock, Loader2 } from "lucide-react";

// Clock in/out control for the ShopFloor header. One running entry per
// person (enforced by a partial unique index); clock-out stamps the
// derived minutes and moves the entry to "submitted" for owner review.
export default function TimeClockButton({ user }) {
  const [open, setOpen] = useState(null); // the running entry, if any
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [, setTick] = useState(0); // re-render for the elapsed label

  const shopEmail = user?.shop_owner || user?.email;
  const myEmail = user?.email;

  const loadOpen = useCallback(async () => {
    if (!shopEmail || !myEmail) return null;
    try {
      const rows = await base44.entities.TimeEntry.filter(
        { shop_owner: shopEmail, member_email: myEmail, status: "open" }
      );
      const row = rows?.[0] || null;
      setOpen(row);
      return row;
    } catch {
      // Non-fatal: the floor keeps working without the clock.
      setOpen(null);
      return null;
    } finally {
      setLoaded(true);
    }
  }, [shopEmail, myEmail]);

  useEffect(() => { loadOpen(); }, [loadOpen]);

  // Keep the elapsed label moving while clocked in.
  useEffect(() => {
    if (!open) return undefined;
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, [open]);

  async function clockIn() {
    if (busy || !shopEmail || !myEmail) return;
    setBusy(true);
    try {
      const created = await base44.entities.TimeEntry.create({
        shop_owner: shopEmail,
        member_email: myEmail,
        member_name: displayFullName(user) || myEmail,
        work_date: todayInShopTz(),
        clock_in: new Date().toISOString(),
        status: "open",
      });
      setOpen(created || { clock_in: new Date().toISOString() });
      notify.success("Clocked in");
    } catch (err) {
      // Unique-index violation means a clock is already running (e.g. on
      // another device) — reload instead of showing a raw DB error.
      const existing = await loadOpen();
      if (!existing) notify.error(err?.message || "Couldn't clock in");
    } finally {
      setBusy(false);
    }
  }

  async function clockOut() {
    if (busy || !open?.id) return;
    setBusy(true);
    try {
      const minutes = entryMinutes({ ...open, minutes: null });
      await base44.entities.TimeEntry.update(open.id, {
        clock_out: new Date().toISOString(),
        minutes,
        status: "submitted",
      });
      setOpen(null);
      notify.success(`Clocked out — ${fmtDuration(minutes)}`);
    } catch (err) {
      notify.error(err?.message || "Couldn't clock out");
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return null;

  const running = !!open;
  const elapsed = running ? fmtDuration(entryMinutes({ ...open, minutes: null })) : null;

  return (
    <button
      onClick={running ? clockOut : clockIn}
      disabled={busy}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg transition text-sm font-semibold ${
        running ? "bg-amber-400 text-amber-950 hover:bg-amber-300" : "hover:bg-teal-500"
      }`}
      title={running ? "Clock out" : "Clock in"}
    >
      {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Clock className="w-5 h-5" />}
      <span className="hidden sm:inline">{running ? `Out · ${elapsed}` : "Clock In"}</span>
    </button>
  );
}
