// Legacy status-badge alias. It now renders the canonical StatusChip so the
// SAME status looks identical everywhere. Previously a separate BADGE_STYLES
// map disagreed with chips.jsx — "Sent" was slate here but amber there,
// "Pre-Press" amber vs the mandated cyan, "Completed" emerald vs teal — so a
// quote read as a different color depending on which surface you were on.
// Kept as a thin wrapper so the existing <Badge s={...}/> call sites (Orders,
// Production, QuoteDetailModal, OrderDetailHeader, OrderScheduleRow) don't churn.
import { StatusChip } from "./chips";

export default function Badge({ s }) {
  return <StatusChip s={s} />;
}
