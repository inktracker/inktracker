// What each artwork-proof action WRITES (pure, unit-tested). The edge
// functions load the rows, call these, and execute the returned writes.
//
//   planSendProof        shop sends (or re-sends) a proof → new version
//   planCustomerApproval customer approves the proof they're looking at
//   planChangeRequest    customer asks for changes
//   planOverride         owner/manager marks art approved (e.g. by phone)

import { ART_STATUS, proofSnapshot, artFingerprint } from "./artApproval.js";

/**
 * The customer must be answering the art that's current NOW. Their page
 * sends back the fingerprint + version it showed; if the shop changed the
 * art or sent a newer version since, refuse and ask them to reload.
 */
export function staleProofCheck(order, seen) {
  const fp = String(seen?.fingerprint ?? "");
  if (!fp || fp !== artFingerprint(order)) return STALE;
  const cur = Number(order?.art_proof_version) || 0;
  const v = Number(seen?.version) || 0;
  if (cur && v !== cur) return STALE;
  return null;
}
const STALE = { ok: false, stale: true, error: "This proof was just updated. Reload the page to see the latest version, then approve or request changes." };

const clip = (v, n) => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, n) : null;
};

/**
 * Highest version used so far (0 when none). Includes the order's own
 * pointer: a quote-carried approval is "v1" with no proof row, and the next
 * send must be v2, not a second v1.
 */
export function latestVersion(proofs, order = null) {
  const fromRows = (Array.isArray(proofs) ? proofs : []).reduce((m, p) => Math.max(m, Number(p?.version) || 0), 0);
  return Math.max(fromRows, Number(order?.art_proof_version) || 0);
}

/** Customer-facing wording for a shop-recorded approval (no staff names or notes). */
export const SHOP_RECORDED_APPROVER = "The shop, on your behalf";

/** The proof row the order's current state refers to, if any. */
export function currentProof(order, proofs) {
  const v = Number(order?.art_proof_version);
  const list = Array.isArray(proofs) ? proofs : [];
  return list.find((p) => Number(p?.version) === v) ?? null;
}

/**
 * Shop sends a proof. Every send is a new version; any proof still waiting
 * (or with changes requested) is superseded. Sending a new version also
 * clears an existing approval — the customer is being asked again.
 */
export function planSendProof({ order, proofs, sentBy, sentTo, message, now = new Date().toISOString() }) {
  const snap = proofSnapshot(order);
  if (snap.files.length === 0 && snap.imprints.length === 0) {
    return { ok: false, error: "Add artwork to the order before sending a proof." };
  }
  if (!String(sentTo ?? "").includes("@")) {
    return { ok: false, error: "Add the customer's email to the order (or type one) to send the proof." };
  }
  const version = latestVersion(proofs, order) + 1;
  return {
    ok: true,
    version,
    supersede: (proofs ?? []).filter((p) => ["sent", "changes_requested"].includes(p?.status)).map((p) => p.id),
    insert: {
      shop_owner: order.shop_owner,
      order_id: order.id,
      version,
      status: "sent",
      snapshot: snap,
      source: "sent",
      sent_at: now,
      sent_by: clip(sentBy, 200),
      sent_to: clip(sentTo, 320),
      message: clip(message, 2000),
    },
    orderPatch: {
      art_status: ART_STATUS.SENT,
      art_proof_version: version,
      art_approved: false,
      art_approved_at: null,
      art_approved_by: null,
      art_approved_fingerprint: null,
    },
  };
}

/**
 * Customer approves what they see. Approves the current proof version; when
 * the shop never "sent" one (link copied by hand, or a pre-versioning order)
 * a version is created on the spot so the record still shows exactly what
 * was approved.
 */
export function planCustomerApproval({ order, proofs, name, ip, userAgent, seen, now = new Date().toISOString() }) {
  const stale = staleProofCheck(order, seen);
  if (stale) return stale;
  const approver = clip(name, 120) || "Customer";
  const snap = proofSnapshot(order);
  const cur = currentProof(order, proofs);
  const proofFields = {
    status: "approved",
    responded_at: now,
    approved_by_name: approver,
    client_ip: clip(ip, 64),
    client_user_agent: clip(userAgent, 400),
    // What they actually approved (the art may have moved since the send).
    snapshot: snap,
  };
  const reuse = cur && ["sent", "changes_requested"].includes(cur.status);
  const version = reuse ? cur.version : latestVersion(proofs, order) + 1;
  return {
    ok: true,
    version,
    proofUpdate: reuse ? { id: cur.id, patch: proofFields } : null,
    proofInsert: reuse ? null : {
      shop_owner: order.shop_owner, order_id: order.id, version, source: "link", sent_at: now, ...proofFields,
    },
    orderPatch: {
      art_status: ART_STATUS.APPROVED,
      art_approved: true,
      art_approved_at: now,
      art_approved_by: approver,
      art_proof_version: version,
      art_approved_fingerprint: snap.fingerprint,
    },
  };
}

/** Customer asks for changes. Clears any approval; the shop sends a revision. */
export function planChangeRequest({ order, proofs, name, comment, location, ip, userAgent, seen, now = new Date().toISOString() }) {
  const text = clip(comment, 2000);
  if (!text) return { ok: false, error: "Tell the shop what you'd like changed." };
  const stale = staleProofCheck(order, seen);
  if (stale) return stale;
  const cur = currentProof(order, proofs);
  const reuse = cur && ["sent", "approved"].includes(cur.status);
  const version = reuse ? cur.version : latestVersion(proofs, order) + 1;
  const proofFields = {
    status: "changes_requested",
    responded_at: now,
    approved_by_name: clip(name, 120),
    response_comment: text,
    response_location: clip(location, 120),
    client_ip: clip(ip, 64),
    client_user_agent: clip(userAgent, 400),
  };
  return {
    ok: true,
    version,
    comment: text,
    proofUpdate: reuse ? { id: cur.id, patch: proofFields } : null,
    proofInsert: reuse ? null : {
      shop_owner: order.shop_owner, order_id: order.id, version, source: "link", sent_at: now, snapshot: proofSnapshot(order), ...proofFields,
    },
    orderPatch: {
      art_status: ART_STATUS.CHANGES,
      art_proof_version: version,
      art_approved: false,
      art_approved_at: null,
      art_approved_by: null,
      art_approved_fingerprint: null,
    },
  };
}

/** Owner/manager marks the art approved without the customer clicking. */
export function planOverride({ order, proofs, byName, note, now = new Date().toISOString() }) {
  const why = clip(note, 1000);
  if (!why) return { ok: false, error: "Add a note saying how the customer approved (for example, “approved by phone”)." };
  const snap = proofSnapshot(order);
  const version = latestVersion(proofs, order) + 1;
  const by = clip(byName, 120) || "Shop";
  return {
    ok: true,
    version,
    supersede: (proofs ?? []).filter((p) => ["sent", "changes_requested"].includes(p?.status)).map((p) => p.id),
    insert: {
      shop_owner: order.shop_owner, order_id: order.id, version, status: "approved_override", source: "override",
      snapshot: snap, sent_at: now, responded_at: now, override_by: by, override_note: why,
    },
    orderPatch: {
      art_status: ART_STATUS.APPROVED,
      art_approved: true,
      art_approved_at: now,
      // Shown on the customer's page: never the staff name or the internal
      // note (both live on the proof row: override_by / override_note).
      art_approved_by: SHOP_RECORDED_APPROVER,
      art_proof_version: version,
      art_approved_fingerprint: snap.fingerprint,
    },
  };
}
