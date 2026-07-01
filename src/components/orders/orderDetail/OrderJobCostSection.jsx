import { fmtMoney } from "../../shared/pricing";

// Job Costing & Production Assignment section for the Order Detail modal:
// collapsible panel with estimated/actual hours, material + labor cost,
// assigned press/operator dropdowns, and a Job P&L summary. All state +
// the save handler are owned by the parent and threaded in. Pure
// decomposition — moved verbatim from OrderDetailModal.jsx.
export default function OrderJobCostSection({
  order,
  showJobCost,
  setShowJobCost,
  estimatedHours,
  setEstimatedHours,
  laborHours,
  setLaborHours,
  actualCost,
  setActualCost,
  laborCost,
  setLaborCost,
  assignedPress,
  setAssignedPress,
  assignedOperator,
  setAssignedOperator,
  presses,
  employees,
  handleSaveJobCost,
  savingCost,
  costSaved,
}) {
  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
      <button onClick={() => setShowJobCost(!showJobCost)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 transition text-left">
        <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Job Costing & Production</div>
        <div className="flex items-center gap-3">
          {(parseFloat(actualCost) > 0 || order.actual_cost > 0) && (
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
              (order.total || 0) - (parseFloat(actualCost) || order.actual_cost || 0) > 0
                ? "text-emerald-700 bg-emerald-50" : "text-red-600 bg-red-50"
            }`}>
              {fmtMoney((order.total || 0) - (parseFloat(actualCost) || order.actual_cost || 0))} margin
            </span>
          )}
          <span className="text-xs text-slate-500">{showJobCost ? "▲" : "▼"}</span>
        </div>
      </button>
      {showJobCost && (
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="text-[10px] font-semibold text-slate-500 dark:text-slate-500 uppercase">Estimated Hours</label>
              <input type="number" min="0" step="0.25" value={estimatedHours} onChange={e => setEstimatedHours(e.target.value)}
                placeholder="planning"
                className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-300 mt-0.5" />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-slate-500 dark:text-slate-500 uppercase">Actual Hours</label>
              <input type="number" min="0" step="0.25" value={laborHours} onChange={e => setLaborHours(e.target.value)}
                placeholder="after run"
                className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-300 mt-0.5" />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-slate-500 dark:text-slate-500 uppercase">Material Cost</label>
              <div className="relative mt-0.5">
                <span className="absolute left-2 top-1.5 text-slate-500 text-sm">$</span>
                <input type="number" min="0" step="0.01" value={actualCost} onChange={e => setActualCost(e.target.value)}
                  className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg pl-5 pr-2 py-1.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-300" />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-slate-500 dark:text-slate-500 uppercase">Labor Cost</label>
              <div className="relative mt-0.5">
                <span className="absolute left-2 top-1.5 text-slate-500 text-sm">$</span>
                <input type="number" min="0" step="0.01" value={laborCost} onChange={e => setLaborCost(e.target.value)}
                  className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg pl-5 pr-2 py-1.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-300" />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-semibold text-slate-500 dark:text-slate-500 uppercase">Assigned Press</label>
              {presses.length > 0 ? (
                <select
                  value={assignedPress}
                  onChange={e => setAssignedPress(e.target.value)}
                  className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-300 mt-0.5"
                >
                  <option value="">— Unassigned —</option>
                  {presses.map(p => (
                    <option key={p.name} value={p.name}>
                      {p.name}{p.colors ? ` — ${p.colors}c` : ""}
                    </option>
                  ))}
                  {/* Preserve a saved legacy/free-text value
                      that's not in the shop's current list so
                      we don't silently drop it. */}
                  {assignedPress && !presses.some(p => p.name === assignedPress) && (
                    <option value={assignedPress}>{assignedPress} (custom)</option>
                  )}
                </select>
              ) : (
                <input type="text" value={assignedPress} onChange={e => setAssignedPress(e.target.value)}
                  placeholder="Add presses in Account → Production Setup"
                  className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-300 mt-0.5" />
              )}
            </div>
            <div>
              <label className="text-[10px] font-semibold text-slate-500 dark:text-slate-500 uppercase">Assigned Operator</label>
              {employees.length > 0 ? (
                <select
                  value={assignedOperator}
                  onChange={e => setAssignedOperator(e.target.value)}
                  className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-300 mt-0.5"
                >
                  <option value="">— Unassigned —</option>
                  {employees.map(u => {
                    const label = u.full_name || u.email;
                    return <option key={u.id} value={label}>{label}</option>;
                  })}
                  {/* Preserve a saved legacy/free-text value
                      that doesn't match any current employee. */}
                  {assignedOperator &&
                   !employees.some(u => (u.full_name || u.email) === assignedOperator) && (
                    <option value={assignedOperator}>{assignedOperator} (custom)</option>
                  )}
                </select>
              ) : (
                <input type="text" value={assignedOperator} onChange={e => setAssignedOperator(e.target.value)}
                  placeholder="Invite employees from Account → Admin Panel"
                  className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-300 mt-0.5" />
              )}
            </div>
          </div>

          {/* Job P&L summary */}
          {(parseFloat(actualCost) > 0 || parseFloat(laborCost) > 0) && (() => {
            const totalCost = (parseFloat(actualCost) || 0) + (parseFloat(laborCost) || 0);
            const revenue = order.total || 0;
            const margin = revenue - totalCost;
            const marginPct = revenue > 0 ? ((margin / revenue) * 100).toFixed(1) : 0;
            return (
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-1.5">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Job P&L</div>
                <div className="flex justify-between text-sm"><span className="text-slate-500">Revenue</span><span className="font-semibold text-slate-800 dark:text-slate-200">{fmtMoney(revenue)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-slate-500">Material Cost</span><span className="font-semibold text-slate-800 dark:text-slate-200">−{fmtMoney(parseFloat(actualCost) || 0)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-slate-500">Labor Cost</span><span className="font-semibold text-slate-800 dark:text-slate-200">−{fmtMoney(parseFloat(laborCost) || 0)}</span></div>
                <div className={`flex justify-between text-sm font-bold border-t border-slate-200 dark:border-slate-600 pt-1.5 ${margin >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                  <span>Profit ({marginPct}%)</span><span>{fmtMoney(margin)}</span>
                </div>
              </div>
            );
          })()}

          <div className="flex items-center gap-2">
            <button onClick={handleSaveJobCost} disabled={savingCost}
              className="bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition">
              {savingCost ? "Saving…" : "Save"}
            </button>
            {costSaved && <span className="text-xs text-emerald-600 font-semibold">Saved</span>}
          </div>
        </div>
      )}
    </div>
  );
}
