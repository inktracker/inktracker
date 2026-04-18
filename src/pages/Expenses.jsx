import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/supabaseClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Download, RefreshCw, DownloadCloud } from "lucide-react";
import { fmtMoney } from "@/components/shared/pricing";
import ExpenseTableRow from "@/components/expenses/ExpenseTableRow";
import ExpenseFormModal from "@/components/expenses/ExpenseFormModal";
import ExpenseDetailModal from "@/components/expenses/ExpenseDetailModal";
import ExpenseFilters from "@/components/expenses/ExpenseFilters";
import { syncExpensesBatch, pullExpensesFromQB } from "@/lib/qbExpenseSync";

export default function ExpensesPage() {
  const [user, setUser] = useState(null);
  const [orders, setOrders] = useState([]);
  const [filters, setFilters] = useState({ search: "", vendor: "", status: "all", category: "all", dateFrom: "", dateTo: "" });
  const [selected, setSelected] = useState(new Set());
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [viewingExpense, setViewingExpense] = useState(null);
  const [qbBulk, setQbBulk] = useState(null); // { done, total, ok, failed }
  const [qbPull, setQbPull] = useState(null);  // { imported, skipped, total } | "running"
  const queryClient = useQueryClient();

  useEffect(() => {
    async function loadData() {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      const allOrders = await base44.entities.Order.list();
      setOrders(allOrders);
      // Background pull — import expenses created directly in QB
      try {
        setQbPull("running");
        const result = await pullExpensesFromQB();
        setQbPull(result);
        if (result?.imported > 0) {
          queryClient.invalidateQueries({ queryKey: ["expenses"] });
        }
        setTimeout(() => setQbPull(null), 5000);
      } catch (err) {
        console.warn("[QB pull] failed:", err?.message ?? err);
        setQbPull(null);
      }
    }
    loadData();
  }, []);

  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ["expenses"],
    queryFn: () => base44.entities.Expense.filter({ shop_owner: user?.email }),
    enabled: !!user,
  });

  const filteredExpenses = useMemo(() => {
    if (!filters) return expenses;
    return expenses.filter(e => {
      if (filters.search && !e.payee?.toLowerCase().includes(filters.search.toLowerCase())) return false;
      if (filters.dateFrom && e.payment_date < filters.dateFrom) return false;
      if (filters.dateTo && e.payment_date > filters.dateTo) return false;
      return true;
    });
  }, [expenses, filters]);

  const updateMutation = useMutation({
    mutationFn: (data) => base44.entities.Expense.update(data.id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["expenses"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Expense.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      setSelected(new Set());
    },
  });

  const addMutation = useMutation({
    mutationFn: (data) => base44.entities.Expense.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["expenses"] }),
  });



  const handleBulkDelete = async () => {
    if (confirm(`Delete ${selected.size} expense(s)?`)) {
      for (const id of selected) {
        await deleteMutation.mutateAsync(id);
      }
    }
  };

  const unsyncedCount = filteredExpenses.filter(e => !e.qb_expense_id).length;

  const handlePullQB = async () => {
    setQbPull("running");
    try {
      const result = await pullExpensesFromQB();
      setQbPull(result);
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
    } catch (err) {
      setQbPull({ error: err?.message ?? "Pull failed" });
    } finally {
      setTimeout(() => setQbPull(null), 5000);
    }
  };

  const handleBulkSyncQB = async () => {
    const unsynced = expenses.filter(e => !e.qb_expense_id);
    if (unsynced.length === 0) return;
    setQbBulk({ done: 0, total: unsynced.length, ok: 0, failed: 0 });
    try {
      const result = await syncExpensesBatch(unsynced, setQbBulk);
      setQbBulk({ done: unsynced.length, total: unsynced.length, ...result });
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
    } finally {
      setTimeout(() => setQbBulk(null), 4000);
    }
  };

  const handleExport = () => {
    const csv = [
      ["Date", "Payee", "Category", "Total"],
      ...filteredExpenses.map(e => [e.payment_date, e.payee, e.line_items?.[0]?.category_name || "—", e.total]),
    ].map(row => row.join(",")).join("\n");
    
    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "expenses.csv";
    a.click();
  };

  if (isLoading) return <div className="text-center py-8">Loading...</div>;
  if (!user) return null;

  const totalSelected = filteredExpenses.filter(e => selected.has(e.id)).reduce((sum, e) => sum + (e.total || 0), 0);
  const totalExpenses = filteredExpenses.reduce((sum, e) => sum + (e.total || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-slate-900">Expenses</h1>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handlePullQB}
            disabled={qbPull === "running"}
            className="gap-2 border-[#2CA01C] text-[#2CA01C] hover:bg-[#2CA01C]/5"
          >
            <DownloadCloud className={`w-4 h-4 ${qbPull === "running" ? "animate-pulse" : ""}`} />
            {qbPull === "running" ? "Pulling…" : "Pull from QB"}
          </Button>
          <Button
            variant="outline"
            onClick={handleBulkSyncQB}
            disabled={unsyncedCount === 0 || !!qbBulk}
            className="gap-2 border-[#2CA01C] text-[#2CA01C] hover:bg-[#2CA01C]/5"
          >
            <RefreshCw className={`w-4 h-4 ${qbBulk ? "animate-spin" : ""}`} />
            {qbBulk
              ? `Syncing ${qbBulk.done}/${qbBulk.total}…`
              : unsyncedCount > 0
                ? `Sync ${unsyncedCount} to QB`
                : "All synced to QB"}
          </Button>
          <Button variant="outline" onClick={handleExport} className="gap-2">
            <Download className="w-4 h-4" />
            Export
          </Button>
        </div>
      </div>
      {qbBulk && qbBulk.done === qbBulk.total && (
        <div className="text-sm text-slate-600">
          QB push complete: {qbBulk.ok} succeeded, {qbBulk.failed} failed.
        </div>
      )}
      {qbPull && qbPull !== "running" && !qbPull.error && qbPull.imported > 0 && (
        <div className="text-sm text-slate-600">
          Pulled {qbPull.imported} new expense{qbPull.imported === 1 ? "" : "s"} from QuickBooks.
        </div>
      )}
      {qbPull?.error && (
        <div className="text-sm text-red-600">QB pull failed: {qbPull.error}</div>
      )}

      <div className="flex gap-3">
        <Button onClick={() => { setEditingExpense(null); setShowFormModal(true); }} className="bg-indigo-600 hover:bg-indigo-700">
          + New Expense
        </Button>
      </div>

      <ExpenseFilters onFilterChange={setFilters} />

      {selected.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex justify-between items-center">
          <div className="text-sm text-blue-900">
            <strong>{selected.size}</strong> expense(s) selected • <strong>{fmtMoney(totalSelected)}</strong>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" onClick={handleBulkDelete}>
              Delete
            </Button>
            <Button size="sm" variant="outline" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left">
                <Checkbox
                  checked={selected.size === filteredExpenses.length && filteredExpenses.length > 0}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      setSelected(new Set(filteredExpenses.map(e => e.id)));
                    } else {
                      setSelected(new Set());
                    }
                  }}
                />
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">Date</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">Vendor</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">Category</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">Amount</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredExpenses.length === 0 ? (
              <tr>
                 <td colSpan="6" className="px-4 py-8 text-center text-slate-500">
                   No expenses found
                 </td>
               </tr>
            ) : (
              filteredExpenses.map(expense => (
                <ExpenseTableRow
                   key={expense.id}
                   expense={expense}
                   onUpdate={(data) => updateMutation.mutate(data)}
                   onDelete={(id) => deleteMutation.mutate(id)}
                   onView={setViewingExpense}
                   onEdit={(exp) => { setEditingExpense(exp); setShowFormModal(true); }}
                   onSelect={() => {
                     const newSelected = new Set(selected);
                     if (newSelected.has(expense.id)) {
                       newSelected.delete(expense.id);
                     } else {
                       newSelected.add(expense.id);
                     }
                     setSelected(newSelected);
                   }}
                   selected={selected.has(expense.id)}
                 />
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
        <div className="flex justify-between items-center">
          <span className="text-sm font-semibold text-slate-700">Total Expenses</span>
          <span className="text-2xl font-bold text-slate-900">{fmtMoney(totalExpenses)}</span>
        </div>
      </div>

      {showFormModal && (
        <ExpenseFormModal
          expense={editingExpense}
          onSave={() => {
            queryClient.invalidateQueries({ queryKey: ["expenses"] });
            setShowFormModal(false);
            setEditingExpense(null);
          }}
          onClose={() => {
            setShowFormModal(false);
            setEditingExpense(null);
          }}
          user={user}
        />
      )}

      {viewingExpense && (
        <ExpenseDetailModal
          expense={viewingExpense}
          onClose={() => setViewingExpense(null)}
          onEdit={(exp) => { setEditingExpense(exp); setShowFormModal(true); }}
        />
      )}
    </div>
  );
}