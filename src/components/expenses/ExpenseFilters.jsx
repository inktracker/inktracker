import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { getDateRangeValues } from "@/lib/dateRangeUtils";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";

export default function ExpenseFilters({ onFilterChange }) {
  const [expanded, setExpanded] = useState(false);
  const [filters, setFilters] = useState(() => ({
    search: "",
    category: "all",
    dateRange: "thisMonth",
    ...getDateRangeValues("thisMonth"),
  }));

  useEffect(() => {
    onFilterChange(filters);
     
  }, []);

  const handleDateRangeChange = (range) => {
    const dateValues = getDateRangeValues(range);
    const updated = { ...filters, dateRange: range, ...dateValues };
    setFilters(updated);
    onFilterChange(updated);
  };

  const handleChange = (key, value) => {
    const updated = { ...filters, [key]: value };
    setFilters(updated);
    onFilterChange(updated);
  };

  const activeFilters = Object.values(filters).filter(v => v && v !== "all").length;

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition"
      >
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-700">Filters</span>
          {activeFilters > 0 && (
            <span className="text-xs font-bold bg-indigo-600 text-white px-2 py-0.5 rounded-full">{activeFilters}</span>
          )}
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>

      {expanded && (
        <div className="border-t border-slate-200 px-5 py-4 bg-slate-50">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-widest mb-1.5 block">Search</label>
              <input
                type="text"
                placeholder="Vendor…"
                value={filters.search}
                onChange={(e) => handleChange("search", e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-widest mb-1.5 block">Category</label>
              <select
                value={filters.category}
                onChange={(e) => handleChange("category", e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              >
                <option value="all">All Categories</option>
                <option value="Cost of Goods">Cost of Goods</option>
                <option value="Other">Other</option>
                <option value="Printing">Printing</option>
                <option value="Shipping">Shipping</option>
                <option value="Software">Software</option>
                <option value="Supplies">Supplies</option>
                <option value="Travel">Travel</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-widest mb-1.5 block">Date</label>
              <Select value={filters.dateRange} onValueChange={handleDateRangeChange}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Time</SelectItem>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="yesterday">Yesterday</SelectItem>
                  <SelectItem value="thisWeek">This Week</SelectItem>
                  <SelectItem value="lastWeek">Last Week</SelectItem>
                  <SelectItem value="thisMonth">This Month</SelectItem>
                  <SelectItem value="lastMonth">Last Month</SelectItem>
                  <SelectItem value="last3Months">Last 3 Months</SelectItem>
                  <SelectItem value="last6Months">Last 6 Months</SelectItem>
                  <SelectItem value="last12Months">Last 12 Months</SelectItem>
                  <SelectItem value="lastYear">Last Year</SelectItem>
                  <SelectItem value="thisYear">This Year</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-widest mb-1.5 block">Custom Date Range</label>
              <div className="flex gap-2 text-xs">
                <input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(e) => handleChange("dateFrom", e.target.value)}
                  className="flex-1 border border-slate-200 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
                <input
                  type="date"
                  value={filters.dateTo}
                  onChange={(e) => handleChange("dateTo", e.target.value)}
                  className="flex-1 border border-slate-200 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
              </div>
            </div>
          </div>

          {activeFilters > 0 && (
            <button
              onClick={() => {
                const cleared = {
                    search: "",
                    category: "all",
                    dateRange: "all",
                    dateFrom: "",
                    dateTo: "",
                  };
                setFilters(cleared);
                onFilterChange(cleared);
              }}
              className="mt-4 text-xs font-semibold text-indigo-600 hover:text-indigo-700"
            >
              Clear all filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}