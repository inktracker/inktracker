import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";

const CATEGORY_OPTIONS = ["Cost of Goods", "Other", "Printing", "Shipping", "Software", "Supplies", "Travel", "Utilities"];

export default function ExpenseQuickAdd({ onAdd, shopOwner }) {
  const [isOpen, setIsOpen] = useState(false);
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split("T")[0],
    vendor: "",
    category: "Other",
    amount: "",
  });
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!formData.vendor || !formData.amount) return;
    setIsSaving(true);
    await onAdd({
      ...formData,
      shop_owner: shopOwner,
      amount: parseFloat(formData.amount),
      status: "Unreimbursed",
    });
    setFormData({
      date: new Date().toISOString().split("T")[0],
      vendor: "",
      category: "Other",
      amount: "",
    });
    setIsOpen(false);
    setIsSaving(false);
  };

  if (!isOpen) {
    return (
      <Button onClick={() => setIsOpen(true)} className="gap-2">
        <Plus className="w-4 h-4" />
        New Expense
      </Button>
    );
  }

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4">
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <Input
          type="date"
          value={formData.date}
          onChange={(e) => setFormData({ ...formData, date: e.target.value })}
        />
        <Input
          placeholder="Vendor"
          value={formData.vendor}
          onChange={(e) => setFormData({ ...formData, vendor: e.target.value })}
        />
        <Select value={formData.category} onValueChange={(val) => setFormData({ ...formData, category: val })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORY_OPTIONS.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input
          type="number"
          placeholder="Amount"
          step="0.01"
          value={formData.amount}
          onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
        />
        <Button onClick={handleSave} disabled={isSaving} className="lg:col-span-2">
          {isSaving ? "Adding..." : "Add Expense"}
        </Button>
        <Button variant="outline" onClick={() => setIsOpen(false)} className="lg:col-span-2">
          Cancel
        </Button>
      </div>
    </div>
  );
}