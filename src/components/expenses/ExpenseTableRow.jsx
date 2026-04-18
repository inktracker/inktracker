import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { FileText, Trash2, X, Check, Eye, Edit2 } from "lucide-react";
import { fmtMoney, fmtDate } from "@/components/shared/pricing";

const CATEGORY_OPTIONS = ["Cost of Goods", "Other", "Printing", "Shipping", "Software", "Supplies", "Travel", "Utilities"];

export default function ExpenseTableRow({ expense, onUpdate, onDelete, onSelect, selected, onView, onEdit }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState(expense);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    await onUpdate(editData);
    setIsEditing(false);
    setIsSaving(false);
  };

  const handleCancel = () => {
    setEditData(expense);
    setIsEditing(false);
  };

  return (
    <tr className="border-b border-slate-200 hover:bg-slate-50 transition">
      <td className="px-4 py-3">
        <Checkbox checked={selected} onCheckedChange={onSelect} />
      </td>
      {isEditing ? (
        <>
          <td className="px-4 py-3">
            <Input
              type="date"
              value={editData.date}
              onChange={(e) => setEditData({ ...editData, date: e.target.value })}
              className="w-full max-w-xs"
            />
          </td>
          <td className="px-4 py-3">
            <Input
              value={editData.vendor}
              onChange={(e) => setEditData({ ...editData, vendor: e.target.value })}
              placeholder="Vendor"
              className="w-full"
            />
          </td>
          <td className="px-4 py-3">
            <Select value={editData.category} onValueChange={(val) => setEditData({ ...editData, category: val })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_OPTIONS.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
              </SelectContent>
            </Select>
          </td>
          <td className="px-4 py-3">
            <Input
              type="number"
              step="0.01"
              value={editData.amount}
              onChange={(e) => setEditData({ ...editData, amount: parseFloat(e.target.value) })}
              className="w-full max-w-xs"
            />
          </td>
          <td className="px-4 py-3">
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={handleSave} disabled={isSaving} className="text-green-600 hover:text-green-700">
                <Check className="w-4 h-4" />
              </Button>
              <Button size="sm" variant="ghost" onClick={handleCancel} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </Button>
            </div>
          </td>
        </>
      ) : (
        <>
           <td className="px-4 py-3 text-sm text-slate-900 cursor-pointer" onClick={() => onView(expense)}>
             {fmtDate(expense.payment_date)}
           </td>
           <td className="px-4 py-3 text-sm text-slate-900 cursor-pointer" onClick={() => onView(expense)}>
             {expense.payee}
           </td>
           <td className="px-4 py-3 text-sm cursor-pointer" onClick={() => onView(expense)}>
             <span className="text-xs px-2 py-1 rounded bg-slate-100 text-slate-700">
               {expense.line_items?.[0]?.category_name || "—"}
             </span>
           </td>
           <td className="px-4 py-3 text-sm font-semibold text-slate-900 cursor-pointer" onClick={() => onView(expense)}>
             <div className="flex items-center gap-2">
               {fmtMoney(expense.total)}
               {expense.qb_expense_id && (
                 <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#2CA01C]/10 text-[#2CA01C] uppercase tracking-wide">QB</span>
               )}
             </div>
           </td>
           <td className="px-4 py-3">
             <div className="flex gap-2">
               <Button size="sm" variant="ghost" onClick={() => onEdit(expense)} className="text-indigo-600 hover:text-indigo-700">
                 <Edit2 className="w-4 h-4" />
               </Button>
               <Button size="sm" variant="ghost" onClick={() => onView(expense)} className="text-indigo-600 hover:text-indigo-700">
                 <Eye className="w-4 h-4" />
               </Button>
               {expense.receipt_url && (
                 <a href={expense.receipt_url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:text-indigo-700">
                   <FileText className="w-4 h-4" />
                 </a>
               )}
               <Button size="sm" variant="ghost" onClick={() => onDelete(expense.id)} className="text-red-600 hover:text-red-700">
                 <Trash2 className="w-4 h-4" />
               </Button>
             </div>
           </td>
        </>
      )}
    </tr>
  );
}