import { Link } from "react-router-dom";

// Small inline "Reactivate" CTA shown next to a disabled write affordance when
// the shop is read-only (subscription lapsed). It exists so a user always sees
// WHY a button is off and where to fix it — we disable + explain, never hide
// silently. Renders nothing when the shop can still write.
//
// Pair with a button that sets `disabled={readOnly}` and `title={reason}`.
export default function ReactivateLink({ show, href, className = "" }) {
  if (!show) return null;
  return (
    <Link
      to={href}
      className={`text-xs font-semibold text-teal-600 hover:text-teal-700 underline whitespace-nowrap ${className}`}
    >
      Reactivate
    </Link>
  );
}
