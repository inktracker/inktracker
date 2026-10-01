import { describe, it, expect } from "vitest";
import { withMockupProof, countMockupProofs, proofRecipientEmail } from "../mockupProof";
import { artFingerprint } from "../artApproval";

const art = { id: "a1", name: "Logo.ai", url: "https://x/logo.ai" };
const oldMock = { id: "proof-1", name: "proof-old.pdf", url: "https://x/old.pdf", type: "proof" };
const newMock = { id: "proof-2", name: "proof-new.pdf", url: "https://x/new.pdf", type: "proof" };

describe("withMockupProof", () => {
  it("replaces the previous mockup by default and never touches uploaded art", () => {
    expect(withMockupProof([art, oldMock], newMock)).toEqual([art, newMock]);
  });
  it("stacks when the shop unticks replace", () => {
    expect(withMockupProof([art, oldMock], newMock, { replace: false })).toEqual([art, oldMock, newMock]);
  });
  it("handles a record with no artwork yet", () => {
    expect(withMockupProof(null, newMock)).toEqual([newMock]);
  });
  it("a new mockup changes the art the customer approved (approval no longer matches)", () => {
    const before = { selected_artwork: [art, oldMock] };
    const after = { selected_artwork: withMockupProof(before.selected_artwork, newMock) };
    expect(artFingerprint(after)).not.toBe(artFingerprint(before));
  });
});

describe("countMockupProofs / proofRecipientEmail", () => {
  it("counts only designer proofs", () => {
    expect(countMockupProofs([art, oldMock, newMock])).toBe(2);
    expect(countMockupProofs(undefined)).toBe(0);
  });
  it("broker orders go to the broker, others to the customer", () => {
    expect(proofRecipientEmail({ broker_id: "broker@x.com", customer_email: "end@client.com" })).toBe("broker@x.com");
    expect(proofRecipientEmail({ customer_email: " buyer@tahoegift.com " })).toBe("buyer@tahoegift.com");
    expect(proofRecipientEmail({})).toBe("");
  });
});
