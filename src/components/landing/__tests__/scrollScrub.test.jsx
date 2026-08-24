// @vitest-environment jsdom
import React, { useRef } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";

let useScrollScrub, range, easeInOutCubic;

// Drives the shared rAF loop by hand so a test can step frames deterministically.
let frames = [];
function flushFrames(n = 1) {
  for (let i = 0; i < n; i += 1) {
    const due = frames;
    frames = [];
    due.forEach((cb) => cb(performance.now()));
  }
}

beforeEach(async () => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("matchMedia", (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
  vi.resetModules();
  ({ default: useScrollScrub, range, easeInOutCubic } = await import("@/components/landing/useScrollScrub.js"));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// A track 2700px tall in a 900px viewport has 1800px of scrubbable travel.
function Probe({ top }) {
  const ref = useRef(null);
  const p = useScrollScrub(ref);
  return (
    <div
      ref={(el) => {
        ref.current = el;
        if (el) el.getBoundingClientRect = () => ({ top, height: 2700 });
      }}
    >
      <span data-testid="p">{p.toFixed(3)}</span>
    </div>
  );
}

const read = () => Number(screen.getByTestId("p").textContent);

describe("useScrollScrub", () => {
  it("reports 0 before the track is reached", async () => {
    render(<Probe top={900} />);
    await act(async () => { flushFrames(); });
    expect(read()).toBe(0);
  });

  it("reports 1 once the track has fully passed", async () => {
    // top = -1800 means the whole scrubbable span is behind us.
    render(<Probe top={-1800} />);
    await act(async () => { flushFrames(); });
    expect(read()).toBe(1);
  });

  it("reports the midpoint halfway through the track", async () => {
    render(<Probe top={-900} />);
    await act(async () => { flushFrames(); });
    expect(read()).toBeCloseTo(0.5, 3);
  });

  it("clamps rather than overshooting past either end", async () => {
    const { rerender } = render(<Probe top={-99999} />);
    await act(async () => { flushFrames(); });
    expect(read()).toBe(1);
    rerender(<Probe top={99999} />);
    await act(async () => { flushFrames(); });
    expect(read()).toBe(0);
  });

  it("parks at the finished state under prefers-reduced-motion", async () => {
    vi.stubGlobal("matchMedia", (q) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }));
    vi.resetModules();
    const mod = await import("@/components/landing/useScrollScrub.js");
    const Hook = () => {
      const ref = useRef(null);
      // eslint-disable-next-line react-hooks/rules-of-hooks
      return <span data-testid="p">{mod.default(ref).toFixed(3)}</span>;
    };
    render(<Hook />);
    // Reduced motion must show the piece completed, not blank: the copy is
    // inside the animation, so parking at 0 would hide real content.
    expect(read()).toBe(1);
  });

  it("shares one rAF loop across many subscribers", async () => {
    render(
      <>
        <Probe top={-900} />
        <Probe top={-900} />
        <Probe top={-900} />
      </>,
    );
    // Three components, but the loop schedules a single frame at a time —
    // per-component loops are how a scroll page ends up thrashing layout.
    expect(frames.length).toBeLessThanOrEqual(1);
  });
});

describe("range / easing", () => {
  it("maps a sub-range onto 0..1 and clamps outside it", () => {
    expect(range(0.05, 0.12, 0.82)).toBe(0);
    expect(range(0.9, 0.12, 0.82)).toBe(1);
    expect(range(0.47, 0.12, 0.82)).toBeCloseTo(0.5, 2);
  });

  it("handles a zero-width range without dividing by zero", () => {
    expect(Number.isNaN(range(0.5, 0.3, 0.3))).toBe(false);
  });

  it("eases from 0 to 1 monotonically", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    let prev = -1;
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const v = easeInOutCubic(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});
