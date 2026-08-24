// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup, waitFor } from "@testing-library/react";

// The Stage engine is replaced with a probe so these tests assert ScrollDemo's
// choreography (when it loads, when it plays, when it settles) rather than
// re-testing the animation engine. The probe records the props it receives and
// exposes the onEnded callback so a test can simulate the demo finishing.
const stageProps = [];
let lastOnEnded = null;

vi.mock("@/components/landing/anim/engine.jsx", () => ({
  Stage: (props) => {
    stageProps.push(props);
    lastOnEnded = props.onEnded;
    return <div data-testid="stage">{props.children}</div>;
  },
}));

const sceneLoad = vi.fn(() => Promise.resolve({ QuoteDemo: () => <div data-testid="scene" /> }));

// Controllable IntersectionObserver. Observers are keyed by rootMargin so a
// test can fire the preload observer and the play observer independently.
const observers = new Map();

function fire(rootMargin) {
  const o = observers.get(rootMargin);
  if (!o) throw new Error(`no observer registered for rootMargin ${rootMargin}`);
  o.cb([{ isIntersecting: true }]);
}

const PRELOAD = "200% 0px";
const PLAY = "-12% 0px";

let ScrollDemo;

beforeEach(async () => {
  stageProps.length = 0;
  lastOnEnded = null;
  observers.clear();
  sceneLoad.mockClear();

  class FakeIO {
    constructor(cb, opts) {
      this.cb = cb;
      observers.set(opts?.rootMargin, this);
    }
    observe() {}
    disconnect() {}
  }
  vi.stubGlobal("IntersectionObserver", FakeIO);
  vi.stubGlobal("matchMedia", (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));

  ({ default: ScrollDemo } = await import("@/components/landing/ScrollDemo.jsx"));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderDemo() {
  return render(
    <ScrollDemo load={sceneLoad} component="QuoteDemo" duration={26.5} label="Writing a quote" />,
  );
}

describe("ScrollDemo", () => {
  it("does not load the scene chunk until the slot is approached", () => {
    renderDemo();
    // The slot must reserve its space immediately so the page never shifts,
    // but nothing heavy may be fetched yet.
    expect(sceneLoad).not.toHaveBeenCalled();
    expect(screen.queryByTestId("stage")).toBeNull();
  });

  it("loads the chunk when within the preload window, still paused", async () => {
    renderDemo();
    await act(async () => { fire(PRELOAD); });

    expect(sceneLoad).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId("stage")).toBeTruthy());

    // Mounted but held on the first frame — this is the "startframe" state.
    const p = stageProps.at(-1);
    expect(p.playing).toBe(false);
    expect(p.autoplay).toBe(false);
    expect(p.loop).toBe(false);
  });

  it("plays exactly once when the slot is actually on screen", async () => {
    renderDemo();
    await act(async () => { fire(PRELOAD); });
    await waitFor(() => expect(screen.getByTestId("stage")).toBeTruthy());

    await act(async () => { fire(PLAY); });
    expect(stageProps.at(-1).playing).toBe(true);

    // Finishing settles on the final frame and never auto-replays.
    await act(async () => { lastOnEnded(); });
    expect(stageProps.at(-1).playing).toBe(false);

    // Re-entering the viewport must not restart it.
    await act(async () => { fire(PLAY); });
    expect(stageProps.at(-1).playing).toBe(false);
  });

  it("offers a replay control only after it has settled", async () => {
    renderDemo();
    await act(async () => { fire(PRELOAD); });
    await waitFor(() => expect(screen.getByTestId("stage")).toBeTruthy());

    expect(screen.queryByLabelText(/replay/i)).toBeNull();

    await act(async () => { fire(PLAY); });
    await act(async () => { lastOnEnded(); });

    const btn = screen.getByLabelText(/replay writing a quote animation/i);
    await act(async () => { btn.click(); });

    const p = stageProps.at(-1);
    expect(p.playing).toBe(true);
    expect(p.seekNonce).toBe(1); // rewound to t=0
  });

  it("never animates under prefers-reduced-motion, and holds the end frame", async () => {
    vi.stubGlobal("matchMedia", (q) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }));
    vi.resetModules();
    ({ default: ScrollDemo } = await import("@/components/landing/ScrollDemo.jsx"));

    renderDemo();
    await act(async () => { fire(PRELOAD); });
    await waitFor(() => expect(screen.getByTestId("stage")).toBeTruthy());

    // Nothing auto-plays: no play observer is registered at all.
    expect(observers.has(PLAY)).toBe(false);
    expect(stageProps.at(-1).playing).toBe(false);

    // But the demo must not look broken. Reduced motion gets an explicit,
    // unmissable Play control rather than the corner replay glyph — the old
    // behaviour (silently hold the end frame) was indistinguishable from the
    // feature failing to load.
    const play = screen.getByRole("button", { name: /play writing a quote/i });
    expect(play).toBeTruthy();
    expect(screen.queryByLabelText(/replay/i)).toBeNull();

    // And opting in actually animates.
    await act(async () => { play.click(); });
    expect(stageProps.at(-1).playing).toBe(true);
  });
});
