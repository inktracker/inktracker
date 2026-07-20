// Manual rush-rate override detection (tester note 2026-07-18: "the
// rush fee should not automatically be enforced when toggled off").
//
// The quote editors auto-apply the rush rate from the shop's rushTiers
// whenever the due date changes ("rate follows the date"). That's the
// desired default — but it also silently RE-applied a rush fee the
// operator had explicitly waived: pick Standard (rush 0), then correct
// the due date to the actually-promised tight date, and the due-date
// handler stomped the waive with the tier rate again.
//
// Both editors now keep a session flag once the operator picks a
// Turnaround button, and skip the auto-apply while the operator's
// choice is a waive (rate 0). This helper seeds that flag on reopen:
// a saved quote whose stored rush_rate disagrees with what the tier
// table would auto-apply for its dates can only mean the operator
// overrode it, so the editors treat it as manually set from the start
// and the waive survives the round-trip without needing a DB column.
import { getRushRateForDaysOut } from "@/components/shared/pricing";

/** Calendar days between quote date and due date; null when either is missing. */
export function quoteDaysOut(quote) {
  if (!quote?.due_date || !quote?.date) return null;
  const ms = new Date(quote.due_date) - new Date(quote.date);
  if (!Number.isFinite(ms)) return null;
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

export function isRushManuallyOverridden(quote) {
  const d = quoteDaysOut(quote);
  if (d === null) return false;
  const suggested = getRushRateForDaysOut(d);
  const actual = parseFloat(quote?.rush_rate) || 0;
  return Math.abs(suggested - actual) > 0.0001;
}

/**
 * The due-date handler's decision: what rush rate to apply after a due
 * date change. Auto-follows the tier table UNLESS the operator has
 * manually waived rush (flag set + current rate 0) — a manual waive
 * sticks; a manually picked nonzero tier still follows date slides.
 */
export function nextRushRateForDueDateChange({ diffDays, currentRate, rushManuallySet }) {
  const rate = parseFloat(currentRate) || 0;
  if (diffDays === null || diffDays === undefined) return rate;
  const waived = !!rushManuallySet && !(rate > 0);
  if (waived) return rate;
  return getRushRateForDaysOut(diffDays);
}
