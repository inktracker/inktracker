// Artwork approval — the one shared definition of "what the customer
// approved" and "is this order's art approved right now". Pure, no Deno or
// browser APIs: imported by the edge functions AND the frontend
// (src/lib/art/artApproval.js re-exports this file), so the server that
// records an approval and the screens that gate production can never
// disagree.
//
// Model:
//   - Each "Send proof" creates a numbered proof version (art_proofs row)
//     with a snapshot of the files + print locations the customer sees.
//   - The customer approves the whole proof, or requests changes.
//   - On approval we store a FINGERPRINT of the art. The order's art counts
//     as approved only while the current art still has that fingerprint —
//     swap a file or change a print location and the approval no longer
//     applies (no need to catch every write path).

export const ART_STATUS = Object.freeze({
  NONE: "none",                       // no proof sent yet
  SENT: "sent",                       // waiting on the customer
  CHANGES: "changes_requested",       // customer asked for changes
  APPROVED: "approved",               // customer approved (or shop override)
});

// The stage an order must leave only with approved art.
export const ART_STAGE = "Art Approval";

// Customer reminder after a proof sits unanswered this long.
export const PROOF_REMINDER_DAYS = 2;

const str = (v) => (v == null ? "" : String(v).trim());

/** Files the customer sees, as stable comparable records. */
export function artFiles(order) {
  const out = [];
  const seen = new Set();
  for (const a of Array.isArray(order?.selected_artwork) ? order.selected_artwork : []) {
    const url = str(a?.url || a?.file_url || a?.path);
    const key = str(a?.id) || url || str(a?.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, name: str(a?.name) || "Artwork", url });
  }
  return out;
}

/** Print locations the customer sees (what's printed, where, how). */
export function artImprints(order) {
  const out = [];
  for (const li of Array.isArray(order?.line_items) ? order.line_items : []) {
    const garment = [li?.brand, li?.productName || li?.style, li?.garmentColor].filter(Boolean).map(str).join(" · ");
    for (const imp of Array.isArray(li?.imprints) ? li.imprints : []) {
      if (!imp?.colors && !imp?.location) continue;
      out.push({
        garment,
        location: str(imp.location),
        title: str(imp.title),
        artwork: str(imp.artwork_id || imp.artwork_url || imp.artwork_name),
        colors: str(imp.colors),
        technique: str(imp.technique),
        size: [str(imp.width), str(imp.height)].filter(Boolean).join("x"),
        pantones: str(Array.isArray(imp.pantones) ? imp.pantones.join(",") : imp.pantones),
        details: str(imp.details),
      });
    }
  }
  return out;
}

// FNV-1a 32-bit — tiny, deterministic, identical in every runtime.
function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Fingerprint of the art the customer approves: files + print locations.
 * Order-independent (sorted), so re-ordering lines or files doesn't count as
 * a change; any change to a file, location, colours, technique, size,
 * Pantones or details does.
 */
export function artFingerprint(order) {
  const files = artFiles(order).map((f) => f.url || f.key).sort();
  const imprints = artImprints(order).map((i) => JSON.stringify(i)).sort();
  return `v1:${fnv1a(JSON.stringify({ files, imprints }))}`;
}

/** Snapshot stored on the proof version (what the customer was shown). */
export function proofSnapshot(order) {
  return { files: artFiles(order), imprints: artImprints(order), fingerprint: artFingerprint(order) };
}

/**
 * The order's art approval state right now.
 * @returns {{ status: string, approved: boolean, changedSinceApproval: boolean,
 *             version: number|null, by: string|null, at: string|null }}
 */
export function artApprovalState(order) {
  const version = Number.isInteger(Number(order?.art_proof_version)) && Number(order?.art_proof_version) > 0
    ? Number(order.art_proof_version) : null;
  const raw = str(order?.art_status) || (order?.art_approved ? ART_STATUS.APPROVED : ART_STATUS.NONE);
  const approvedFlag = raw === ART_STATUS.APPROVED || order?.art_approved === true;
  const fp = str(order?.art_approved_fingerprint);
  // Legacy approvals (before fingerprints) count as approved until the art is
  // edited — editOrderEngine already clears art_approved on imprint edits.
  const changedSinceApproval = approvedFlag && Boolean(fp) && fp !== artFingerprint(order);
  const approved = approvedFlag && !changedSinceApproval;
  return {
    // Approval voided by an art change → a new proof is needed (badge and
    // gate say why via changedSinceApproval).
    status: approved ? ART_STATUS.APPROVED : (changedSinceApproval ? ART_STATUS.NONE : raw),
    approved,
    changedSinceApproval,
    version,
    by: approved ? (str(order?.art_approved_by) || null) : null,
    at: approved ? (order?.art_approved_at ?? null) : null,
  };
}

/** Short label + tone for badges on the floor, lists and the order header. */
export function artBadge(order) {
  const s = artApprovalState(order);
  if (s.approved) return { label: s.version ? `Art approved · v${s.version}` : "Art approved", tone: "good" };
  if (s.changedSinceApproval) return { label: "Art changed since approval", tone: "warn" };
  if (s.status === ART_STATUS.CHANGES) return { label: "Changes requested", tone: "warn" };
  if (s.status === ART_STATUS.SENT) return { label: "Waiting on customer", tone: "wait" };
  return { label: "Proof not sent", tone: "muted" };
}

/**
 * Production gate: can this order move from `from` to `to`?
 * Leaving the Art Approval stage forward requires approved art. Moving back,
 * or moves that don't leave Art Approval, are never blocked.
 * @param {string[]} stages ordered stage list (O_STATUSES)
 */
export function artGate(order, from, to, stages) {
  const i = stages.indexOf(from);
  const j = stages.indexOf(to);
  const artIdx = stages.indexOf(ART_STAGE);
  if (artIdx < 0 || i < 0 || j < 0) return { ok: true };
  const leavingForward = i <= artIdx && j > artIdx;
  if (!leavingForward) return { ok: true };
  const s = artApprovalState(order);
  if (s.approved) return { ok: true };
  const why = s.changedSinceApproval
    ? "The art changed after the customer approved it. Send them the updated proof."
    : s.status === ART_STATUS.CHANGES
      ? "The customer asked for changes to the art. Send a revised proof."
      : s.status === ART_STATUS.SENT
        ? "The customer hasn't approved the proof yet."
        : "No proof has been sent to the customer yet.";
  return { ok: false, reason: why };
}

/** Is a sent proof due its one reminder? */
export function proofReminderDue(proof, now = Date.now()) {
  if (!proof || proof.status !== ART_STATUS.SENT || proof.reminder_sent_at) return false;
  const sent = new Date(proof.sent_at ?? proof.created_at ?? NaN).getTime();
  return Number.isFinite(sent) && now - sent >= PROOF_REMINDER_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Quote-stage proofs count as approval: the customer approved the quote with
 * proof images attached. Returns the order fields to set at conversion, or
 * null. `proofUrls` = proof images that were on the approved quote.
 */
export function quoteProofApproval({ quote, order, proofUrls }) {
  if (!quote?.client_approved_at || !Array.isArray(proofUrls) || proofUrls.length === 0) return null;
  return {
    art_status: ART_STATUS.APPROVED,
    art_approved: true,
    art_approved_at: quote.client_approved_at,
    art_approved_by: str(quote.customer_name) ? `${str(quote.customer_name)} (approved with quote)` : "Customer (approved with quote)",
    art_proof_version: 1,
    art_approved_fingerprint: artFingerprint(order),
  };
}
