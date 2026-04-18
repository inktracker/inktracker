import { useState, useEffect } from "react";
import { X } from "lucide-react";

export default function ExpenseModal({ expense, orders, onSave, onClose, user }) {
  const [formData, setFormData] = useState({
    expense_id: "",
    amount: "",
    vendor: "",
    category: "Other",
    date: new Date().toISOString().split("T")[0],
    notes: "",
    status: "Paid",
    linked_order_id: "",
    shop_owner: user?.email || "",
    is_recurring: false,
    recurring_end_date: "",
  });

  const [linkedOrder, setLinkedOrder] = useState(null);

  useEffect(() => {
    if (expense) {
      setFormData({
        expense_id: expense.expense_id || "",
        amount: expense.amount || "",
        vendor: expense.vendor || "",
        category: expense.category || "Other",
        date: expense.date || new Date().toISOString().split("T")[0],
        notes: expense.notes || "",
        status: "Paid",
        linked_order_id: expense.linked_order_id || "",
        shop_owner: expense.shop_owner || "",
        is_recurring: expense.is_recurring || false,
        recurring_end_date: expense.recurring_end_date || "",
      });
      if (expense.linked_order_id) {
        const order = orders.find(o => o.id === expense.linked_order_id);
        setLinkedOrder(order);
      }
    }
  }, [expense, orders]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const handleSelectOrder = (orderId) => {
    const order = orders.find(o => o.id === orderId);
    setFormData({ ...formData, linked_order_id: orderId });
    setLinkedOrder(order);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!formData.amount || !formData.vendor || !formData.date) {
      alert("Please fill in required fields: amount, vendor, date");
      return;
    }

    // Generate expense ID if new
    const expenseId = formData.expense_id || `EXP-${Date.now()}`;
    
    const dataToSave = {
      ...formData,
      expense_id: expenseId,
      amount: parseFloat(formData.amount),
      linked_order_number: linkedOrder?.order_id || "",
      recurring_end_date: formData.recurring_end_date || null,
    };

    onSave(dataToSave);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 sticky top-0 bg-white">
          <h2 className="text-xl font-bold text-slate-900">{expense ? "Edit Expense" : "Add Expense"}</h2>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg transition">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-semibold text-slate-700 mb-1.5 block">Expense ID</label>
              <input
                type="text"
                name="expense_id"
                value={formData.expense_id}
                onChange={handleChange}
                placeholder="Auto-generated if empty"
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                disabled={!!expense}
              />
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-700 mb-1.5 block">Amount *</label>
              <input
                type="number"
                name="amount"
                step="0.01"
                value={formData.amount}
                onChange={handleChange}
                placeholder="0.00"
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                required
              />
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-700 mb-1.5 block">Vendor *</label>
              <input
                type="text"
                name="vendor"
                value={formData.vendor}
                onChange={handleChange}
                placeholder="Vendor name"
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                required
              />
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-700 mb-1.5 block">Date *</label>
              <input
                type="date"
                name="date"
                value={formData.date}
                onChange={handleChange}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                required
              />
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-700 mb-1.5 block">Category</label>
              <select
                name="category"
                value={formData.category}
                onChange={handleChange}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              >
                <option value="Cost of Goods">Cost of Goods</option>
                <option value="Other">Other</option>
                <option value="Printing">Printing</option>
                <option value="Shipping">Shipping</option>
                <option value="Software">Software</option>
                <option value="Supplies">Supplies</option>
                <option value="Travel">Travel</option>
                <option value="Utilities">Utilities</option>
              </select>
            </div>


          </div>

          <div>
            <label className="text-sm font-semibold text-slate-700 mb-1.5 block">Link Order</label>
            <select
              value={formData.linked_order_id}
              onChange={(e) => handleSelectOrder(e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              <option value="">No linked order</option>
              {orders.map(order => (
                <option key={order.id} value={order.id}>
                  {order.order_id} — {order.customer_name} ({order.status})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-semibold text-slate-700 mb-1.5 block">Notes</label>
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              placeholder="Additional details…"
              rows="3"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
            />
          </div>

          <div className="border-t border-slate-200 pt-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                name="is_recurring"
                checked={formData.is_recurring}
                onChange={(e) => setFormData({ ...formData, is_recurring: e.target.checked })}
                className="w-4 h-4 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
              <span className="text-sm font-semibold text-slate-700">Recurring monthly</span>
            </label>
            
            {formData.is_recurring && (
              <div className="mt-3 pl-7">
                <label className="text-sm font-semibold text-slate-700 mb-1.5 block">End date (optional)</label>
                <input
                  type="date"
                  name="recurring_end_date"
                  value={formData.recurring_end_date}
                  onChange={handleChange}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
                <p className="text-xs text-slate-400 mt-1">Leave blank for indefinite recurrence</p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 font-semibold hover:bg-slate-50 transition text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700 transition text-sm"
            >
              {expense ? "Update" : "Create"} Expense
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}