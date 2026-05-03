import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { CheckCircle2, Circle, ChevronDown, ChevronUp, X, Sparkles } from "lucide-react";

const STEPS = [
  {
    id: "customer",
    label: "Add your first customer",
    description: "Create a customer record to start building quotes.",
    page: "Customers",
    check: (data) => data.customers > 0,
  },
  {
    id: "quote",
    label: "Create your first quote",
    description: "Build a quote with line items and send it for approval.",
    page: "Quotes",
    check: (data) => data.quotes > 0,
  },
  {
    id: "order",
    label: "Convert a quote to an order",
    description: "Approve a quote and move it into production tracking.",
    page: "Production",
    check: (data) => data.orders > 0,
  },
  {
    id: "pricing",
    label: "Set up your pricing",
    description: "Configure print pricing, markup, and quantity tiers.",
    page: "Account",
    check: (data) => data.hasPricing,
  },
  {
    id: "inventory",
    label: "Add inventory items",
    description: "Track blanks, inks, and supplies with reorder alerts.",
    page: "Inventory",
    check: (data) => data.inventory > 0,
  },
];

export default function GettingStartedChecklist({ quotes, orders, customers, inventory, hasPricing }) {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem("inktracker-checklist-dismissed") === "1"; } catch { return false; }
  });
  const [collapsed, setCollapsed] = useState(false);

  if (dismissed) return null;

  const data = {
    quotes: quotes?.length || 0,
    orders: orders?.length || 0,
    customers: customers || 0,
    inventory: inventory?.length || 0,
    hasPricing,
  };

  const completed = STEPS.filter(s => s.check(data)).length;
  const allDone = completed === STEPS.length;
  const progress = Math.round((completed / STEPS.length) * 100);

  function dismiss() {
    localStorage.setItem("inktracker-checklist-dismissed", "1");
    setDismissed(true);
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
        <button onClick={() => setCollapsed(v => !v)} className="flex items-center gap-3 flex-1 text-left">
          <div className="w-8 h-8 rounded-xl bg-indigo-100 flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-indigo-600" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
              {allDone ? "You're all set!" : "Getting Started"}
            </h3>
            <p className="text-xs text-slate-400">
              {allDone ? "Your shop is ready to go." : `${completed} of ${STEPS.length} complete`}
            </p>
          </div>
        </button>
        <div className="flex items-center gap-2">
          {/* Progress bar */}
          <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden hidden sm:block">
            <div
              className="h-full bg-indigo-600 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-xs font-bold text-indigo-600">{progress}%</span>
          <button onClick={() => setCollapsed(v => !v)} className="p-1 text-slate-300 hover:text-slate-500">
            {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
          <button onClick={dismiss} className="p-1 text-slate-300 hover:text-slate-500" title="Dismiss checklist">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Steps */}
      {!collapsed && (
        <div className="divide-y divide-slate-50 dark:divide-slate-800">
          {STEPS.map(step => {
            const done = step.check(data);
            return (
              <button
                key={step.id}
                onClick={() => !done && navigate(createPageUrl(step.page))}
                className={`w-full flex items-center gap-3 px-5 py-3 text-left transition ${done ? "opacity-60" : "hover:bg-slate-50 dark:hover:bg-slate-800"}`}
              >
                {done
                  ? <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                  : <Circle className="w-5 h-5 text-slate-200 shrink-0" />
                }
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-semibold ${done ? "text-slate-400 line-through" : "text-slate-700 dark:text-slate-200"}`}>
                    {step.label}
                  </div>
                  {!done && (
                    <p className="text-xs text-slate-400 mt-0.5">{step.description}</p>
                  )}
                </div>
                {!done && (
                  <span className="text-xs font-semibold text-indigo-600 shrink-0">Go &rarr;</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* All done CTA */}
      {!collapsed && allDone && (
        <div className="px-5 py-3 bg-emerald-50 border-t border-emerald-100">
          <button onClick={dismiss} className="text-sm font-semibold text-emerald-700 hover:text-emerald-800 transition">
            Dismiss checklist
          </button>
        </div>
      )}
    </div>
  );
}
