import { describe, it, expect } from "vitest";
import {
  TYPEWRITER_LINES,
  INITIAL_STATE,
  advanceTypewriter,
} from "../typewriter";

const [LINE1, LINE2] = TYPEWRITER_LINES;

/**
 * Repeatedly call advanceTypewriter, feeding its output back in, until
 * the machine terminates (next === 'none'). Returns the ordered list of
 * steps so tests can make assertions about the trajectory.
 */
function runToCompletion(start = INITIAL_STATE, maxSteps = 500) {
  const steps = [];
  let state = start;
  for (let i = 0; i < maxSteps; i++) {
    const step = advanceTypewriter(state);
    steps.push(step);
    if (step.next === "none") return steps;
    // Drop computed fields when feeding back in — the helper only reads
    // phase/line1/line2 from its input.
    state = { phase: step.phase, line1: step.line1, line2: step.line2 };
  }
  throw new Error("typewriter machine did not terminate within maxSteps");
}

describe("typewriter copy", () => {
  it("exposes the two-line headline used by the hero", () => {
    expect(TYPEWRITER_LINES).toEqual([
      "Run your print shop",
      "without the chaos.",
    ]);
  });

  it("starts the machine in the line1 phase with nothing typed", () => {
    expect(INITIAL_STATE).toEqual({ phase: "line1", line1: 0, line2: 0 });
  });
});

describe("advanceTypewriter — line1 typing", () => {
  it("advances one character at a time while line1 is being typed", () => {
    const step = advanceTypewriter({ phase: "line1", line1: 0, line2: 0 });
    expect(step).toMatchObject({
      phase: "line1",
      line1: 1,
      line2: 0,
      next: "key",
      reveal: false,
    });
  });

  it("transitions to line2 with a 'pause' timer once line1 is fully typed", () => {
    const step = advanceTypewriter({
      phase: "line1",
      line1: LINE1.length,
      line2: 0,
    });
    expect(step.phase).toBe("line2");
    expect(step.line1).toBe(LINE1.length);
    expect(step.line2).toBe(0); // typing line2 hasn't started yet
    expect(step.next).toBe("pause");
    expect(step.reveal).toBe(false);
  });
});

describe("advanceTypewriter — line2 typing", () => {
  it("advances one character at a time while line2 is being typed", () => {
    const step = advanceTypewriter({
      phase: "line2",
      line1: LINE1.length,
      line2: 5,
    });
    expect(step).toMatchObject({
      phase: "line2",
      line2: 6,
      next: "key",
      reveal: false,
    });
  });

  it("transitions to 'done' with a 'hold' timer once line2 is fully typed", () => {
    const step = advanceTypewriter({
      phase: "line2",
      line1: LINE1.length,
      line2: LINE2.length,
    });
    expect(step.phase).toBe("done");
    expect(step.next).toBe("hold");
    expect(step.reveal).toBe(false);
  });
});

describe("advanceTypewriter — fade-out and reveal handoff", () => {
  it("transitions done → fading without yet firing reveal (the slow fade is still running)", () => {
    const step = advanceTypewriter({
      phase: "done",
      line1: LINE1.length,
      line2: LINE2.length,
    });
    expect(step.phase).toBe("fading");
    expect(step.next).toBe("fade");
    expect(step.reveal).toBe(false);
  });

  it("emits reveal=true exactly when fading → gone — the host then fades the rest of the hero in", () => {
    const step = advanceTypewriter({
      phase: "fading",
      line1: LINE1.length,
      line2: LINE2.length,
    });
    expect(step.phase).toBe("gone");
    expect(step.next).toBe("none");
    expect(step.reveal).toBe(true);
  });

  it("'gone' is terminal — further calls keep next='none' and never re-fire reveal", () => {
    const step = advanceTypewriter({
      phase: "gone",
      line1: LINE1.length,
      line2: LINE2.length,
    });
    expect(step.phase).toBe("gone");
    expect(step.next).toBe("none");
    expect(step.reveal).toBe(false);
  });
});

describe("advanceTypewriter — full trajectory", () => {
  const steps = runToCompletion();

  it("eventually terminates", () => {
    expect(steps[steps.length - 1].next).toBe("none");
    expect(steps[steps.length - 1].phase).toBe("gone");
  });

  it("visits every phase exactly in order: line1 → line2 → done → fading → gone", () => {
    const phasesSeen = [];
    for (const s of steps) {
      if (phasesSeen[phasesSeen.length - 1] !== s.phase) phasesSeen.push(s.phase);
    }
    expect(phasesSeen).toEqual(["line1", "line2", "done", "fading", "gone"]);
  });

  it("uses LINE1.length 'key' ticks to type line1 (one per character)", () => {
    const keyTicksLine1 = steps.filter(
      (s) => s.phase === "line1" && s.next === "key"
    ).length;
    expect(keyTicksLine1).toBe(LINE1.length);
  });

  it("uses LINE2.length 'key' ticks to type line2 (one per character)", () => {
    const keyTicksLine2 = steps.filter(
      (s) => s.phase === "line2" && s.next === "key" && s.line2 > 0
    ).length;
    expect(keyTicksLine2).toBe(LINE2.length);
  });

  it("fires the reveal flag exactly once across the full trajectory, after the fade-out completes", () => {
    const revealEvents = steps.filter((s) => s.reveal);
    expect(revealEvents).toHaveLength(1);
    // Reveal must fire on the transition INTO 'gone', so the rest of
    // the hero only starts fading in once the typewriter has fully
    // faded out and is about to unmount.
    expect(revealEvents[0].phase).toBe("gone");
  });

  it("schedules a single 'hold' timer between done and fading", () => {
    const holds = steps.filter((s) => s.next === "hold");
    expect(holds).toHaveLength(1);
    expect(holds[0].phase).toBe("done");
  });

  it("schedules a single 'fade' timer between fading and gone", () => {
    const fades = steps.filter((s) => s.next === "fade");
    expect(fades).toHaveLength(1);
    expect(fades[0].phase).toBe("fading");
  });

  it("schedules a single 'pause' timer between line1 and line2", () => {
    const pauses = steps.filter((s) => s.next === "pause");
    expect(pauses).toHaveLength(1);
    expect(pauses[0].phase).toBe("line2");
    expect(pauses[0].line2).toBe(0);
  });
});

describe("advanceTypewriter — invariants", () => {
  it("never mutates the input state", () => {
    const input = { phase: "line1", line1: 3, line2: 0 };
    const snapshot = { ...input };
    advanceTypewriter(input);
    expect(input).toEqual(snapshot);
  });

  it("never decreases typed-character counters", () => {
    const steps = runToCompletion();
    let prev = { line1: 0, line2: 0 };
    for (const s of steps) {
      expect(s.line1).toBeGreaterThanOrEqual(prev.line1);
      expect(s.line2).toBeGreaterThanOrEqual(prev.line2);
      prev = { line1: s.line1, line2: s.line2 };
    }
  });
});
