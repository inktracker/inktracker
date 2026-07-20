import { describe, it, expect } from "vitest";
import { createUndoHistory, recordChange, undoTo } from "../undoHistory";

const A = { v: "a" };
const B = { v: "b" };
const C = { v: "c" };

describe("undoHistory", () => {
  it("first snapshot establishes a baseline without pushing", () => {
    const h = createUndoHistory();
    expect(recordChange(h, A, 1000)).toBe(0);
    expect(undoTo(h)).toBeNull();
  });

  it("a change pushes the prior snapshot; undo restores it", () => {
    const h = createUndoHistory();
    recordChange(h, A, 1000);
    expect(recordChange(h, B, 2000)).toBe(1);
    expect(undoTo(h)).toBe(A);
  });

  it("same snapshot twice is idempotent (StrictMode double effect)", () => {
    const h = createUndoHistory();
    recordChange(h, A, 1000);
    recordChange(h, B, 2000);
    expect(recordChange(h, B, 2001)).toBe(1);
  });

  it("rapid changes coalesce into one undo step back to the pre-burst state", () => {
    const h = createUndoHistory({ coalesceMs: 800 });
    recordChange(h, A, 1000);
    recordChange(h, B, 2000); // pushes A
    recordChange(h, C, 2100); // within 800ms — coalesced, no push
    expect(h.stack.length).toBe(1);
    expect(undoTo(h)).toBe(A);
  });

  it("a long typing burst stays one step until the user pauses", () => {
    const h = createUndoHistory({ coalesceMs: 800 });
    recordChange(h, A, 1000);
    let t = 2000;
    let snap = A;
    // 10 keystrokes 100ms apart — every push after the first coalesces
    // because each change advances the clock.
    for (let i = 0; i < 10; i++) {
      snap = { v: `k${i}` };
      recordChange(h, snap, (t += 100));
    }
    expect(h.stack.length).toBe(1);
    // Pause, then a new edit starts a second step.
    recordChange(h, B, t + 2000);
    expect(h.stack.length).toBe(2);
  });

  it("restoring via undo does not record itself as an edit", () => {
    const h = createUndoHistory();
    recordChange(h, A, 1000);
    recordChange(h, B, 2000);
    const prev = undoTo(h);
    // The component sets state to `prev`, which re-fires the effect:
    expect(recordChange(h, prev, 3000)).toBe(0);
    // A fresh edit after the undo records against the restored state.
    recordChange(h, C, 4000);
    expect(undoTo(h)).toBe(A);
  });

  it("stack is capped at the limit (oldest dropped)", () => {
    const h = createUndoHistory({ limit: 3, coalesceMs: 0 });
    let t = 1000;
    recordChange(h, { v: 0 }, t);
    for (let i = 1; i <= 5; i++) recordChange(h, { v: i }, (t += 1000));
    expect(h.stack.length).toBe(3);
    expect(h.stack[0]).toEqual({ v: 2 });
  });

  it("null snapshots are ignored", () => {
    const h = createUndoHistory();
    recordChange(h, A, 1000);
    expect(recordChange(h, null, 2000)).toBe(0);
    expect(h.last).toBe(A);
  });
});
