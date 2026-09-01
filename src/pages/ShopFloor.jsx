import { useState, useEffect } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import { ListCardsSkeleton } from "@/components/shared/Skeletons";
import { fmtDate, sortSizeEntries, O_STATUSES, getDisplayName, getShopPricingConfig } from "../components/shared/pricing";
import { imprintCountText } from "@/lib/quotes/imprintLabels";
import ProductionTicket from "../components/orders/ProductionTicket";
import { displayFullName } from "@/lib/displayName";
import {
  countGoodsProgress,
  autoCheckOrderGoodsTask,
  bulkSetOrderGoodsStep,
  nextGoodsStatusOnTap,
  unreceivedCount,
} from "@/lib/orderGoodsProgress";
import { Package, ChevronRight, ChevronDown, RefreshCw, LogOut, Send, Clock, CheckCircle2, AlertTriangle, Loader2, Printer, FileImage } from "lucide-react";
import { notify } from "@/lib/notify";
import ArtworkPreviewOverlay from "../components/shared/ArtworkPreviewOverlay";
import TimeClockButton from "../components/team/TimeClockButton";
import NotificationBell from "../components/NotificationBell";
import EnablePushButton from "../components/team/EnablePushButton";
import OrderComments from "../components/orders/OrderComments";
import MyTasksCard from "../components/team/MyTasksCard";
import { getStageTasks } from "@/lib/productionTasks";
import { runOrderCompletion } from "@/lib/orders/runOrderCompletion";
import { normalizeAssignedPress } from "@/lib/presses/normalizePresses";
import { todayInShopTz } from "@/lib/shopTimezone";

// Collect every artwork file attached to an order so press operators
// can preview them inline. Mirrors OrderDetailModal.getOrderArtwork:
// merge `selected_artwork` (proofs + connected designs) with per-imprint
// artwork, deduped by id/url/name. Each row carries `path` when present
// so the previewer can re-sign against the artwork bucket.
function getShopFloorArtwork(order) {
  const map = new Map();
  (order?.selected_artwork || []).forEach((art) => {
    const key = art.id || art.path || art.url || art.file_url || art.name;
    if (!key || map.has(key)) return;
    map.set(key, {
      id: art.id || key,
      name: art.name || "Artwork",
      url: art.url || art.file_url || "",
      file_url: art.file_url || art.url || "",
      path: art.path || null,
      colors: art.colors || art.artwork_colors || "",
      source: art.source || "Attached to order",
      placements: [],
    });
  });
  (order?.line_items || []).forEach((li) => {
    (li.imprints || []).forEach((imp) => {
      if (!imp.artwork_id && !imp.artwork_url && !imp.artwork_name) return;
      const id = imp.artwork_id || imp.artwork_url || imp.artwork_name;
      const placement = [imp.location, imp.title].filter(Boolean).join(" · ");
      const existing = map.get(id);
      if (existing) {
        if (placement && !existing.placements.includes(placement)) existing.placements.push(placement);
        if (!existing.colors && imp.artwork_colors) existing.colors = imp.artwork_colors;
        return;
      }
      map.set(id, {
        id,
        name: imp.artwork_name || "Attached Artwork",
        url: imp.artwork_url || "",
        file_url: imp.artwork_url || "",
        path: imp.artwork_path || null,
        colors: imp.artwork_colors || "",
        source: "Linked to production imprint",
        placements: placement ? [placement] : [],
      });
    });
  });
  return Array.from(map.values());
}

// Proof for ONE garment line: the artwork linked to that line's imprints
// first, else the order-level proof. Tapping a garment on the floor should
// show the operator the print that goes ON that garment.
function getLineProof(order, li) {
  const all = getShopFloorArtwork(order);
  for (const imp of li?.imprints || []) {
    const id = imp.artwork_id || imp.artwork_url || imp.artwork_name;
    if (!id) continue;
    const hit = all.find((a) => a.id === id && (a.url || a.path));
    if (hit) return hit;
  }
  return all.find((a) => a.url || a.path) || null;
}

// Art for ONE imprint (multi-design jobs: front art vs back art vs sleeve).
function getImprintArt(order, imp) {
  const id = imp?.artwork_id || imp?.artwork_url || imp?.artwork_name;
  if (!id) return null;
  return getShopFloorArtwork(order).find((a) => a.id === id && (a.url || a.path)) || null;
}

// ShopFloor STEPS used to be its own copy of the order pipeline.
// Consolidated to O_STATUSES on 2026-05-12 so all status lists in
// the app come from a single source of truth.
const STEPS = O_STATUSES;

const STEP_COLORS = {
  "Art Approval": { bg: "bg-teal-500", light: "bg-teal-50 text-teal-700 border-teal-200" },
  "Order Goods":  { bg: "bg-amber-500",  light: "bg-amber-50 text-amber-700 border-amber-200" },
  "Pre-Press":    { bg: "bg-blue-500",   light: "bg-blue-50 text-blue-700 border-blue-200" },
  "Printing":     { bg: "bg-teal-500", light: "bg-teal-50 text-teal-700 border-teal-200" },
  "Completed":    { bg: "bg-slate-400",  light: "bg-slate-50 text-slate-600 border-slate-200" },
};

