import { describe, it, expect } from "vitest";
import { anonEdgeResult } from "../anonEdge";

describe("anonEdgeResult — the anon-page invoke contract", () => {
  it("surfaces the (already-humanized) error.message on an infra failure", () => {
    const r = anonEdgeResult({ data: null, error: new Error("Too many requests. Please slow down.") });
    expect(r.data).toBeNull();
    expect(r.message).toBe("Too many requests. Please slow down.");
  });

  it("surfaces the handler's { error } body", () => {
    const r = anonEdgeResult({ data: { error: "This quote link has expired." }, error: null });
    expect(r.data).toBeNull();
    expect(r.message).toBe("This quote link has expired.");
  });

  it("null data with no error still reads as failure (never false success)", () => {
    const r = anonEdgeResult({ data: null, error: null }, "fallback copy");
    expect(r.data).toBeNull();
    expect(r.message).toBe("fallback copy");
  });

  it("passes a real payload through with message null", () => {
    const r = anonEdgeResult({ data: { quote: { id: "q1" } }, error: null });
    expect(r.message).toBeNull();
    expect(r.data.quote.id).toBe("q1");
  });

  it("empty error.message falls back to designed copy, never blank", () => {
    const err = new Error("");
    const r = anonEdgeResult({ data: null, error: err }, "designed fallback");
    expect(r.message).toBe("designed fallback");
  });

  it("handles a fully absent response", () => {
    const r = anonEdgeResult(undefined, "fb");
    expect(r).toEqual({ data: null, message: "fb" });
  });
});
