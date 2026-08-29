// Pure timesheet math shared by the ShopFloor clock and the AdminPanel
// review grid. No I/O here — everything is unit-tested.

// Authoritative duration for an entry: the stored `minutes` (set at
// clock-out, editable by the owner) wins; otherwise derive from the clocks
// of a still-open entry so the UI can show a live elapsed count.
export function entryMinutes(entry, nowMs = Date.now()) {
  if (entry == null) return 0;
  if (Number.isFinite(Number(entry.minutes)) && entry.minutes !== null && entry.minutes !== "") {
    return Math.max(0, Math.round(Number(entry.minutes)));
  }
  if (!entry.clock_in) return 0;
  const start = new Date(entry.clock_in).getTime();
  const end = entry.clock_out ? new Date(entry.clock_out).getTime() : nowMs;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 60000);
}

export function sumMinutes(entries, nowMs = Date.now()) {
  return (entries || []).reduce((s, e) => s + entryMinutes(e, nowMs), 0);
}

export function fmtDuration(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h === 0) return `${rem}m`;
  return `${h}h ${String(rem).padStart(2, "0")}m`;
}

// Monday-anchored week containing `anchor` (a Date or YYYY-MM-DD string),
// as inclusive YYYY-MM-DD bounds. Weeks run Mon–Sun to match pay periods.
export function weekRange(anchor) {
  const d = typeof anchor === "string"
    ? new Date(`${anchor}T00:00:00`)
    : new Date(anchor);
  const day = d.getDay(); // 0=Sun … 6=Sat
  const backToMonday = day === 0 ? 6 : day - 1;
  const start = new Date(d);
  start.setDate(d.getDate() - backToMonday);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const iso = (x) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  return { start: iso(start), end: iso(end) };
}
