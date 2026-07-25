import { Link } from "react-router-dom";
import { isNative } from "@/lib/mobile/native";

// Small inline "Reactivate" CTA shown next to a disabled write affordance when
// the shop is read-only (subscription lapsed). It exists so a user always sees
// WHY a button is off and where to fix it — we disable + explain, never hide
// silently. Renders nothing when the shop can still write.
//
// Pair with a button that sets `disabled={readOnly}` and `title={reason}`.
export default function ReactivateLink({ show, href, className = "" }) {
  if (!show) return null;
  // App Store guideline 3.1.1: no purchase link on native. The write stays
  // disabled (the shop is genuinely read-only); we just don't offer an in-app
  // path to a purchase page. Reactivation happens on the web.
  if (isNative()) return null;
  return (
    <Link
      to={href}
      className={`text-xs font-semibold text-teal-600 hover:text-teal-700 underline whitespace-nowrap ${className}`}
    >
      Reactivate
    </Link>
  );
}
