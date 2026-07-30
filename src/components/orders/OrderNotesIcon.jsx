// Job-notes indicator for order cards/rows/chips.
//
// `order.notes` (carried from the quote at conversion) was only visible
// by opening the job and scrolling to the amber notes box — nothing on
// the Production surfaces hinted a job HAD notes. This renders a small
// sticky-note glyph only when notes exist, with the note text in the
// native title tooltip so a hover answers "what does it say" without
// opening the modal.
//
// Read-only by design: it never edits notes, and it renders nothing for
// note-less orders so the surfaces stay clean.

import { StickyNote } from "lucide-react";

const TOOLTIP_MAX = 400;

export function orderNotesTooltip(order) {
  const text = typeof order?.notes === "string" ? order.notes.trim() : "";
  if (!text) return "";
  return text.length > TOOLTIP_MAX ? `${text.slice(0, TOOLTIP_MAX - 1)}…` : text;
}

export default function OrderNotesIcon({ order, className = "" }) {
  const tooltip = orderNotesTooltip(order);
  if (!tooltip) return null;
  return (
    <span
      title={tooltip}
      aria-label={`Job notes: ${tooltip}`}
      className={`inline-flex shrink-0 text-amber-500 ${className}`}
      // The parent card's onClick opens the modal — let that through;
      // the icon is an indicator, not a button.
    >
      <StickyNote className="w-3.5 h-3.5" />
    </span>
  );
}
