import { describe, it, expect } from "vitest";
import { mergeContentHits } from "../mergeContentHits";

const rpc = [
  { kind: "quote", id: "q1", doc_id: "Q-2026-AAAA", job_title: "Fall Hoodies", customer_name: "Jane" },
  { kind: "quote", id: "q2", doc_id: "Q-2026-BBBB", job_title: "Spring Tees", customer_name: "Bob" },
  { kind: "order", id: "o1", doc_id: "ORD-2026-CCCC", job_title: "Caps", customer_name: "Ann" },
];

describe("mergeContentHits", () => {
  it("appends content hits of the right kind after column matches", () => {
    const merged = mergeContentHits([{ id: "qX", quote_id: "Q-2026-XXXX" }], rpc, "quote", "quote_id");
    expect(merged.map((r) => r.id)).toEqual(["qX", "q1", "q2"]);
    expect(merged[1].quote_id).toBe("Q-2026-AAAA");
    expect(merged[1]._contentHit).toBe(true);
  });

  it("never duplicates a row both searches found", () => {
    const merged = mergeContentHits([{ id: "q1", quote_id: "Q-2026-AAAA" }], rpc, "quote", "quote_id");
    expect(merged.filter((r) => r.id === "q1")).toHaveLength(1);
    expect(merged[0]._contentHit).toBeUndefined();
  });

  it("filters by kind and tolerates junk", () => {
    const merged = mergeContentHits([], rpc, "order", "order_id");
    expect(merged).toHaveLength(1);
    expect(merged[0].order_id).toBe("ORD-2026-CCCC");
    expect(mergeContentHits(null, null, "quote", "quote_id")).toEqual([]);
  });

  it("caps the combined list", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ kind: "quote", id: `q${i}`, doc_id: `Q-${i}` }));
    expect(mergeContentHits([], many, "quote", "quote_id")).toHaveLength(7);
  });
});
