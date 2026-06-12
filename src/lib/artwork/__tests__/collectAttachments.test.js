import { describe, it, expect } from "vitest";
import { collectAttachments } from "../collectAttachments";

describe("collectAttachments", () => {
  it("collects record-level selected_artwork", () => {
    const out = collectAttachments({
      selected_artwork: [
        { id: "a1", name: "mockup.png", url: "u1", source: "proof" },
        { id: "a2", name: "logo.pdf", file_url: "u2" },
      ],
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: "a1", name: "mockup.png", url: "u1" });
    expect(out[1].url).toBe("u2");
  });

  it("collects imprint-level artwork with placements", () => {
    const out = collectAttachments({
      line_items: [{ imprints: [
        { artwork_id: "i1", artwork_name: "front.png", artwork_url: "u", location: "Front", title: "Logo" },
      ]}],
    });
    expect(out).toHaveLength(1);
    expect(out[0].placements).toEqual(["Front · Logo"]);
  });

  it("dedupes the same artwork across record + imprints, merging placements", () => {
    const out = collectAttachments({
      selected_artwork: [{ id: "shared", name: "art.png", url: "u" }],
      line_items: [
        { imprints: [{ artwork_id: "shared", artwork_url: "u", location: "Front" }] },
        { imprints: [{ artwork_id: "shared", artwork_url: "u", location: "Back" }] },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].placements).toEqual(["Front", "Back"]);
  });

  it("drops entries with no openable url or path", () => {
    const out = collectAttachments({
      selected_artwork: [{ id: "x", name: "ghost", url: "", file_url: "" }],
    });
    expect(out).toHaveLength(0);
  });

  it("works identically for a quote or an order shape", () => {
    expect(collectAttachments({ selected_artwork: [{ id: "q", name: "q.png", url: "qu" }] })[0].id).toBe("q");
    expect(collectAttachments({ selected_artwork: [{ id: "o", name: "o.png", url: "ou" }] })[0].id).toBe("o");
  });

  it("tolerates null / empty input", () => {
    expect(collectAttachments(null)).toEqual([]);
    expect(collectAttachments({})).toEqual([]);
  });
});
