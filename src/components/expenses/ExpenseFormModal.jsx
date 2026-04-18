import React, { useState, useEffect } from "react";
import { base44 } from "@/api/supabaseClient";
import { uploadFile } from "@/lib/uploadFile";
import { Button } from "@/components/ui/button";
import { X, Plus, Trash2, Upload } from "lucide-react";
import { syncExpenseToQB } from "@/lib/qbExpenseSync";

export default function ExpenseFormModal({ expense, onSave, onClose, user }) {
  const [formData, setFormData] = useState({
    payee: "",
    payment_account: "",
    payment_method: "Credit Card",
    payment_date: new Date().toISOString().split("T")[0],
    ref_number: "",
    line_items: [{ id: Date.now().toString(), category_id: "", category_name: "", description: "", amount: 0 }],
    memo: "",
    attachment_url: "",
    total: 0,
  });

  const [taxCategories, setTaxCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isRecurring, setIsRecurring] = useState(expense?.is_recurring || false);
  const [payees, setPayees] = useState(["Local Supplier", "Other", "S&S Activewear"]);
  const [isAddingPayee, setIsAddingPayee] = useState(false);
  const [newPayeeName, setNewPayeeName] = useState("");
  const [paymentAccounts, setPaymentAccounts] = useState(["Bank Account", "Cash", "Credit Card"]);
  const [isAddingAccount, setIsAddingAccount] = useState(false);
  const [newAccountName, setNewAccountName] = useState("");
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");

  useEffect(() => {
    const loadData = async () => {
      const cats = await base44.entities.TaxCategory.filter({ shop_owner: user?.email });
      setTaxCategories([...cats].sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: 'base' })));

      const payeeList = await base44.entities.Payee.filter({ shop_owner: user?.email });
      setPayees(payeeList.map(p => p.name).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })));

      const accountList = await base44.entities.PaymentAccount.filter({ shop_owner: user?.email });
      setPaymentAccounts(accountList.map(a => a.name).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })));
    };
    if (user) loadData();
  }, [user]);

  const handleAddPayee = async () => {
    if (newPayeeName.trim() && !payees.includes(newPayeeName.trim())) {
      await base44.entities.Payee.create({
        shop_owner: user?.email,
        name: newPayeeName.trim(),
      });
      setPayees([...payees, newPayeeName.trim()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })));
      setFormData({ ...formData, payee: newPayeeName.trim() });
      setNewPayeeName("");
      setIsAddingPayee(false);
    }
  };

  const handleAddAccount = async () => {
    if (newAccountName.trim() && !paymentAccounts.includes(newAccountName.trim())) {
      await base44.entities.PaymentAccount.create({
        shop_owner: user?.email,
        name: newAccountName.trim(),
      });
      setPaymentAccounts([...paymentAccounts, newAccountName.trim()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })));
      setFormData({ ...formData, payment_account: newAccountName.trim() });
      setNewAccountName("");
      setIsAddingAccount(false);
    }
  };

  const handleAddCategory = async () => {
    if (newCategoryName.trim()) {
      const newCat = await base44.entities.TaxCategory.create({
        shop_owner: user?.email,
        name: newCategoryName.trim(),
      });
      setTaxCategories([...taxCategories, newCat].sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: 'base' })));
      setNewCategoryName("");
      setIsAddingCategory(false);
    }
  };

  useEffect(() => {
    if (expense) {
      setFormData(expense);
    }
  }, [expense]);

  const handleLineItemChange = (idx, field, value) => {
    const updated = [...formData.line_items];
    if (field === "category_id") {
      const cat = taxCategories.find(c => c.id === value);
      updated[idx] = { ...updated[idx], category_id: value, category_name: cat?.name };
    } else {
      updated[idx] = { ...updated[idx], [field]: value };
    }
    setFormData({ ...formData, line_items: updated });
  };

  const addLineItem = () => {
    setFormData({
      ...formData,
      line_items: [...formData.line_items, { id: Date.now().toString(), category_id: "", category_name: "", description: "", amount: 0 }],
    });
  };

  const removeLineItem = (idx) => {
    const updated = formData.line_items.filter((_, i) => i !== idx);
    setFormData({ ...formData, line_items: updated });
  };

  const calculateTotal = () => {
    return formData.line_items.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    const total = calculateTotal();
    const payload = {
      ...formData,
      shop_owner: user?.email,
      total,
      is_recurring: isRecurring,
      recurring_end_date: isRecurring ? formData.recurring_end_date || null : null,
    };

    try {
      let saved;
      if (expense?.id) {
        saved = await base44.entities.Expense.update(expense.id, payload);
      } else {
        saved = await base44.entities.Expense.create(payload);
      }
      // Fire-and-forget QB sync — don't block save UX on QB availability
      syncExpenseToQB(saved ?? { ...payload, id: expense?.id }).catch((err) => {
        console.warn("[QB] expense sync failed:", err?.message ?? err);
      });
      onSave();
    } catch (error) {
      console.error("Error saving expense:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const { file_url } = await uploadFile(file);
      setFormData({ ...formData, attachment_url: file_url });
    }
  };

  const total = calculateTotal();

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full h-[90vh] max-h-[90vh] overflow-y-auto shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 sticky top-0 bg-white">
          <h2 className="text-lg font-bold text-slate-900">
            {expense ? "Edit Expense" : "New Expense"}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Top Section */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-semibold text-slate-700 block mb-1.5">Payee</label>
              {isAddingPayee ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newPayeeName}
                    onChange={(e) => setNewPayeeName(e.target.value)}
                    placeholder="Enter payee name"
                    className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddPayee();
                      if (e.key === "Escape") setIsAddingPayee(false);
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleAddPayee}
                    className="px-3 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 font-semibold"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsAddingPayee(false)}
                    className="px-3 py-2 bg-slate-100 text-slate-700 text-sm rounded-lg hover:bg-slate-200 font-semibold"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <select
                    value={formData.payee}
                    onChange={(e) => setFormData({ ...formData, payee: e.target.value })}
                    className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2"
                    required
                  >
                    <option value="">Select payee…</option>
                    {payees.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setIsAddingPayee(true)}
                    className="px-3 py-2 bg-slate-100 text-slate-700 text-sm rounded-lg hover:bg-slate-200 font-semibold whitespace-nowrap"
                  >
                    +
                  </button>
                </div>
              )}
            </div>
            <div>
              <label className="text-sm font-semibold text-slate-700 block mb-1.5">Payment Account</label>
              {isAddingAccount ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newAccountName}
                    onChange={(e) => setNewAccountName(e.target.value)}
                    placeholder="Enter account name"
                    className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddAccount();
                      if (e.key === "Escape") setIsAddingAccount(false);
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleAddAccount}
                    className="px-3 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 font-semibold"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsAddingAccount(false)}
                    className="px-3 py-2 bg-slate-100 text-slate-700 text-sm rounded-lg hover:bg-slate-200 font-semibold"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <select
                    value={formData.payment_account}
                    onChange={(e) => setFormData({ ...formData, payment_account: e.target.value })}
                    className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2"
                  >
                    <option value="">Select account…</option>
                    {paymentAccounts.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setIsAddingAccount(true)}
                    className="px-3 py-2 bg-slate-100 text-slate-700 text-sm rounded-lg hover:bg-slate-200 font-semibold whitespace-nowrap"
                  >
                    +
                  </button>
                </div>
              )}
            </div>
            <div>
              <label className="text-sm font-semibold text-slate-700 block mb-1.5">Payment Date</label>
              <input
                type="date"
                value={formData.payment_date}
                onChange={(e) => setFormData({ ...formData, payment_date: e.target.value })}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2"
                required
              />
            </div>
            <div>
              <label className="text-sm font-semibold text-slate-700 block mb-1.5">Payment Method</label>
              <select
                value={formData.payment_method}
                onChange={(e) => setFormData({ ...formData, payment_method: e.target.value })}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2"
              >
                <option value="Credit Card">Credit Card</option>
                <option value="Bank Transfer">Bank Transfer</option>
                <option value="Check">Check</option>
                <option value="Cash">Cash</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-semibold text-slate-700 block mb-1.5">Ref no.</label>
              <input
                type="text"
                value={formData.ref_number}
                onChange={(e) => setFormData({ ...formData, ref_number: e.target.value })}
                placeholder="Reference number"
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2"
              />
            </div>
          </div>

          {/* Line Items */}
          <div className="border-t border-slate-200 pt-6">
            <h3 className="text-sm font-semibold text-slate-700 mb-4">Line Items</h3>
            <style>{`
              input[type="number"]::-webkit-outer-spin-button,
              input[type="number"]::-webkit-inner-spin-button {
                -webkit-appearance: none;
                margin: 0;
              }
              input[type="number"] {
                -moz-appearance: textfield;
              }
            `}</style>
            <div className="space-y-3">
              <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-slate-600 uppercase mb-2">
                <div className="col-span-3">Category</div>
                <div className="col-span-6">Description</div>
                <div className="col-span-2">Amount</div>
                <div className="col-span-1"></div>
              </div>
              {formData.line_items.map((item, idx) => (
                <div key={item.id} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-3">
                    {isAddingCategory ? (
                      <div className="flex gap-1">
                        <input
                          type="text"
                          value={newCategoryName}
                          onChange={(e) => setNewCategoryName(e.target.value)}
                          placeholder="Category name"
                          className="flex-1 text-sm border border-slate-200 rounded px-2 py-1.5"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleAddCategory();
                            if (e.key === "Escape") setIsAddingCategory(false);
                          }}
                        />
                        <button
                          type="button"
                          onClick={handleAddCategory}
                          className="px-2 py-1.5 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700 font-semibold"
                        >
                          Add
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-1">
                        <select
                          value={item.category_id}
                          onChange={(e) => handleLineItemChange(idx, "category_id", e.target.value)}
                          className="flex-1 text-sm border border-slate-200 rounded px-2 py-1.5"
                        >
                          <option value="">Select…</option>
                          {taxCategories.map(cat => (
                            <option key={cat.id} value={cat.id}>{cat.name}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => setIsAddingCategory(true)}
                          className="px-2 py-1.5 bg-slate-100 text-slate-700 text-xs rounded hover:bg-slate-200 font-semibold whitespace-nowrap"
                        >
                          +
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="col-span-6">
                    <input
                      type="text"
                      value={item.description}
                      onChange={(e) => handleLineItemChange(idx, "description", e.target.value)}
                      placeholder="Description"
                      className="w-full text-sm border border-slate-200 rounded px-2 py-1.5"
                    />
                  </div>
                  <div className="col-span-2">
                    <div className="relative">
                      <span className="absolute left-2 top-1.5 text-sm text-slate-600">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={item.amount || ""}
                        onChange={(e) => handleLineItemChange(idx, "amount", parseFloat(e.target.value) || 0)}
                        placeholder="0.00"
                        className="w-full text-sm border border-slate-200 rounded px-6 py-1.5 text-right pr-6 relative bg-white"
                      />
                    </div>
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <button
                      type="button"
                      onClick={() => removeLineItem(idx)}
                      className="text-slate-400 hover:text-red-600"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addLineItem}
              className="mt-3 text-sm text-indigo-600 hover:text-indigo-700 font-semibold flex items-center gap-1"
            >
              <Plus className="w-4 h-4" /> Add lines
            </button>
            <div className="mt-4 text-right font-semibold text-slate-900">
              Total: ${total.toFixed(2)}
            </div>
          </div>

          {/* Recurring Payment */}
          <div className="border-t border-slate-200 pt-6">
            <div className="flex items-center gap-3 mb-4">
              <button
                type="button"
                onClick={() => setIsRecurring(!isRecurring)}
                className={`px-4 py-2 rounded-lg font-semibold text-sm transition ${
                  isRecurring
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {isRecurring ? "✓ Recurring" : "Make Recurring"}
              </button>
            </div>
            {isRecurring && (
              <div>
                <label className="text-sm font-semibold text-slate-700 block mb-1.5">Recurring End Date (Optional)</label>
                <input
                  type="date"
                  value={formData.recurring_end_date || ""}
                  onChange={(e) => setFormData({ ...formData, recurring_end_date: e.target.value })}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2"
                />
              </div>
            )}
          </div>

          {/* Memo */}
          <div>
            <label className="text-sm font-semibold text-slate-700 block mb-1.5">Memo</label>
            <textarea
              value={formData.memo}
              onChange={(e) => setFormData({ ...formData, memo: e.target.value })}
              placeholder="Add memo notes…"
              rows={4}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2"
            />
          </div>

          {/* Attachments */}
          <div className="border-t border-slate-200 pt-6">
            <label className="text-sm font-semibold text-slate-700 block mb-3">Attachments</label>
            <div className="border-2 border-dashed border-slate-200 rounded-lg p-8 text-center">
              {formData.attachment_url ? (
                <div className="text-sm text-slate-600">
                  ✓ File attached
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, attachment_url: "" })}
                    className="ml-2 text-indigo-600 hover:text-indigo-700"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <label className="cursor-pointer">
                  <Upload className="w-6 h-6 text-slate-400 mx-auto mb-2" />
                  <div className="text-sm text-slate-600">
                    <span className="text-indigo-600 font-semibold">Add attachment</span>
                  </div>
                  <div className="text-xs text-slate-400 mt-1">Max file size: 20 MB</div>
                  <input
                    type="file"
                    onChange={handleFileUpload}
                    className="hidden"
                    accept="image/*,.pdf,.doc,.docx"
                  />
                </label>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 border-t border-slate-200 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
              disabled={loading}
            >
              {loading ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}