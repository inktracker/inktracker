import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { AlertTriangle } from "lucide-react";
import { useSupplierFlags } from "@/lib/suppliers/useSupplierFlags";

// Nudges a shop to connect its OWN supplier account before ordering. An order
// placed without the shop's own credentials is refused server-side (each
// supplier's order bills whatever account is on the request — never the
// platform's), so this surfaces the gap up front with a link to fix it.
//
// Renders nothing while flags load or when the supplier is already connected,
// so it's safe to drop in unconditionally wherever a supplier order can start.
export default function SupplierConnectionBanner({ supplier, className = "" }) {
  const { isConnected } = useSupplierFlags();
  const connected = isConnected(supplier);
  if (connected === undefined || connected) return null; // loading or ready → nothing

  return (
    <div
      className={`flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 ${className}`}
      role="status"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
      <div className="flex-1">
        <span className="font-semibold">Connect your {supplier} account to order.</span>{" "}
        Orders are placed on <span className="font-semibold">your</span> {supplier} account, so InkTracker needs your
        account credentials first.{" "}
        <Link to={createPageUrl("Account")} className="font-semibold underline underline-offset-2 hover:text-amber-700">
          Add them in Account → Suppliers
        </Link>
        .
      </div>
    </div>
  );
}
