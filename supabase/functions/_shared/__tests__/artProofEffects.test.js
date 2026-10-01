import { describe, it, expect } from "vitest";
import { planSendProof, planCustomerApproval, planChangeRequest, planOverride, latestVersion } from "../artProofEffects.js";
import { artFingerprint, artApprovalState } from "../artApproval.js";

const NOW = "2026-10-02T21:14:00.000Z";
const order = (over = {}) => ({
  id: "o1", shop_owner: "joe@biotamfg.co", customer_email: "buyer@tahoegift.com",
  selected_artwork: [{ id: "a1", name: "Front.pdf", url: "https://x/front.pdf" }],
  line_items: [{ imprints: [{ location: "Front", colors: 2 }] }],
  ...over,
});

describe("planSendProof", () => {
  it("first send → v1, order waiting on customer", () => {
    const p = planSendProof({ order: order(), proofs: [], sentBy: "Joe", sentTo: "buyer@tahoegift.com", now: NOW });
    expect(p.ok).toBe(true);
    expect(p.version).toBe(1);
    expect(p.insert).toMatchObject({ version: 1, status: "sent", sent_to: "buyer@tahoegift.com", source: "sent" });
    expect(p.insert.snapshot.files[0].name).toBe("Front.pdf");
    expect(p.orderPatch).toMatchObject({ art_status: "sent", art_proof_version: 1, art_approved: false });
  });
  it("re-send → next version, waiting/changes versions superseded, approval cleared", () => {
    const proofs = [{ id: "p1", version: 1, status: "changes_requested" }, { id: "p0", version: 0, status: "superseded" }];
    const p = planSendProof({ order: order({ art_approved: true }), proofs, sentTo: "b@x.com", now: NOW });
    expect(p.version).toBe(2);
    expect(p.supersede).toEqual(["p1"]);
    expect(p.orderPatch.art_approved_fingerprint).toBeNull();
  });
  it("refuses with no artwork or no email", () => {
    expect(planSendProof({ order: order({ selected_artwork: [], line_items: [] }), proofs: [], sentTo: "b@x.com" }).error).toMatch(/Add artwork/);
    expect(planSendProof({ order: order(), proofs: [], sentTo: "" }).error).toMatch(/customer's email/);
  });
});

describe("planCustomerApproval", () => {
  it("approves the current sent version and records who/when/where + what", () => {
    const o = order({ art_proof_version: 2 });
    const p = planCustomerApproval({ order: o, proofs: [{ id: "p2", version: 2, status: "sent" }], name: " Jane Smith ", ip: "1.2.3.4", userAgent: "Safari", now: NOW });
    expect(p.proofUpdate).toMatchObject({ id: "p2", patch: { status: "approved", approved_by_name: "Jane Smith", client_ip: "1.2.3.4", client_user_agent: "Safari" } });
    expect(p.orderPatch).toMatchObject({ art_status: "approved", art_approved: true, art_approved_by: "Jane Smith", art_proof_version: 2, art_approved_fingerprint: artFingerprint(o) });
    expect(artApprovalState({ ...o, ...p.orderPatch }).approved).toBe(true);
  });
  it("link copied by hand (no proof sent) → creates the version it approves", () => {
    const p = planCustomerApproval({ order: order(), proofs: [], name: "", now: NOW });
    expect(p.proofInsert).toMatchObject({ version: 1, status: "approved", source: "link", approved_by_name: "Customer" });
  });
});

describe("planChangeRequest", () => {
  it("records the comment + location, clears approval", () => {
    const o = order({ art_proof_version: 1 });
    const p = planChangeRequest({ order: o, proofs: [{ id: "p1", version: 1, status: "sent" }], name: "Jane", comment: "Make the logo bigger", location: "Front", now: NOW });
    expect(p.ok).toBe(true);
    expect(p.proofUpdate.patch).toMatchObject({ status: "changes_requested", response_comment: "Make the logo bigger", response_location: "Front" });
    expect(p.orderPatch).toMatchObject({ art_status: "changes_requested", art_approved: false });
  });
  it("needs a comment", () => {
    expect(planChangeRequest({ order: order(), proofs: [], comment: "  " }).ok).toBe(false);
  });
});

describe("planOverride", () => {
  it("needs a note; records who and why; approves as a new version", () => {
    expect(planOverride({ order: order(), proofs: [], byName: "Joe", note: "" }).ok).toBe(false);
    const p = planOverride({ order: order(), proofs: [{ id: "p1", version: 1, status: "sent" }], byName: "Joe", note: "Approved by phone 10/2", now: NOW });
    expect(p.version).toBe(2);
    expect(p.supersede).toEqual(["p1"]);
    expect(p.insert).toMatchObject({ status: "approved_override", override_by: "Joe", override_note: "Approved by phone 10/2" });
    expect(p.orderPatch.art_approved_by).toBe("Joe (override: Approved by phone 10/2)");
  });
  it("latestVersion", () => expect(latestVersion([{ version: 3 }, { version: 1 }])).toBe(3));
});
