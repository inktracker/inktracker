import { useState, useEffect } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import { fmtDate, sortSizeEntries } from "../components/shared/pricing";
import { Package, ChevronRight, RefreshCw, LogOut, Send, Clock, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";

const STEPS = ["Art Approval", "Order Goods", "Pre-Press", "Printing", "Finishing", "Quality Check", "Packing", "Completed"];

const STEP_TASKS = {
  "Art Approval": ["Receive artwork", "Review file specs", "Send proof to customer", "Get approval"],
  "Order Goods": ["Check inventory", "Place blank order", "Confirm delivery date", "Receive goods"],
  "Pre-Press": ["Burn screens", "Set up registration", "Mix ink colors", "Color match (if needed)"],
  "Printing": ["Mount screens on press", "Run test prints", "Get test approval", "Run full batch", "Spot check quality"],
  "Finishing": ["Flash/cure prints", "Quality inspect", "Fold & tag", "Count pieces"],
  "Quality Check": ["Verify quantities", "Check print quality", "Match against order", "Flag any issues"],
  "Packing": ["Sort by size", "Bag/box order", "Label packages", "Stage for pickup/shipping"],
};

const STEP_COLORS = {
  "Art Approval": { bg: "bg-purple-500", light: "bg-purple-50 text-purple-700 border-purple-200" },
  "Order Goods": { bg: "bg-amber-500", light: "bg-amber-50 text-amber-700 border-amber-200" },
  "Pre-Press": { bg: "bg-blue-500", light: "bg-blue-50 text-blue-700 border-blue-200" },
  "Printing": { bg: "bg-indigo-500", light: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  "Finishing": { bg: "bg-teal-500", light: "bg-teal-50 text-teal-700 border-teal-200" },
  "Quality Check": { bg: "bg-orange-500", light: "bg-orange-50 text-orange-700 border-orange-200" },
  "Packing": { bg: "bg-emerald-500", light: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  "Completed": { bg: "bg-slate-400", light: "bg-slate-50 text-slate-600 border-slate-200" },
};

function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) setError(err.message);
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-indigo-600 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8">
        <div className="text-center mb-6">
          <Package className="w-12 h-12 text-indigo-600 mx-auto mb-3" />
          <h1 className="text-xl font-bold text-slate-900">Shop Floor</h1>
          <p className="text-sm text-slate-400 mt-1">Sign in to view your orders</p>
        </div>
        <form onSubmit={handleLogin} className="space-y-3">
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="Email" autoFocus required
            className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Password" required
            className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-xl transition disabled:opacity-50">
            {loading ? "Signing in..." : "Sign In"}
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
  const [filter, setFilter] = useState("Active");
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
          const allOrders = await base44.entities.Order.list("-created_date", 200);
          setOrders(allOrders);
        } catch { setOrders([]); }
      }
    } catch (err) {
      console.error("Load failed:", err);
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
      alert("Update failed: " + err.message);
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
    } catch (err) {
      alert("Failed to update: " + err.message);
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
    } catch (err) {
      alert("Failed: " + err.message);
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
      alert("Failed: " + err.message);
    } finally {
      setSending(false);
    }
  }

  const getQty = (order) => (order.line_items || []).reduce((sum, li) =>
    sum + Object.values(li.sizes || {}).reduce((s, v) => s + (parseInt(v) || 0), 0), 0);

  const isOverdue = (order) => order.due_date && order.due_date < new Date().toISOString().split("T")[0] && order.status !== "Completed";

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl border border-red-200 p-6 max-w-sm text-center">
          <AlertTriangle className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <h2 className="font-bold text-slate-900 mb-2">Something went wrong</h2>
          <p className="text-sm text-slate-500 mb-4">{error}</p>
          <button onClick={() => window.location.reload()} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold">Reload</button>
        </div>
      </div>
    );
  }

  // Auth not ready yet
  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mx-auto mb-3" />
          <p className="text-sm text-slate-400">Connecting...</p>
        </div>
      </div>
    );
  }

  // Not logged in
  if (!session) return <LoginScreen />;

  // Loading orders
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mx-auto mb-3" />
          <p className="text-sm text-slate-400">Loading orders...</p>
        </div>
      </div>
    );
  }

  const filtered = filter === "Active"
    ? orders.filter(o => o.status !== "Completed" && o.status !== "Shipped")
    : filter === "Completed"
      ? orders.filter(o => o.status === "Completed" || o.status === "Shipped")
      : orders;

  const currentStepIdx = selected ? STEPS.indexOf(selected.status || "Pre-Press") : -1;
  const nextStep = currentStepIdx >= 0 && currentStepIdx < STEPS.length - 1 ? STEPS[currentStepIdx + 1] : null;
  const prevStep = currentStepIdx > 0 ? STEPS[currentStepIdx - 1] : null;

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      {/* Header */}
      <header className="bg-indigo-600 text-white px-5 py-4 flex items-center justify-between sticky top-0 z-20 shadow-lg">
        <div className="flex items-center gap-3">
          <Package className="w-7 h-7" />
          <div>
            <h1 className="text-lg font-bold leading-tight">Shop Floor</h1>
            <p className="text-indigo-200 text-xs">{user?.full_name || user?.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleRefresh} className="p-2 hover:bg-indigo-500 rounded-lg transition">
            <RefreshCw className={`w-5 h-5 ${refreshing ? "animate-spin" : ""}`} />
          </button>
          <button onClick={handleLogout} className="p-2 hover:bg-indigo-500 rounded-lg transition">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Filter tabs */}
      <div className="bg-white border-b border-slate-200 px-5 py-2 flex gap-1">
        {["Active", "All", "Completed"].map(f => (
          <button key={f} onClick={() => { setFilter(f); setSelected(null); }}
            className={`text-sm font-semibold px-5 py-2 rounded-lg transition ${filter === f ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-100"}`}>
            {f} {f === "Active" && `(${orders.filter(o => o.status !== "Completed" && o.status !== "Shipped").length})`}
          </button>
        ))}
      </div>

      <div className="flex-1 flex flex-col md:flex-row">
        {/* Order list */}
        <div className={`${selected ? "hidden md:block" : ""} md:w-96 bg-white border-r border-slate-200 overflow-y-auto`}>
          {filtered.length === 0 && (
            <div className="p-8 text-center text-slate-400 text-sm">No orders</div>
          )}
          {filtered.map(order => {
            const active = selected?.id === order.id;
            const overdue = isOverdue(order);
            const colors = STEP_COLORS[order.status] || STEP_COLORS["Pre-Press"];
            return (
              <button key={order.id} onClick={() => setSelected(order)}
                className={`w-full text-left px-5 py-4 border-b border-slate-100 transition ${active ? "bg-indigo-50 border-l-4 border-l-indigo-600" : "hover:bg-slate-50"} ${overdue ? "bg-red-50" : ""}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-slate-800">{customers[order.customer_id]?.company || order.customer_name || "—"}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${colors.light}`}>
                    {order.status || "Pre-Press"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-400">
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
              <button onClick={() => setSelected(null)} className="md:hidden text-sm text-indigo-600 font-semibold mb-2">
                &larr; Back to list
              </button>

              {/* Header */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">{customers[selected.customer_id]?.company || selected.customer_name}</h2>
                    <p className="text-sm text-slate-400">{selected.order_id} · {getQty(selected)} pieces</p>
                  </div>
                  {isOverdue(selected) && (
                    <span className="flex items-center gap-1 text-xs font-bold text-red-600 bg-red-50 border border-red-200 px-2 py-1 rounded-full">
                      <AlertTriangle className="w-3 h-3" /> OVERDUE
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-sm text-slate-500">
                  {selected.due_date && <span className="flex items-center gap-1"><Clock className="w-4 h-4" /> Due {fmtDate(selected.due_date)}</span>}
                  {selected.assigned_press && <span>Press: {selected.assigned_press}</span>}
                  {selected.assigned_operator && <span>Operator: {selected.assigned_operator}</span>}
                </div>
              </div>

              {/* Status pipeline */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Production Status</h3>
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
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-bold px-3 py-1.5 rounded-lg border ${STEP_COLORS[selected.status]?.light || "bg-slate-50"}`}>
                    {selected.status || "Pre-Press"}
                  </span>
                  <div className="flex gap-2">
                    {prevStep && (
                      <button onClick={() => updateStatus(selected, prevStep)} disabled={updating}
                        className="text-xs font-semibold text-slate-500 border border-slate-200 px-3 py-2 rounded-lg hover:bg-slate-50 transition disabled:opacity-50">
                        &larr; {prevStep}
                      </button>
                    )}
                    {nextStep && (
                      <button onClick={() => updateStatus(selected, nextStep)} disabled={updating}
                        className="flex items-center gap-1 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-lg transition disabled:opacity-50">
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
              </div>

              {/* Checklist */}
              {(() => {
                const step = selected.status || "Pre-Press";
                const tasks = STEP_TASKS[step] || [];
                if (tasks.length === 0) return null;
                const checklist = selected.checklist || {};
                const stepChecks = checklist[step] || {};
                const doneCount = tasks.filter(t => !!stepChecks[t]).length;
                return (
                  <div className="bg-white rounded-2xl border border-slate-200 p-5">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Checklist — {step}</h3>
                      <span className="text-xs font-bold text-indigo-600">{doneCount}/{tasks.length}</span>
                    </div>
                    <div className="flex gap-1 mb-4">
                      {tasks.map((_, i) => (
                        <div key={i} className={`flex-1 h-1.5 rounded-full ${i < doneCount ? "bg-emerald-400" : "bg-slate-200"}`} />
                      ))}
                    </div>
                    <div className="space-y-1">
                      {tasks.map(task => {
                        const done = !!stepChecks[task];
                        const info = stepChecks[task];
                        return (
                          <button key={task} onClick={() => toggleTask(selected, task)}
                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition ${done ? "bg-emerald-50 border border-emerald-200" : "bg-slate-50 hover:bg-slate-100 border border-transparent"}`}>
                            <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center flex-shrink-0 transition ${done ? "bg-emerald-500 border-emerald-500" : "border-slate-300"}`}>
                              {done && <CheckCircle2 className="w-4 h-4 text-white" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className={`text-sm font-medium ${done ? "text-emerald-700 line-through" : "text-slate-700"}`}>{task}</span>
                              {done && info?.by && (
                                <p className="text-[10px] text-emerald-500 mt-0.5">{info.by} · {info.at ? new Date(info.at).toLocaleTimeString() : ""}</p>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Job ticket */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Job Ticket</h3>
                <div className="space-y-3">
                  {(selected.line_items || []).map((li, idx) => {
                    const qty = Object.values(li.sizes || {}).reduce((s, v) => s + (parseInt(v) || 0), 0);
                    const imprints = (li.imprints || []).filter(imp => (imp.colors || 0) > 0);
                    const printProgress = selected.checklist?.print_progress || {};

                    return (
                      <div key={idx} className="bg-slate-50 rounded-xl p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="font-bold text-slate-800">
                            {li.brand ? `${li.brand} ` : ""}{li.style || "Item"}{li.garmentColor ? ` — ${li.garmentColor}` : ""}
                          </div>
                          <span className="text-lg font-bold text-indigo-600">{qty}</span>
                        </div>

                        {/* Imprint locations */}
                        <div className="flex flex-wrap gap-2 mb-3">
                          {imprints.map((imp, ii) => (
                            <span key={ii} className="text-xs font-semibold text-slate-500 bg-white border border-slate-200 rounded-lg px-2 py-1">
                              {imp.location} · {imp.colors}c · {imp.technique || "Screen Print"}
                            </span>
                          ))}
                        </div>

                        {/* Sizes with print tracking */}
                        <div className="flex flex-wrap gap-2">
                          {sortSizeEntries(Object.entries(li.sizes || {})).filter(([, v]) => parseInt(v) > 0).map(([size, count]) => {
                            const totalPrints = imprints.length;
                            const donePrints = imprints.filter((_, ii) => !!printProgress[`${idx}-${size}-${ii}`]).length;
                            const allDone = totalPrints > 0 && donePrints === totalPrints;
                            const partial = donePrints > 0 && !allDone;

                            return (
                              <div key={size} className="flex flex-col items-center">
                                <button
                                  onClick={() => {
                                    // Toggle the next unfinished print, or untoggle all if all done
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
                                        : "bg-white border-slate-200 text-slate-700 hover:border-indigo-300"
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
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Notes */}
              {selected.notes && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
                  <h3 className="text-xs font-bold text-amber-600 uppercase tracking-widest mb-2">Job Notes</h3>
                  <p className="text-sm text-amber-800 leading-relaxed">{selected.notes}</p>
                </div>
              )}

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
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Updates</h3>
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {allNotes.map((n, i) => (
                        <div key={i} className="flex gap-3 text-sm">
                          <div className="w-2 h-2 rounded-full bg-indigo-400 mt-1.5 flex-shrink-0" />
                          <div>
                            <p className="text-slate-700">{n.text}</p>
                            <p className="text-xs text-slate-400">{n.by} · {n.step} · {n.at ? new Date(n.at).toLocaleString() : ""}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Add note */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Add Update</h3>
                <div className="flex gap-2">
                  <input value={note} onChange={e => setNote(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && sendNote(selected)}
                    placeholder="Add a note or update..."
                    className="flex-1 text-sm border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                  <button onClick={() => sendNote(selected)} disabled={sending || !note.trim()}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-3 rounded-xl transition disabled:opacity-50">
                    <Send className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
