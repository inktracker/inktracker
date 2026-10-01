// Attaching a Mockup Designer proof PDF to an order/quote's artwork.
//
// Mockup proofs are the selected_artwork entries the designer creates
// (type "proof"). Re-sending a mockup normally REPLACES the previous one:
// the artwork list is what the customer reviews and approves, so stacking
// old mockups would show them every past version side by side.

/** True for a proof PDF made by the Mockup Designer. */
export function isMockupProof(entry) {
  return entry?.type === "proof";
}

/** How many mockup proofs the record already carries. */
export function countMockupProofs(selectedArtwork) {
  return (Array.isArray(selectedArtwork) ? selectedArtwork : []).filter(isMockupProof).length;
}

/**
 * The record's next selected_artwork: the new proof appended, and (when
 * `replace`) earlier mockup proofs dropped. Uploaded art files are never
 * touched. Only the link is removed — the stored file stays.
 */
export function withMockupProof(selectedArtwork, entry, { replace = true } = {}) {
  const current = Array.isArray(selectedArtwork) ? selectedArtwork : [];
  const kept = replace ? current.filter((a) => !isMockupProof(a)) : current;
  return [...kept, entry];
}

/** Who a proof for this order goes to (broker orders → the broker). */
export function proofRecipientEmail(order) {
  const broker = String(order?.broker_id || "").trim();
  if (broker.includes("@")) return broker;
  return String(order?.customer_email || "").trim();
}
