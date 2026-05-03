import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  FileText, Package, Users, Archive, Receipt, CreditCard,
  Plus, ArrowRight, Wand2
} from "lucide-react";

const CONFIGS = {
  quotes: {
    icon: FileText,
    title: "No quotes yet",
    description: "Create your first quote to get started. Add a customer, pick garments, set pricing, and send it for approval.",
    primaryAction: { label: "Create Quote", action: "new" },
    secondaryAction: { label: "Go to Customers", page: "Customers" },
    tip: "Quotes can also come in from the embeddable Quote Wizard on your website.",
  },
  orders: {
    icon: Package,
    title: "No orders yet",
    description: "Orders are created when a quote is approved and converted. Start by creating and sending a quote to a customer.",
    primaryAction: { label: "Create a Quote First", page: "Quotes" },
    tip: "Once a customer approves a quote, you can convert it to an order with one click.",
  },
  customers: {
    icon: Users,
    title: "No customers yet",
    description: "Add your first customer to start building quotes and tracking orders. You can also import customers from QuickBooks.",
    primaryAction: { label: "Add Customer", action: "new" },
    tip: "Customers are also created automatically when quotes come in through the Quote Wizard.",
  },
  inventory: {
    icon: Archive,
    title: "No inventory items yet",
    description: "Track your blanks, inks, screens, and supplies. Set reorder points to get alerts when stock runs low.",
    primaryAction: { label: "Add Item", action: "new" },
    tip: "You can sync inventory from Shopify or order blanks directly from S&S Activewear.",
  },
  invoices: {
    icon: Receipt,
    title: "No invoices yet",
    description: "Invoices are generated from completed orders. Connect QuickBooks to sync invoices automatically, or create them manually.",
    primaryAction: { label: "Connect QuickBooks", page: "Account" },
    secondaryAction: { label: "View Orders", page: "Production" },
    tip: "Once QuickBooks is connected, invoices sync both ways automatically.",
  },
  expenses: {
    icon: CreditCard,
    title: "No expenses yet",
    description: "Track business expenses like ink, supplies, and equipment. Snap receipt photos and sync to QuickBooks.",
    primaryAction: { label: "Add Expense", action: "new" },
    tip: "You can also pull expenses from QuickBooks if they were entered there first.",
  },
};

export default function EmptyState({ type, onAction, className = "" }) {
  const navigate = useNavigate();
  const config = CONFIGS[type];
  if (!config) return null;

  const Icon = config.icon;

  function handlePrimary() {
    if (config.primaryAction.action === "new" && onAction) {
      onAction();
    } else if (config.primaryAction.page) {
      navigate(createPageUrl(config.primaryAction.page));
    }
  }

  function handleSecondary() {
    if (config.secondaryAction?.page) {
      navigate(createPageUrl(config.secondaryAction.page));
    }
  }

  return (
    <div className={`py-16 px-6 text-center ${className}`}>
      <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
        <Icon className="w-7 h-7 text-slate-300" />
      </div>
      <h3 className="text-base font-bold text-slate-700 mb-2">{config.title}</h3>
      <p className="text-sm text-slate-400 max-w-md mx-auto leading-relaxed mb-6">
        {config.description}
      </p>
      <div className="flex items-center justify-center gap-3 flex-wrap">
        <button
          onClick={handlePrimary}
          className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition"
        >
          {config.primaryAction.action === "new" ? <Plus className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
          {config.primaryAction.label}
        </button>
        {config.secondaryAction && (
          <button
            onClick={handleSecondary}
            className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-700 text-sm font-semibold px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 transition"
          >
            {config.secondaryAction.label}
          </button>
        )}
      </div>
      {config.tip && (
        <div className="mt-8 inline-flex items-start gap-2 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 max-w-md text-left">
          <Wand2 className="w-4 h-4 text-indigo-400 mt-0.5 shrink-0" />
          <p className="text-xs text-indigo-600 leading-relaxed">{config.tip}</p>
        </div>
      )}
    </div>
  );
}
