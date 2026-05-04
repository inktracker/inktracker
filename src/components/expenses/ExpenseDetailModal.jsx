import React from "react";
import { X, Download, Edit2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmtMoney } from "@/components/shared/pricing";
// jspdf loaded on demand inside handleDownloadPDF below

export default function ExpenseDetailModal({ expense, onClose, onEdit }) {
  const formatDate = (dateStr) => {
    if (!dateStr) return "—";
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  };

  const handleDownloadPDF = async () => {
    if (!expense) return;

    const { default: jsPDF } = await import("jspdf");
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 15;
    let yPos = margin;

    // Header
    doc.setFontSize(24);
    doc.setFont(undefined, "bold");
    doc.setTextColor(30, 30, 40);
    doc.text("EXPENSE", pageWidth - margin, yPos, { align: "right" });

    doc.setFontSize(8);
    doc.setFont(undefined, "normal");
    doc.setTextColor(100, 100, 120);
    doc.text(`ID: ${expense.expense_id || expense.id}`, pageWidth - margin, yPos + 6, { align: "right" });
    yPos += 18;

    // Payee Info
    doc.setFontSize(13);
    doc.setFont(undefined, "bold");
    doc.setTextColor(30, 30, 40);
    doc.text(expense.payee || "—", margin, yPos);
    yPos += 6;

    // Key Details
    doc.setFontSize(9);
    doc.setFont(undefined, "normal");
    doc.setTextColor(100, 100, 120);
    const details = [
      `Payment Date: ${formatDate(expense.payment_date)}`,
      `Payment Method: ${expense.payment_method || "—"}`,
      expense.payment_account ? `Payment Account: ${expense.payment_account}` : null,
      expense.ref_number ? `Reference: ${expense.ref_number}` : null,
    ].filter(Boolean);

    details.forEach((detail) => {
      doc.text(detail, margin, yPos);
      yPos += 5;
    });

    yPos += 5;

    // Line Items
    if (expense.line_items && expense.line_items.length > 0) {
      doc.setFontSize(10);
      doc.setFont(undefined, "bold");
      doc.setTextColor(30, 30, 40);
      doc.text("Line Items", margin, yPos);
      yPos += 7;

      doc.setFontSize(8);
      doc.setFont(undefined, "bold");
      doc.setTextColor(80, 80, 100);
      doc.text("Category", margin, yPos);
      doc.text("Description", margin + 40, yPos);
      doc.text("Amount", pageWidth - margin - 20, yPos, { align: "right" });
      yPos += 5;

      doc.setDrawColor(200, 200, 210);
      doc.line(margin, yPos - 1, pageWidth - margin, yPos - 1);
      yPos += 3;

      doc.setFont(undefined, "normal");
      doc.setTextColor(30, 30, 40);

      expense.line_items.forEach((item) => {
        const categoryText = item.category_name || "—";
        const descText = item.description || "—";

        doc.text(categoryText, margin, yPos);
        doc.text(descText, margin + 40, yPos);
        doc.text(fmtMoney(item.amount || 0), pageWidth - margin - 20, yPos, { align: "right" });
        yPos += 5;

        if (yPos > 250) {
          doc.addPage();
          yPos = margin;
        }
      });

      yPos += 3;
      doc.setDrawColor(200, 200, 210);
      doc.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 5;

      // Total
      doc.setFontSize(12);
      doc.setFont(undefined, "bold");
      doc.setTextColor(67, 56, 202);
      doc.text("Total:", margin, yPos);
      doc.text(fmtMoney(expense.total || 0), pageWidth - margin - 2, yPos, { align: "right" });
      yPos += 8;
    }

    // Memo
    if (expense.memo) {
      doc.setFontSize(9);
      doc.setFont(undefined, "bold");
      doc.setTextColor(30, 30, 40);
      doc.text("Memo", margin, yPos);
      yPos += 4;

      doc.setFont(undefined, "normal");
      doc.setTextColor(80, 80, 100);
      doc.setFontSize(8);
      const memoLines = doc.splitTextToSize(expense.memo, pageWidth - 2 * margin - 4);
      doc.text(memoLines, margin, yPos);
      yPos += memoLines.length * 4 + 8;
    }

    // Attachment Image
    if (expense.attachment_url) {
      try {
        if (yPos > 240) {
          doc.addPage();
          yPos = margin;
        }

        doc.setFontSize(10);
        doc.setFont(undefined, "bold");
        doc.setTextColor(30, 30, 40);
        doc.text("Receipt / Attachment", margin, yPos);
        yPos += 8;

        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = expense.attachment_url;
        });

        const imgWidth = pageWidth - 2 * margin;
        const imgHeight = (img.height / img.width) * imgWidth;
        
        if (yPos + imgHeight > 270) {
          doc.addPage();
          yPos = margin;
        }

        doc.addImage(expense.attachment_url, "JPEG", margin, yPos, imgWidth, imgHeight);
      } catch (error) {
        // Attachment image could not be loaded — skip it in the PDF
      }
    }

    doc.save(`Expense-${expense.expense_id || expense.id}.pdf`);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 sticky top-0 bg-white">
          <h2 className="text-lg font-bold text-slate-900">Expense Details</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Payee & Basic Info */}
          <div>
            <h3 className="text-sm font-semibold text-slate-600 uppercase mb-3">Payee</h3>
            <p className="text-lg font-semibold text-slate-900">{expense.payee || "—"}</p>
            {expense.payment_account && (
              <p className="text-sm text-slate-600 mt-1">{expense.payment_account}</p>
            )}
          </div>

          {/* Key Details Grid */}
          <div className="grid grid-cols-2 gap-4 border-t border-slate-200 pt-4">
            <div>
              <span className="text-xs font-semibold text-slate-600 uppercase">Payment Date</span>
              <p className="text-sm font-medium text-slate-900 mt-1">{formatDate(expense.payment_date)}</p>
            </div>
            <div>
              <span className="text-xs font-semibold text-slate-600 uppercase">Payment Method</span>
              <p className="text-sm font-medium text-slate-900 mt-1">{expense.payment_method || "—"}</p>
            </div>
            {expense.ref_number && (
              <div>
                <span className="text-xs font-semibold text-slate-600 uppercase">Reference</span>
                <p className="text-sm font-medium text-slate-900 mt-1">{expense.ref_number}</p>
              </div>
            )}
          </div>

          {/* Line Items */}
          {expense.line_items && expense.line_items.length > 0 && (
            <div className="border-t border-slate-200 pt-4">
              <h3 className="text-sm font-semibold text-slate-600 uppercase mb-4">Line Items</h3>
              <div className="space-y-2">
                {expense.line_items.map((item, idx) => (
                  <div key={item.id || idx} className="flex justify-between items-start p-3 bg-slate-50 rounded">
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-slate-900">{item.category_name || "—"}</p>
                      {item.description && (
                        <p className="text-xs text-slate-600 mt-1">{item.description}</p>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-slate-900 ml-4">{fmtMoney(item.amount || 0)}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex justify-between items-center p-4 bg-indigo-50 rounded-lg border border-indigo-200">
                <span className="font-semibold text-slate-900">Total</span>
                <span className="text-2xl font-bold text-indigo-600">{fmtMoney(expense.total || 0)}</span>
              </div>
            </div>
          )}

          {/* Memo */}
          {expense.memo && (
            <div className="border-t border-slate-200 pt-4">
              <h3 className="text-sm font-semibold text-slate-600 uppercase mb-2">Memo</h3>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{expense.memo}</p>
            </div>
          )}

          {/* Attachment */}
          {expense.attachment_url && (
            <div className="border-t border-slate-200 pt-4">
              <h3 className="text-sm font-semibold text-slate-600 uppercase mb-3">Attachment</h3>
              <div className="bg-slate-50 rounded-lg overflow-hidden border border-slate-200">
                <img
                  src={expense.attachment_url}
                  alt="Expense attachment"
                  className="w-full h-auto max-h-96 object-contain"
                />
              </div>
              <a
                href={expense.attachment_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-indigo-600 hover:text-indigo-700 underline mt-2 inline-block"
              >
                Open in new tab
              </a>
            </div>
          )}

          {/* Recurring */}
          {expense.is_recurring && (
            <div className="border-t border-slate-200 pt-4">
              <h3 className="text-sm font-semibold text-slate-600 uppercase mb-2">Recurring</h3>
              <p className="text-sm text-slate-700">
                This is a recurring expense
                {expense.recurring_end_date ? ` until ${formatDate(expense.recurring_end_date)}` : ""}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-slate-200 p-4">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {onEdit && (
            <Button onClick={() => { onEdit(expense); onClose(); }} className="bg-indigo-600 hover:bg-indigo-700 gap-2">
              <Edit2 className="w-4 h-4" />
              Edit
            </Button>
          )}
          <Button onClick={handleDownloadPDF} className="bg-indigo-600 hover:bg-indigo-700 gap-2">
            <Download className="w-4 h-4" />
            Download PDF
          </Button>
        </div>
      </div>
    </div>
  );
}