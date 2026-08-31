import { describe, it, expect } from "vitest";
import { validateMentions, commentSnippet, buildCommentNotificationRows } from "../orderComments";

const ROSTER = [
  { email: "joe@biotamfg.co", name: "Joe" },
  { email: "sam@biotamfg.co", name: "Sam Rivera" },
  { email: "pat@biotamfg.co", name: "Pat Doe" },
];

describe("validateMentions", () => {
  it("keeps only roster members, dedupes, normalizes case", () => {
    expect(validateMentions(["SAM@biotamfg.co", "sam@biotamfg.co", "stranger@x.co"], ROSTER, "joe@biotamfg.co"))
      .toEqual(["sam@biotamfg.co"]);
  });

  it("drops self-mentions and empty/garbage input", () => {
    expect(validateMentions(["joe@biotamfg.co", "", null], ROSTER, "Joe@Biotamfg.co")).toEqual([]);
    expect(validateMentions(null, ROSTER, "joe@biotamfg.co")).toEqual([]);
    expect(validateMentions(["sam@biotamfg.co"], [], "joe@biotamfg.co")).toEqual([]);
  });
});

describe("commentSnippet", () => {
  it("collapses whitespace and clamps with an ellipsis", () => {
    expect(commentSnippet("  screens\n\nare   burned ")).toBe("screens are burned");
    const long = "x".repeat(300);
    expect(commentSnippet(long)).toHaveLength(140);
    expect(commentSnippet(long).endsWith("…")).toBe(true);
  });
});

describe("buildCommentNotificationRows", () => {
  const base = {
    shopOwner: "joe@biotamfg.co",
    orderId: "ORD-2026-USKJZ",
    orderRowId: "row-uuid",
    authorEmail: "sam@biotamfg.co",
    authorName: "Sam Rivera",
    body: "Ink is mixed, screens ready",
  };

  it("addresses each mention personally and always loops in the owner", () => {
    const rows = buildCommentNotificationRows({ ...base, validMentions: ["pat@biotamfg.co"] });
    const byRecipient = Object.fromEntries(rows.map((r) => [r.recipient_email, r]));
    expect(Object.keys(byRecipient).sort()).toEqual(["joe@biotamfg.co", "pat@biotamfg.co"]);
    expect(byRecipient["pat@biotamfg.co"].title).toBe("Sam Rivera mentioned you on ORD-2026-USKJZ");
    expect(byRecipient["joe@biotamfg.co"].title).toBe("Sam Rivera commented on ORD-2026-USKJZ");
    for (const r of rows) {
      expect(r).toMatchObject({
        shop_owner: "joe@biotamfg.co",
        event_type: "order_comment",
        severity: "info",
        related_entity: "order",
        related_id: "row-uuid",
        body: "Ink is mixed, screens ready",
      });
    }
  });

  it("never notifies the author — owner commenting with no mentions produces zero rows", () => {
    const rows = buildCommentNotificationRows({
      ...base,
      authorEmail: "joe@biotamfg.co",
      authorName: "Joe",
      validMentions: [],
    });
    expect(rows).toEqual([]);
  });

  it("owner mentioned explicitly gets the mention title, not a duplicate row", () => {
    const rows = buildCommentNotificationRows({ ...base, validMentions: ["joe@biotamfg.co"] });
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toContain("mentioned you");
    expect(rows[0].metadata.mentioned).toBe(true);
  });
});
