// Pure phase machine for the landing-page typewriter. Extracted so the
// state transitions can be unit-tested without rendering React.
//
// The component owns the timing constants (KEY/PAUSE/HOLD/FADE ms) and
// just calls advanceTypewriter() each tick to decide what to render
// next and which timer kind to schedule.

export const TYPEWRITER_LINES = Object.freeze([
  "Run your print shop",
  "without the chaos.",
]);

export const INITIAL_STATE = Object.freeze({
  phase: "line1",
  line1: 0,
  line2: 0,
});

/**
 * Compute the next typewriter state given the current state.
 *
 * @param {{phase: 'line1'|'line2'|'done'|'fading'|'gone',
 *          line1: number, line2: number}} state
 * @param {readonly [string, string]} lines
 * @returns {{phase, line1, line2, next: 'key'|'pause'|'hold'|'fade'|'none', reveal: boolean}}
 *   - `next` tells the component which timer kind to schedule before the
 *     next call; `'none'` means the machine has terminated.
 *   - `reveal` is true exactly once, on the transition into 'gone' —
 *     i.e. after the slow fade-out has fully completed and the
 *     typewriter is about to unmount. The host fades the rest of the
 *     hero in *sequentially*, so no empty slot remains where the
 *     headline used to sit.
 */
export function advanceTypewriter(state, lines = TYPEWRITER_LINES) {
  const { phase, line1, line2 } = state;

  if (phase === "line1") {
    if (line1 < lines[0].length) {
      return { phase: "line1", line1: line1 + 1, line2, next: "key", reveal: false };
    }
    return { phase: "line2", line1, line2, next: "pause", reveal: false };
  }
  if (phase === "line2") {
    if (line2 < lines[1].length) {
      return { phase: "line2", line1, line2: line2 + 1, next: "key", reveal: false };
    }
    return { phase: "done", line1, line2, next: "hold", reveal: false };
  }
  if (phase === "done") {
    return { phase: "fading", line1, line2, next: "fade", reveal: false };
  }
  if (phase === "fading") {
    return { phase: "gone", line1, line2, next: "none", reveal: true };
  }
  return { phase: "gone", line1, line2, next: "none", reveal: false };
}