function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResetSent(false);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) setError(err.message);
    setLoading(false);
  }

  // Forgot-password — fires Supabase's recovery email, which lands the
  // user on /ResetPassword (same flow used by the main login modal).
  // Neutral success wording so we don't confirm whether an account
  // exists (account enumeration guard).
  async function handleForgot() {
    setError("");
    setResetSent(false);
    if (!email.trim()) {
      setError("Enter your email first, then tap \"Forgot password?\"");
      return;
    }
    setResetLoading(true);
    try {
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/ResetPassword`,
      });
      if (resetErr) throw resetErr;
      setResetSent(true);
    } catch (err) {
      setError(err.message || "Couldn't send the reset link.");
    } finally {
      setResetLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-teal-600 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8">
        <div className="text-center mb-6">
          <Package className="w-12 h-12 text-teal-600 mx-auto mb-3" />
          <h1 className="font-display uppercase text-2xl text-slate-900 leading-none">Shop Floor</h1>
          <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500 mt-2 font-bold">Sign in to view your orders</p>
        </div>
        <form onSubmit={handleLogin} className="space-y-3">
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="Email" autoFocus required
            className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Password" required
            className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
          {error && <p className="text-sm text-red-500">{error}</p>}
          {resetSent && (
            <p className="text-sm text-emerald-600">
              If an account exists for that email, we've sent a reset link. Check your inbox.
            </p>
          )}
          <button type="submit" disabled={loading}
            className="w-full bg-teal-600 hover:bg-teal-700 text-white font-semibold py-3 rounded-xl transition disabled:opacity-50">
            {loading ? "Signing in..." : "Sign In"}
          </button>
          <button
            type="button"
            onClick={handleForgot}
            disabled={resetLoading}
            className="w-full text-sm font-semibold text-teal-600 hover:text-teal-700 disabled:opacity-50 pt-1"
          >
            {resetLoading ? "Sending…" : "Forgot password?"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function ShopFloor() {
  const [authReady, setAuthReady] = useState(false);
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  // Artwork preview overlay — opens the in-app PDF/image viewer.
  const [previewArt, setPreviewArt] = useState(null);
  // Updates panel collapsed state, per-order. Defaults collapsed so
  // operators see Production / Checklist / Artwork / Job Ticket first;
  // they can expand history when they actually need it.
  const updatesStorageKey = selected?.id ? `shopfloor-updates-collapsed-${selected.id}` : null;
  const [updatesCollapsed, setUpdatesCollapsed] = useState(true);
  // Native shell (Capacitor): ShopFloor draws its own teal header instead of
  // the Layout .app-topbar, so it needs the same safe-area treatment — and
  // the global white status-bar scrim (html.cap-native body::before) must
  // turn teal here or it paints a white strip over the header. cap-floor on
  // <html> scopes both rules (see index.css); cleanup on unmount restores
  // the normal chrome for the rest of the app.
  useEffect(() => {
    document.documentElement.classList.add("cap-floor");
    return () => document.documentElement.classList.remove("cap-floor");
  }, []);

  useEffect(() => {
    if (!updatesStorageKey) return;
    try {
      const stored = localStorage.getItem(updatesStorageKey);
      setUpdatesCollapsed(stored === "false" ? false : true);
    } catch { /* ignore */ }
  }, [updatesStorageKey]);
  useEffect(() => {
    if (!updatesStorageKey) return;
    try { localStorage.setItem(updatesStorageKey, updatesCollapsed ? "true" : "false"); }
    catch { /* ignore */ }
  }, [updatesStorageKey, updatesCollapsed]);
  const [filter, setFilter] = useState("Active");
  // Printable production ticket for the selected job.
  const [showTicket, setShowTicket] = useState(false);
  // Floor discrepancy report (Edit Order decision #2): the floor MARKS
  // differences — dated note + bell to owner/managers — never edits
  // quantities. { lineIdx, size, qty, reason } while the form is open.
  const [reportOpen, setReportOpen] = useState(false);
  const [report, setReport] = useState({ lineIdx: 0, size: "", qty: 1, reason: "short" });
  const [reportBusy, setReportBusy] = useState(false);

  async function submitDiscrepancy() {
    if (reportBusy || !selected) return;
    setReportBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const li = (selected.line_items || [])[report.lineIdx] || {};
      const lineLabel = [li.brand, li.style, li.garmentColor].filter(Boolean).join(" ");
      const { data, error } = await supabase.functions.invoke("reportDiscrepancy", {
        body: {
          orderId: selected.id,
          lineLabel,
          size: report.size,
          qty: Number(report.qty) || 0,
          reason: report.reason,
        },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      notify.success("Reported", "The office has been notified.");
      // Reflect the appended note locally so the amber notes box updates.
      if (data?.noteLine) {
        setSelected((prev) => prev ? { ...prev, notes: prev.notes ? prev.notes + "\n" + data.noteLine : data.noteLine } : prev);
      }
      setReportOpen(false);
      setReport({ lineIdx: 0, size: "", qty: 1, reason: "short" });
    } catch (err) {
      notify.error("Couldn't send the report", err);
    } finally {
      setReportBusy(false);
    }
  }
  const [refreshing, setRefreshing] = useState(false);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState(null);

  // Handle auth
  useEffect(() => {
    try {
      supabase.auth.getSession().then(({ data: { session: s } }) => {
        setSession(s);
        setAuthReady(true);
      }).catch(err => {
        console.error("getSession failed:", err);
        setAuthReady(true);
      });
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
        setSession(s);
        setAuthReady(true);
      });
      return () => subscription.unsubscribe();
    } catch (err) {
      console.error("Auth setup failed:", err);
      setError(err.message);
      setAuthReady(true);
    }
  }, []);

  // Load orders when session is ready + subscribe to real-time updates
  useEffect(() => {
    if (!session) { setLoading(false); return; }
    loadOrders();

    const channel = supabase.channel("shopfloor-orders")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders" }, (payload) => {
        const updated = payload.new;
        setOrders(prev => prev.map(o => o.id === updated.id ? { ...o, ...updated } : o));
        setSelected(prev => prev?.id === updated.id ? { ...prev, ...updated } : prev);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [session]);

  async function loadOrders() {
    setLoading(true);
    try {
      const me = await base44.auth.me();
      setUser(me);
      const shopEmail = me.shop_owner || me.email;
      try {
        const [allOrders, allCustomers] = await Promise.all([
          base44.entities.Order.filter({ shop_owner: shopEmail }, "-created_date", 200),
          base44.entities.Customer.filter({ shop_owner: shopEmail }),
        ]);
        setOrders(allOrders);
        const custMap = {};
        allCustomers.forEach(c => { custMap[c.id] = c; });
        setCustomers(custMap);
      } catch {
        try {
          const shopEmail = me.shop_owner || me.email;
          const allOrders = await base44.entities.Order.filter({ shop_owner: shopEmail }, "-created_date", 200);
          setOrders(allOrders);
        } catch { setOrders([]); }
      }
    } catch (err) {
      notify.error("Couldn't load shop floor", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    await loadOrders();
    setRefreshing(false);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
    setOrders([]);
  }

  // Auto-advance helper. After a task/goods/print mutation lands, if
  // EVERY task in the current stage is done (including auto-derived ones
  // like "Receive goods" from per-size counts), kick the order to the
  // next stage. Last stage ("Completed") has no successor — no-op.
  //
  // Read the checklist + counts off the freshly-updated order, NOT
  // closure'd state, so the most recent toggle is reflected. Re-toggling
  // a task OFF leaves the stage incomplete and we don't advance,
  // so the operator can correct mistakes without getting bounced.
  function isStageComplete(order, stage) {
    const tasks = getStageTasks(stage);
    if (tasks.length === 0) return false;
    const stepChecks = order.checklist?.[stage] || {};
    const counts = countGoodsProgress(order);
    return tasks.every((task) => {
      const auto = autoCheckOrderGoodsTask(stage, task, counts);
      return auto === null ? !!stepChecks[task] : auto;
    });
  }

  async function maybeAutoAdvance(order) {
    const current = order.status || "Pre-Press";
    const idx = STEPS.indexOf(current);
    // Already at the terminal stage (Completed) or unknown status — bail.
    if (idx < 0 || idx >= STEPS.length - 1) return;
    if (!isStageComplete(order, current)) return;
    const next = STEPS[idx + 1];
    // Cap auto-advance at Printing. The Completed transition is a real
    // event — invoice creation, performance log writes, broker PDF
    // attachment — so we never auto-flip it from a checklist tap. The
    // operator hits the explicit "Mark Complete" button below to fire
    // the full runOrderCompletion flow.
    if (next === "Completed") return;
    await updateStatus(order, next);
  }

  async function updateStatus(order, newStatus) {
    setUpdating(true);
    try {
      const stepNotes = { ...(order.step_notes || {}) };
      if (!stepNotes[newStatus]) stepNotes[newStatus] = [];
      stepNotes[newStatus].push({
        text: `Status changed to ${newStatus}`,
        by: user?.full_name || user?.email || "Employee",
        at: new Date().toISOString(),
      });
      const updated = await base44.entities.Order.update(order.id, {
        status: newStatus,
        step_notes: stepNotes,
      });
      setOrders(prev => prev.map(o => o.id === order.id ? updated : o));
      setSelected(updated);
    } catch (err) {
      notify.error("Update failed", err);
    } finally {
      setUpdating(false);
    }
  }

  async function toggleTask(order, task) {
    try {
      const step = order.status || "Pre-Press";
      const checklist = { ...(order.checklist || {}) };
      if (!checklist[step]) checklist[step] = {};
      const wasDone = !!checklist[step][task];
      checklist[step][task] = wasDone ? null : {
        by: user?.full_name || user?.email || "Employee",
        at: new Date().toISOString(),
      };
      const updated = await base44.entities.Order.update(order.id, { checklist });
      setOrders(prev => prev.map(o => o.id === order.id ? updated : o));
      setSelected(updated);
      await maybeAutoAdvance(updated);
    } catch (err) {
      notify.error("Update failed", err);
    }
  }

  async function togglePrint(order, liIdx, size, impIdx) {
    try {
      const checklist = { ...(order.checklist || {}) };
      const printProgress = { ...(checklist.print_progress || {}) };
      const key = `${liIdx}-${size}-${impIdx}`;
      printProgress[key] = printProgress[key] ? null : {
        by: user?.full_name || user?.email || "Employee",
        at: new Date().toISOString(),
      };
      checklist.print_progress = printProgress;
      const updated = await base44.entities.Order.update(order.id, { checklist });
      setOrders(prev => prev.map(o => o.id === order.id ? updated : o));
      setSelected(updated);
      await maybeAutoAdvance(updated);
    } catch (err) {
      notify.error("Update failed", err);
    }
  }

  // Per-size goods tap — cycles blank → ordered → received → blank
  // (decision in lib/orderGoodsProgress). A `null` return means
  // "clear" — delete the entry so the size goes back to blank.
  async function toggleGoods(order, liIdx, size) {
    try {
      const checklist = { ...(order.checklist || {}) };
      const goodsProgress = { ...(checklist.goods_progress || {}) };
      const key = `${liIdx}-${size}`;
      const next = nextGoodsStatusOnTap(goodsProgress[key]?.status);
      if (next === null) {
        delete goodsProgress[key];
      } else {
        goodsProgress[key] = {
          status: next,
          by: user?.full_name || user?.email || "Employee",
          at: new Date().toISOString(),
        };
      }
      checklist.goods_progress = goodsProgress;
      const updated = await base44.entities.Order.update(order.id, { checklist });
      setOrders(prev => prev.map(o => o.id === order.id ? updated : o));
      setSelected(updated);
      await maybeAutoAdvance(updated);
    } catch (err) {
      notify.error("Update failed", err);
    }
  }

  // Bulk override for the Order Goods parent tasks. Manual escape hatch
  // for shops whose blanks don't flow through the AS Colour PO
  // integration — they couldn't otherwise advance sizes from blank →
  // ordered (the per-size tap only handles ordered → received).
  async function bulkOrderGoodsStep(order, target) {
    try {
      const checklist = { ...(order.checklist || {}) };
      checklist.goods_progress = bulkSetOrderGoodsStep(
        order,
        target,
        user?.full_name || user?.email || "Employee",
      );
      const updated = await base44.entities.Order.update(order.id, { checklist });
      setOrders(prev => prev.map(o => o.id === order.id ? updated : o));
      setSelected(updated);
      await maybeAutoAdvance(updated);
    } catch (err) {
      notify.error("Update failed", err);
    }
  }

  // Soft-warn version of updateStatus for the "Move to Pre-Press"
  // button. Override is allowed for partial-ship scenarios. The
  // Printing → Completed transition takes a different path entirely
  // (handleComplete) so the full completion plan fires — stamps
  // completed_date, creates the invoice, writes the performance log,
  // attaches the broker PDF — not just a status flip.
  async function moveToNextStepWithGuard(order, nextStatus) {
    if (nextStatus === "Completed") {
      return handleComplete(order);
    }
    if (order.status === "Order Goods" && nextStatus === "Pre-Press") {
      const missing = unreceivedCount(order);
      const total = countGoodsProgress(order).total;
      if (missing > 0) {
        const ok = window.confirm(
          `${missing} of ${total} sizes haven't been marked received.\n\nMove to Pre-Press anyway?`
        );
        if (!ok) return;
      }
    }
    return updateStatus(order, nextStatus);
  }

  // Full completion flow — invoice creation, performance rows, broker
  // PDF attachment, notification — via the shared runOrderCompletion
  // helper. Same path Orders.jsx and Production.jsx use, so the three
  // surfaces can't drift on what "completed" actually means.
  async function handleComplete(order) {
    setUpdating(true);
    try {
      const updated = await runOrderCompletion({
        order,
        user,
        base44,
      });
      setOrders((prev) => prev.map((o) => (o.id === order.id ? updated : o)));
      // Floor operators usually move on after marking complete; clear
      // the selection so they see the next job in the queue.
      setSelected(null);
    } catch (err) {
      notify.error("Couldn't complete the order", err);
    } finally {
      setUpdating(false);
    }
  }

  async function sendNote(order) {
    if (!note.trim()) return;
    setSending(true);
    try {
      const stepNotes = { ...(order.step_notes || {}) };
      const step = order.status || "Pre-Press";
      if (!stepNotes[step]) stepNotes[step] = [];
      stepNotes[step].push({
        text: note.trim(),
        by: user?.full_name || user?.email || "Employee",
        at: new Date().toISOString(),
      });
      const updated = await base44.entities.Order.update(order.id, { step_notes: stepNotes });
      setOrders(prev => prev.map(o => o.id === order.id ? updated : o));
      setSelected(updated);
      setNote("");
    } catch (err) {
      notify.error("Update failed", err);
    } finally {
      setSending(false);
    }
  }

  const getQty = (order) => (order.line_items || []).reduce((sum, li) =>
    sum + Object.values(li.sizes || {}).reduce((s, v) => s + (parseInt(v) || 0), 0), 0);

  // Shop-timezone "today", NOT the UTC date — toISOString flips to
  // tomorrow at ~5pm Pacific and flagged orders LATE while still due today.
  const isOverdue = (order) => order.due_date && order.due_date < todayInShopTz() && order.status !== "Completed";

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl border border-red-200 p-6 max-w-sm text-center">
          <AlertTriangle className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <h2 className="font-bold text-slate-900 mb-2">Something went wrong</h2>
          <p className="text-sm text-slate-500 mb-4">{error}</p>
          <button onClick={() => window.location.reload()} className="bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-semibold">Reload</button>
        </div>
      </div>
    );
  }

  // Auth not ready yet
  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-teal-500 mx-auto mb-3" />
          <p className="text-sm text-slate-500">Connecting...</p>
        </div>
      </div>
    );
  }

  // Not logged in
  if (!session) return <LoginScreen />;

  // Loading orders
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100">
        <div className="bg-teal-600 h-16 shadow-lg" />
        <div className="max-w-3xl mx-auto">
          <ListCardsSkeleton rows={5} />
        </div>
      </div>
    );
  }

  // "My Jobs" — the operator's personal queue. assigned_operator stores the
  // employee's display label (full_name || email, see OrderJobCostSection),
  // so match the signed-in user against both forms, case-insensitively.
  const norm = (v) => String(v || "").trim().toLowerCase();
  const isMine = (o) => {
    const op = norm(o.assigned_operator);
    if (!op) return false;
    return op === norm(displayFullName(user)) || op === norm(user?.full_name) || op === norm(user?.email);
  };
  const myActive = orders.filter(o => isMine(o) && o.status !== "Completed" && o.status !== "Shipped");

  // Work queues surface the most urgent job first; orders arrive from the API
  // newest-created-first, which is the wrong order for a press operator.
  const byDueSoonest = (a, b) =>
    String(a.scheduled_date || a.due_date || "9999").localeCompare(String(b.scheduled_date || b.due_date || "9999"));

  const filtered = filter === "Active"
    ? orders.filter(o => o.status !== "Completed" && o.status !== "Shipped").sort(byDueSoonest)
    : filter === "Completed"
      ? orders.filter(o => o.status === "Completed" || o.status === "Shipped")
      : filter === "Mine"
        ? [...myActive].sort(byDueSoonest)
        : orders;

  const currentStepIdx = selected ? STEPS.indexOf(selected.status || "Pre-Press") : -1;
  const nextStep = currentStepIdx >= 0 && currentStepIdx < STEPS.length - 1 ? STEPS[currentStepIdx + 1] : null;
  const prevStep = currentStepIdx > 0 ? STEPS[currentStepIdx - 1] : null;

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      {/* Header */}
      <header className="floor-header bg-teal-600 text-white px-5 py-4 flex items-center justify-between sticky top-0 z-20 shadow-lg">
        <div className="flex items-center gap-3">
          <Package className="w-7 h-7" />
          <div>
            <h1 className="text-lg font-bold leading-tight">Shop Floor</h1>
            <p className="text-teal-200 text-xs">{user?.shop_name || displayFullName(user)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <EnablePushButton user={user} />
          <NotificationBell userEmail={user?.email} variant="floor" />
          <TimeClockButton user={user} />
          <button onClick={handleRefresh} className="p-2 hover:bg-teal-500 rounded-lg transition">
            <RefreshCw className={`w-5 h-5 ${refreshing ? "animate-spin" : ""}`} />
          </button>
          {/* Employees live here — their exit is sign-out. Owners/managers
              arrive via the "Floor Mode" nav item (2026-08-10) and ShopFloor
              covers the whole viewport, so without this they'd have NO way
              back except signing out. Give them an explicit exit instead. */}
          {user && user.role !== "employee" ? (
            <button
              onClick={() => { window.location.href = "/Dashboard"; }}
              className="flex items-center gap-2 px-3 py-2 hover:bg-teal-500 rounded-lg transition text-sm font-semibold"
            >
              <LogOut className="w-5 h-5" />
              Exit Floor Mode
            </button>
          ) : (
            <button onClick={handleLogout} className="p-2 hover:bg-teal-500 rounded-lg transition">
              <LogOut className="w-5 h-5" />
            </button>
          )}
        </div>
      </header>

      {/* Filter tabs */}
      <div className="bg-white border-b border-slate-200 px-5 py-2 flex gap-1">
        {[...(myActive.length > 0 ? ["Mine"] : []), "Active", "All", "Completed"].map(f => (
          <button key={f} onClick={() => { setFilter(f); setSelected(null); }}
            className={`text-sm font-semibold px-5 py-2 rounded-lg transition ${filter === f ? "bg-teal-600 text-white" : "text-slate-500 hover:bg-slate-100"}`}>
            {f === "Mine" ? `My Jobs (${myActive.length})` : f}
            {f === "Active" && ` (${orders.filter(o => o.status !== "Completed" && o.status !== "Shipped").length})`}
          </button>
        ))}
      </div>

      <MyTasksCard
        user={user}
        onSelectOrder={(oid) => {
          const hit = orders.find((o) => o.order_id === oid);
          if (hit) setSelected(hit);
        }}
      />

      <div className="flex-1 flex flex-col md:flex-row">
        {/* Order list */}
        <div className={`${selected ? "hidden md:block" : ""} md:w-96 bg-white border-r border-slate-200 overflow-y-auto`}>
          {filtered.length === 0 && (
            <div className="p-8 text-center text-slate-500 text-sm">No orders</div>
          )}
          {filtered.map(order => {
            const active = selected?.id === order.id;
            const overdue = isOverdue(order);
            const colors = STEP_COLORS[order.status] || STEP_COLORS["Pre-Press"];
            return (
              <button key={order.id} onClick={() => setSelected(order)}
                className={`w-full text-left px-5 py-4 border-b border-slate-100 transition ${active ? "bg-teal-50 border-l-4 border-l-teal-600" : "hover:bg-slate-50"} ${overdue ? "bg-red-50" : ""}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-slate-800">{(customers[order.customer_id] ? getDisplayName(customers[order.customer_id]) : order.customer_name) || "—"}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${colors.light}`}>
                    {order.status || "Pre-Press"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>{order.order_id} · {getQty(order)} pcs</span>
                  <span className={overdue ? "text-red-500 font-semibold" : ""}>
                    {overdue && "LATE · "}Due {fmtDate(order.due_date)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Order detail */}
        <div className="flex-1 overflow-y-auto">
          {!selected ? (
            <div className="flex items-center justify-center h-full p-8">
              <div className="text-center text-slate-300">
                <Package className="w-16 h-16 mx-auto mb-3 opacity-30" />
                <p className="text-lg font-semibold">Select an order</p>
                <p className="text-sm">Tap a job to see details and update status</p>
              </div>
            </div>
          ) : (
            <div className="p-5 space-y-4 max-w-2xl mx-auto">
              <button onClick={() => setSelected(null)} className="md:hidden text-sm text-teal-600 font-semibold mb-2">
                &larr; Back to list
              </button>

              {/* Header */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">{customers[selected.customer_id] ? getDisplayName(customers[selected.customer_id]) : selected.customer_name}</h2>
                    <p className="text-sm text-slate-500">{selected.order_id} · {getQty(selected)} pieces</p>
                  </div>
                  {isOverdue(selected) && (
                    <span className="flex items-center gap-1 text-xs font-bold text-red-600 bg-red-50 border border-red-200 px-2 py-1 rounded-full">
                      <AlertTriangle className="w-3 h-3" /> OVERDUE
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-sm text-slate-500">
                  {selected.due_date && <span className="flex items-center gap-1"><Clock className="w-4 h-4" /> Due {fmtDate(selected.due_date)}</span>}
                  {normalizeAssignedPress(selected.assigned_press) && <span>Press: {normalizeAssignedPress(selected.assigned_press)}</span>}
                  {selected.assigned_operator && <span>Operator: {selected.assigned_operator}</span>}
                  <button
                    onClick={() => setReportOpen((v) => !v)}
                    className="ml-auto inline-flex items-center gap-1.5 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg hover:bg-amber-100 transition"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" /> Report issue
                  </button>
                  <button
                    onClick={() => setShowTicket(true)}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-teal-700 bg-teal-50 border border-teal-200 px-3 py-1.5 rounded-lg hover:bg-teal-100 transition"
                  >
                    <Printer className="w-3.5 h-3.5" /> Print Ticket
                  </button>
                </div>
                {reportOpen && (
                  <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl p-3 flex flex-wrap items-end gap-3">
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-amber-800 mb-1">Garment</label>
                      <select value={report.lineIdx} onChange={(e) => setReport((r) => ({ ...r, lineIdx: Number(e.target.value), size: "" }))}
                        className="text-sm border border-amber-200 rounded-lg px-2 py-1.5 bg-white">
                        {(selected.line_items || []).map((li, i) => (
                          <option key={li.id || i} value={i}>{[li.brand, li.style, li.garmentColor].filter(Boolean).join(" ") || `Line ${i + 1}`}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-amber-800 mb-1">Size</label>
                      <select value={report.size} onChange={(e) => setReport((r) => ({ ...r, size: e.target.value }))}
                        className="text-sm border border-amber-200 rounded-lg px-2 py-1.5 bg-white">
                        <option value="">Pick…</option>
                        {sortSizeEntries(Object.entries(((selected.line_items || [])[report.lineIdx] || {}).sizes || {}))
                          .filter(([, v]) => parseInt(v) > 0)
                          .map(([sz, ct]) => <option key={sz} value={sz}>{sz} ({ct})</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-amber-800 mb-1">Qty</label>
                      <input type="number" min="1" value={report.qty} onChange={(e) => setReport((r) => ({ ...r, qty: e.target.value }))}
                        className="w-16 text-sm border border-amber-200 rounded-lg px-2 py-1.5 bg-white" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-amber-800 mb-1">Issue</label>
                      <select value={report.reason} onChange={(e) => setReport((r) => ({ ...r, reason: e.target.value }))}
                        className="text-sm border border-amber-200 rounded-lg px-2 py-1.5 bg-white">
                        <option value="short">Short (missing)</option>
                        <option value="misprinted">Misprinted</option>
                        <option value="damaged">Damaged blank</option>
                        <option value="wrong size/color received">Wrong size/color received</option>
                      </select>
                    </div>
                    <button
                      onClick={submitDiscrepancy}
                      disabled={reportBusy || !report.size || !(Number(report.qty) > 0)}
                      className="text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 rounded-lg transition disabled:opacity-50"
                    >
                      {reportBusy ? "Sending…" : "Send to office"}
                    </button>
                  </div>
                )}
              </div>

              {/* Status pipeline. Layout: header + current status chip on
                  the same row (chip top-right) → colored progress bars →
                  prev/next buttons below. Works the same on mobile and
                  desktop; previously the chip + buttons all sat below
                  the bars on one row, which wrapped awkwardly on phones. */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Production Status</h3>
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-lg border whitespace-nowrap ${STEP_COLORS[selected.status]?.light || "bg-slate-50"}`}>
                    {selected.status || "Pre-Press"}
                  </span>
                </div>
                <div className="flex gap-1 mb-4">
                  {STEPS.map((step) => {
                    const isCurrent = step === (selected.status || "Pre-Press");
                    const isDone = STEPS.indexOf(step) < STEPS.indexOf(selected.status || "Pre-Press");
                    const colors = STEP_COLORS[step];
                    return (
                      <div key={step} className={`flex-1 h-2 rounded-full transition ${isCurrent ? colors.bg : isDone ? colors.bg + " opacity-40" : "bg-slate-200"}`}
                        title={step} />
                    );
                  })}
                </div>
                <div className="flex items-center gap-2">
                  {prevStep && (
                    <button onClick={() => updateStatus(selected, prevStep)} disabled={updating}
                      className="text-xs font-semibold text-slate-500 border border-slate-200 px-3 py-2 rounded-lg hover:bg-slate-50 transition disabled:opacity-50">
                      &larr; {prevStep}
                    </button>
                  )}
                  <div className="flex-1" />
                  {nextStep && (
                    <button onClick={() => moveToNextStepWithGuard(selected, nextStep)} disabled={updating}
                      className="flex items-center gap-1 text-sm font-bold text-white bg-teal-600 hover:bg-teal-700 px-4 py-2 rounded-lg transition disabled:opacity-50">
                      {updating ? "..." : <>Move to {nextStep} <ChevronRight className="w-4 h-4" /></>}
                    </button>
                  )}
                  {!nextStep && selected.status === "Completed" && (
                    <span className="flex items-center gap-1 text-sm font-bold text-emerald-600">
                      <CheckCircle2 className="w-5 h-5" /> Complete
                    </span>
                  )}
                </div>
              </div>

              {/* Checklist */}
              {(() => {
                const step = selected.status || "Pre-Press";
                const tasks = getStageTasks(step);
                if (tasks.length === 0) return null;
                const checklist = selected.checklist || {};
                const stepChecks = checklist[step] || {};

                // Order Goods auto-derives Place blank order + Receive
                // goods from the per-size counts (pure logic in lib).
                const counts = countGoodsProgress(selected);
                const autoDone = (task) => autoCheckOrderGoodsTask(step, task, counts);
                const isDone = (task) => {
                  const a = autoDone(task);
                  return a === null ? !!stepChecks[task] : a;
                };
                const doneCount = tasks.filter(isDone).length;

                return (
                  <div className="bg-white rounded-2xl border border-slate-200 p-5">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Checklist — {step}</h3>
                      <span className="text-xs font-bold text-teal-600">{doneCount}/{tasks.length}</span>
                    </div>
                    <div className="flex gap-1 mb-4">
                      {tasks.map((_, i) => (
                        <div key={i} className={`flex-1 h-1.5 rounded-full ${i < doneCount ? "bg-emerald-400" : "bg-slate-200"}`} />
                      ))}
                    </div>
                    <div className="space-y-1">
                      {tasks.map(task => {
                        const auto = autoDone(task);
                        const done = isDone(task);
                        const info = stepChecks[task];
                        // Order Goods parent tasks become bulk-action
                        // buttons. Always clickable. See OrderDetailModal
                        // for the equivalent on the admin side.
                        const bulkTarget =
                          task === "Place blank order" ? "ordered" :
                          task === "Receive goods"     ? "received" :
                          null;
                        const handleClick = bulkTarget
                          ? () => bulkOrderGoodsStep(selected, bulkTarget)
                          : () => toggleTask(selected, task);
                        return (
                          <button key={task}
                            onClick={handleClick}
                            title={bulkTarget
                              ? `Marks every size as ${bulkTarget}. Or tap individual sizes below for partial.`
                              : undefined}
                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition ${done ? "bg-emerald-50 border border-emerald-200" : "bg-slate-50 hover:bg-slate-100 border border-transparent"}`}>
                            <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center flex-shrink-0 transition ${done ? "bg-emerald-500 border-emerald-500" : "border-slate-300"}`}>
                              {done && <CheckCircle2 className="w-4 h-4 text-white" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className={`text-sm font-medium ${done ? "text-emerald-700 line-through" : "text-slate-700"}`}>{task}</span>
                              {done && auto === null && info?.by && (
                                <p className="text-[10px] text-emerald-500 mt-0.5">{info.by} · {info.at ? new Date(info.at).toLocaleTimeString() : ""}</p>
                              )}
                              {bulkTarget && !done && (
                                <p className="text-[10px] text-slate-500 mt-0.5">Tap to mark all sizes</p>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Artwork — list every proof / file attached to this order
                  so the press operator can preview them in-app without
                  needing access to the order detail modal. Same lookup
                  shape as OrderDetailModal.getOrderArtwork: merge
                  selected_artwork (proofs + connected designs) with
                  per-imprint artwork. Tap a row to open the in-app
                  PDF/image viewer. */}
              {(() => {
                const art = getShopFloorArtwork(selected);
                if (!art.length) return null;
                return (
                  <div className="bg-white rounded-2xl border border-slate-200 p-5">
                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">
                      Artwork ({art.length})
                    </h3>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {art.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => a.url && setPreviewArt(a)}
                          disabled={!a.url}
                          className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-left hover:bg-teal-50 hover:border-teal-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-slate-800 truncate">{a.name}</div>
                            <div className="text-[11px] text-slate-500 truncate">
                              {a.colors ? `${a.colors} color${String(a.colors) === "1" ? "" : "s"} · ` : ""}
                              {a.placements?.length ? a.placements.join(", ") : a.source}
                            </div>
                          </div>
                          <span className="shrink-0 text-xs font-semibold text-teal-600">Open</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Job ticket — stage-aware per-size tracking.
                  Order Goods: ordered/received cycle (goods_progress).
                  Printing:    per-imprint print tracking (print_progress).
                  Other stages: read-only quantity. */}
              {(() => {
                const stage = selected.status || "Pre-Press";
                const goodsProgress = selected.checklist?.goods_progress || {};
                const printProgress = selected.checklist?.print_progress || {};

                const { total: goodsTotal, ordered: goodsOrdered, received: goodsReceived } = countGoodsProgress(selected);

                return (
                  <div className="bg-white rounded-2xl border border-slate-200 p-5">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Job Ticket</h3>
                      {stage === "Order Goods" && goodsTotal > 0 && (
                        <span className="text-xs font-bold text-slate-500">
                          <span className="text-emerald-600">{goodsReceived}</span>
                          <span className="text-slate-500"> received</span>
                          {goodsOrdered > 0 && <>
                            <span className="text-slate-300 mx-1.5">·</span>
                            <span className="text-amber-600">{goodsOrdered}</span>
                            <span className="text-slate-500"> ordered</span>
                          </>}
                          <span className="text-slate-300 mx-1.5">·</span>
                          <span className="text-slate-500">{goodsTotal} total</span>
                        </span>
                      )}
                    </div>
                    <div className="space-y-3">
                      {(selected.line_items || []).map((li, idx) => {
                        const qty = Object.values(li.sizes || {}).reduce((s, v) => s + (parseInt(v) || 0), 0);
                        const imprints = (li.imprints || []).filter(imp => (imp.colors || 0) > 0);

                        const lineProof = getLineProof(selected, li);
                        return (
                          <div key={idx} className="bg-slate-50 rounded-xl p-4">
                            <div className="flex items-center justify-between mb-2">
                              {/* Tap the garment to open its proof (falls back
                                  to the order-level proof). Plain text when no
                                  artwork is attached — no dead buttons on the
                                  floor. */}
                              {lineProof ? (
                                <button
                                  type="button"
                                  onClick={() => setPreviewArt(lineProof)}
                                  className="font-bold text-slate-800 text-left flex items-center gap-2 hover:text-teal-700 transition"
                                  title={`View proof: ${lineProof.name}`}
                                >
                                  <span>{li.brand ? `${li.brand} ` : ""}{li.style || "Item"}{li.garmentColor ? ` — ${li.garmentColor}` : ""}</span>
                                  <FileImage className="w-4 h-4 text-teal-600 shrink-0" />
                                </button>
                              ) : (
                                <div className="font-bold text-slate-800">
                                  {li.brand ? `${li.brand} ` : ""}{li.style || "Item"}{li.garmentColor ? ` — ${li.garmentColor}` : ""}
                                </div>
                              )}
                              <span className="text-lg font-bold text-teal-600">{qty}</span>
                            </div>

                            {/* Imprint locations — lead with the imprint's
                                title when set so operators can spot a
                                specific print at a glance instead of
                                parsing "Front · 1c · Screen Print" three
                                imprints at a time. */}
                            <div className="flex flex-wrap gap-2 mb-3">
                              {imprints.map((imp, ii) => {
                                const impArt = getImprintArt(selected, imp);
                                const chipBody = (
                                  <>
                                    {imp.title && (
                                      <span className="text-slate-800">{imp.title} </span>
                                    )}
                                    <span className="text-slate-500">
                                      {imp.title ? "· " : ""}{imp.location} · {imprintCountText(imp, getShopPricingConfig()?.embroidery?.stitchTiers)} · {imp.technique || "Screen Print"}
                                    </span>
                                  </>
                                );
                                // Multi-design jobs: each imprint that carries
                                // its own artwork opens THAT design. Chips
                                // without art stay inert text.
                                return impArt ? (
                                  <button
                                    key={ii}
                                    type="button"
                                    onClick={() => setPreviewArt(impArt)}
                                    title={`View design: ${impArt.name}`}
                                    className="text-xs font-semibold bg-white border border-teal-300 rounded-lg px-2 py-1 inline-flex items-center gap-1.5 hover:bg-teal-50 transition"
                                  >
                                    <FileImage className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                                    {chipBody}
                                  </button>
                                ) : (
                                  <span key={ii} className="text-xs font-semibold bg-white border border-slate-200 rounded-lg px-2 py-1">
                                    {chipBody}
                                  </span>
                                );
                              })}
                            </div>

                            {/* Sizes — interaction depends on stage */}
                            <div className="flex flex-wrap gap-2">
                              {sortSizeEntries(Object.entries(li.sizes || {})).filter(([, v]) => parseInt(v) > 0).map(([size, count]) => {
                                // ── Order Goods: blank → ordered → received → blank ──
                                // All three states tap-able (cycle).
                                if (stage === "Order Goods") {
                                  const status = goodsProgress[`${idx}-${size}`]?.status;
                                  const label =
                                    status === "received" ? "Received"
                                    : status === "ordered" ? "Ordered"
                                    : null;
                                  const tooltip =
                                    status === "received" ? "Tap to clear back to blank"
                                    : status === "ordered" ? "Tap to mark received"
                                    : "Tap to mark ordered";
                                  return (
                                    <button key={size}
                                      onClick={() => toggleGoods(selected, idx, size)}
                                      title={tooltip}
                                      className={`text-sm rounded-xl px-4 py-2.5 font-bold border-2 transition flex flex-col items-center min-w-[72px] ${
                                        status === "received"
                                          ? "bg-emerald-100 border-emerald-400 text-emerald-700 hover:bg-emerald-50"
                                          : status === "ordered"
                                            ? "bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100"
                                            : "bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100"
                                      }`}>
                                      <span>{size}: {count}</span>
                                      {label && (
                                        <span className={`text-[10px] font-semibold uppercase tracking-wide mt-0.5 ${
                                          status === "received" ? "text-emerald-600" : "text-amber-600"
                                        }`}>
                                          {label}
                                        </span>
                                      )}
                                    </button>
                                  );
                                }

                                // ── Printing: per-imprint progress ──
                                if (stage === "Printing") {
                                  const totalPrints = imprints.length;
                                  const donePrints = imprints.filter((_, ii) => !!printProgress[`${idx}-${size}-${ii}`]).length;
                                  const allDone = totalPrints > 0 && donePrints === totalPrints;
                                  const partial = donePrints > 0 && !allDone;
                                  return (
                                    <div key={size} className="flex flex-col items-center">
                                      <button
                                        onClick={() => {
                                          if (allDone) {
                                            imprints.forEach((_, ii) => togglePrint(selected, idx, size, ii));
                                          } else {
                                            const nextIdx = imprints.findIndex((_, ii) => !printProgress[`${idx}-${size}-${ii}`]);
                                            if (nextIdx !== -1) togglePrint(selected, idx, size, nextIdx);
                                          }
                                        }}
                                        className={`text-sm rounded-xl px-4 py-2.5 font-bold border-2 transition ${
                                          allDone
                                            ? "bg-emerald-100 border-emerald-400 text-emerald-700"
                                            : partial
                                              ? "bg-amber-50 border-amber-300 text-amber-700"
                                              : "bg-white border-slate-200 text-slate-700 hover:border-teal-300"
                                        }`}>
                                        {size}: {count}
                                        {allDone && <span className="ml-1">✓</span>}
                                      </button>
                                      {totalPrints > 1 && (
                                        <div className="flex gap-0.5 mt-1">
                                          {imprints.map((imp, ii) => (
                                            <button key={ii} onClick={() => togglePrint(selected, idx, size, ii)}
                                              title={`${imp.location}: ${printProgress[`${idx}-${size}-${ii}`] ? "Done" : "Not done"}`}
                                              className={`w-3 h-3 rounded-full transition ${
                                                printProgress[`${idx}-${size}-${ii}`]
                                                  ? "bg-emerald-400"
                                                  : "bg-slate-300 hover:bg-slate-400"
                                              }`} />
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  );
                                }

                                // ── Other stages: read-only quantity ──
                                return (
                                  <span key={size}
                                    className="text-sm rounded-xl px-4 py-2.5 font-bold border-2 bg-white border-slate-200 text-slate-700">
                                    {size}: {count}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Notes */}
              {selected.notes && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
                  <h3 className="text-xs font-bold text-amber-600 uppercase tracking-widest mb-2">Job Notes</h3>
                  <p className="text-sm text-amber-800 leading-relaxed">{selected.notes}</p>
                </div>
              )}

              {/* Team thread — @mentions ping teammates' bells + phones. */}
              <OrderComments order={selected} user={user} />

              {/* Updates */}
              {(() => {
                const allNotes = [];
                Object.entries(selected.step_notes || {}).forEach(([step, notes]) => {
                  (notes || []).forEach(n => allNotes.push({ ...n, step }));
                });
                allNotes.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
                if (allNotes.length === 0) return null;
                return (
                  <div className="bg-white rounded-2xl border border-slate-200 p-5">
                    <button
                      type="button"
                      onClick={() => setUpdatesCollapsed((c) => !c)}
                      aria-expanded={!updatesCollapsed}
                      className={`w-full flex items-center justify-between text-left ${updatesCollapsed ? "" : "mb-3"}`}
                    >
                      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                        Updates <span className="text-slate-300 font-semibold">({allNotes.length})</span>
                      </h3>
                      <ChevronDown
                        className={`w-4 h-4 text-slate-500 transition-transform duration-200 ${updatesCollapsed ? "-rotate-90" : "rotate-0"}`}
                        aria-hidden="true"
                      />
                    </button>
                    {!updatesCollapsed && (
                      <div className="space-y-2 max-h-60 overflow-y-auto">
                        {allNotes.map((n, i) => (
                          <div key={i} className="flex gap-3 text-sm">
                            <div className="w-2 h-2 rounded-full bg-teal-400 mt-1.5 flex-shrink-0" />
                            <div>
                              <p className="text-slate-700">{n.text}</p>
                              <p className="text-xs text-slate-500">{n.by} · {n.step} · {n.at ? new Date(n.at).toLocaleString() : ""}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Add note */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Add Update</h3>
                <div className="flex gap-2">
                  <input value={note} onChange={e => setNote(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && sendNote(selected)}
                    placeholder="Add a note or update..."
                    className="flex-1 text-sm border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-teal-300" />
                  <button onClick={() => sendNote(selected)} disabled={sending || !note.trim()}
                    className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-3 rounded-xl transition disabled:opacity-50">
                    <Send className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {previewArt && (
        <ArtworkPreviewOverlay
          art={previewArt}
          onClose={() => setPreviewArt(null)}
          backLabel="Back to job"
        />
      )}

      {showTicket && selected && (
        <ProductionTicket
          order={selected}
          customer={customers[selected.customer_id]}
          shopName={user?.shop_name}
          stitchTiers={getShopPricingConfig()?.embroidery?.stitchTiers}
          onClose={() => setShowTicket(false)}
        />
      )}
    </div>
  );
}
