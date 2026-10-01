import { describe, it, expect } from "vitest";
import {
  ART_STATUS, artFingerprint, artApprovalState, artBadge, artGate, proofSnapshot,
  proofReminderDue, quoteProofApproval, artFiles,
} from "../artApproval.js";

const STAGES = ["Art Approval", "Order Goods", "Pre-Press", "Printing", "Completed"];
const order = (over = {}) => ({
  selected_artwork: [{ id: "a1", name: "Front logo.pdf", url: "https://x/front.pdf" }],
  line_items: [{ brand: "Comfort Colors", style: "1717", garmentColor: "White", imprints: [
    { location: "Front", colors: 2, technique: "Screen Print", width: 10, height: 8, artwork_id: "a1" },
  ] }],
  ...over,
});

describe("artFingerprint", () => {
  it("is stable across re-ordering, changes when the art changes", () => {
    const o = order({ selected_artwork: [{ id: "a1", url: "u1" }, { id: "a2", url: "u2" }] });
    const reordered = order({ selected_artwork: [{ id: "a2", url: "u2" }, { id: "a1", url: "u1" }] });
    expect(artFingerprint(o)).toBe(artFingerprint(reordered));
    expect(artFingerprint(o)).not.toBe(artFingerprint(order({ selected_artwork: [{ id: "a1", url: "u1-v2" }, { id: "a2", url: "u2" }] })));
    const moreColors = order();
    moreColors.line_items[0].imprints[0].colors = 3;
    expect(artFingerprint(order())).not.toBe(artFingerprint(moreColors));
    expect(artFingerprint(order())).toMatch(/^v1:[0-9a-f]{8}$/);
  });
  it("ignores empty imprints and duplicate files", () => {
    const o = order();
    const withJunk = order({ selected_artwork: [...o.selected_artwork, { id: "a1", url: "https://x/front.pdf" }] });
    withJunk.line_items[0].imprints.push({ location: "", colors: 0 });
    expect(artFingerprint(withJunk)).toBe(artFingerprint(o));
    expect(artFiles(withJunk)).toHaveLength(1);
  });
});

describe("artApprovalState / badge", () => {
  it("approved while the art is unchanged; voided when it changes", () => {
    const o = order();
    const approved = { ...o, art_status: "approved", art_approved: true, art_approved_by: "Jane Smith", art_approved_at: "2026-10-02T21:14:00Z", art_proof_version: 2, art_approved_fingerprint: artFingerprint(o) };
    expect(artApprovalState(approved)).toMatchObject({ approved: true, version: 2, by: "Jane Smith" });
    expect(artBadge(approved)).toEqual({ label: "Art approved · v2", tone: "good" });
    const edited = { ...approved, selected_artwork: [{ id: "a1", url: "https://x/front-v2.pdf" }] };
    expect(artApprovalState(edited)).toMatchObject({ approved: false, changedSinceApproval: true, by: null });
    expect(artBadge(edited).label).toBe("Art changed since approval");
  });
  it("legacy approvals (no fingerprint) still count", () => {
    expect(artApprovalState({ ...order(), art_approved: true }).approved).toBe(true);
  });
  it("labels each waiting state", () => {
    expect(artBadge(order({ art_status: "sent", art_proof_version: 1 })).label).toBe("Waiting on customer");
    expect(artBadge(order({ art_status: "changes_requested" })).label).toBe("Changes requested");
    expect(artBadge(order()).label).toBe("Proof not sent");
  });
});

describe("artGate", () => {
  const o = order();
  const approved = { ...o, art_status: "approved", art_approved: true, art_approved_fingerprint: artFingerprint(o) };
  it("blocks leaving Art Approval forward without approved art, with a plain reason", () => {
    expect(artGate(o, "Art Approval", "Order Goods", STAGES)).toEqual({ ok: false, reason: "No proof has been sent to the customer yet." });
    expect(artGate({ ...o, art_status: "sent" }, "Art Approval", "Printing", STAGES).reason).toMatch(/hasn't approved/);
    expect(artGate({ ...o, art_status: "changes_requested" }, "Art Approval", "Order Goods", STAGES).reason).toMatch(/asked for changes/);
  });
  it("allows approved art, backward moves, and moves elsewhere in the pipeline", () => {
    expect(artGate(approved, "Art Approval", "Order Goods", STAGES).ok).toBe(true);
    expect(artGate(o, "Order Goods", "Art Approval", STAGES).ok).toBe(true);
    expect(artGate(o, "Pre-Press", "Printing", STAGES).ok).toBe(true);
    expect(artGate(o, "Art Approval", "Art Approval", STAGES).ok).toBe(true);
  });
});

describe("proofSnapshot / reminders / quote carry-over", () => {
  it("snapshot carries files, locations and the fingerprint", () => {
    const s = proofSnapshot(order());
    expect(s.files[0]).toMatchObject({ name: "Front logo.pdf", url: "https://x/front.pdf" });
    expect(s.imprints[0]).toMatchObject({ location: "Front", colors: "2", size: "10x8", garment: "Comfort Colors · 1717 · White" });
    expect(s.fingerprint).toBe(artFingerprint(order()));
  });
  it("one reminder, after 2 days, only for proofs still waiting", () => {
    const now = Date.parse("2026-10-05T12:00:00Z");
    expect(proofReminderDue({ status: "sent", sent_at: "2026-10-03T11:00:00Z" }, now)).toBe(true);
    expect(proofReminderDue({ status: "sent", sent_at: "2026-10-04T12:00:00Z" }, now)).toBe(false);
    expect(proofReminderDue({ status: "sent", sent_at: "2026-10-01T00:00:00Z", reminder_sent_at: "x" }, now)).toBe(false);
    expect(proofReminderDue({ status: "approved", sent_at: "2026-10-01T00:00:00Z" }, now)).toBe(false);
  });
  it("quote approved with proofs → order starts approved (v1); without proofs → no", () => {
    const o = order();
    const q = { client_approved_at: "2026-10-01T18:00:00Z", customer_name: "Tahoe Gift Co" };
    expect(quoteProofApproval({ quote: q, order: o, proofUrls: ["https://x/p.png"] })).toMatchObject({
      art_status: ART_STATUS.APPROVED, art_approved: true, art_proof_version: 1,
      art_approved_by: "Tahoe Gift Co (approved with quote)", art_approved_fingerprint: artFingerprint(o),
    });
    expect(quoteProofApproval({ quote: q, order: o, proofUrls: [] })).toBeNull();
    expect(quoteProofApproval({ quote: {}, order: o, proofUrls: ["x"] })).toBeNull();
  });
});
