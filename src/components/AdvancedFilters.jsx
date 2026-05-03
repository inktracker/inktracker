import { ChevronDown } from "lucide-react";
import { useState } from "react";

export default function AdvancedFilters({ filters, onFilterChange, filterOptions }) {
  const hasActiveFilters = Object.values(filters).some(v => v != null && v !== "");
  const [expanded, setExpanded] = useState(hasActiveFilters);

  return (
    <div className="space-y-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900 transition"
      >
        <ChevronDown className={`w-4 h-4 transition ${expanded ? "rotate-180" : ""}`} />
        Advanced Filters
      </button>

      {expanded && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4">
          {filterOptions.map(option => (
            <div key={option.key}>
              <label className="text-xs font-semibold text-slate-600 uppercase mb-2 block">{option.label}</label>
              {option.type === "select" ? (
                <select
                  value={filters[option.key] || ""}
                  onChange={(e) => onFilterChange(option.key, e.target.value || null)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">All</option>
                  {option.values.map(v => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              ) : option.type === "text" ? (
                <input
                  type="text"
                  placeholder={`Search ${option.label.toLowerCase()}...`}
                  value={filters[option.key] || ""}
                  onChange={(e) => onFilterChange(option.key, e.target.value || null)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              ) : option.type === "checkbox" ? (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={filters[option.key] || false}
                    onChange={(e) => onFilterChange(option.key, e.target.checked ? true : null)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm text-slate-600">{option.label}</span>
                </label>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}