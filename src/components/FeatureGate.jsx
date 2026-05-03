import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { canAccess, getTierLabel } from "@/lib/billing";
import { Lock } from "lucide-react";

export default function FeatureGate({ feature, tier, children }) {
  if (canAccess(tier, feature)) return children;

  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 rounded-full bg-indigo-100 flex items-center justify-center mx-auto mb-4">
          <Lock className="w-8 h-8 text-indigo-600" />
        </div>
        <h2 className="text-xl font-bold text-slate-900 mb-2">
          Upgrade Required
        </h2>
        <p className="text-sm text-slate-500 mb-6">
          This feature requires an active subscription.
          You're currently on <strong>{getTierLabel(tier)}</strong>.
        </p>
        <Link to={createPageUrl("Account") + "?billing=1"}
          className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-6 py-3 rounded-xl transition">
          View Plan
        </Link>
      </div>
    </div>
  );
}
