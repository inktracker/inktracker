// Undo stack for the Account → Pricing editor (tester note 2026-07-18:
// "Add an undo button as your working with pricing changes").
//
// Pure state-machine half of the feature so it's unit-testable; the
// component half is a useEffect that calls recordChange(history,
// config, Date.now()) whenever the config state changes, and an Undo
// button that applies undoTo()'s snapshot back into state.
//
// Design points:
// - Snapshots are the immutable config objects themselves (every
//   editor handler already produces a fresh object via setConfig) —
//   no cloning needed.
// - Rapid successive changes (typing digits into a NumericInput fires
//   one change per keystroke) COALESCE: pushes closer together than
//   `coalesceMs` keep the pre-burst snapshot on the stack instead of
//   recording every keystroke, so one Undo steps back a whole edit.
// - recordChange is idempotent for the same snapshot (React StrictMode
//   double-invokes effects in dev).
// - Restoring via undo must not itself count as an edit — undoTo marks
//   the history so the next recordChange skips the push.

export function createUndoHistory({ limit = 100, coalesceMs = 800 } = {}) {
  return {
    stack: [],
    last: null,
    lastPushAt: 0,
    restoring: false,
    limit,
    coalesceMs,
  };
}

/**
 * Register the current snapshot after a state change. Returns the
 * undo depth (stack size) for the button's enabled state.
 */
export function recordChange(history, snapshot, now) {
  if (snapshot == null) return history.stack.length;
  if (history.restoring) {
    history.restoring = false;
    history.last = snapshot;
    return history.stack.length;
  }
  if (history.last != null && history.last !== snapshot) {
    if (now - history.lastPushAt > history.coalesceMs) {
      history.stack.push(history.last);
      if (history.stack.length > history.limit) history.stack.shift();
    }
    // Even a coalesced (skipped) push advances the clock, so a long
    // typing burst stays one undo step until the user pauses.
    history.lastPushAt = now;
  }
  history.last = snapshot;
  return history.stack.length;
}

/** Pop the previous snapshot to restore, or null when nothing to undo. */
export function undoTo(history) {
  const prev = history.stack.pop();
  if (prev == null) return null;
  history.restoring = true;
  return prev;
}
