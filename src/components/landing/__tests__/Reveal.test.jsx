// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";

const observers = [];

function fireAll() {
  observers.forEach((o) => o.cb([{ isIntersecting: true }]));
}

let Reveal;

beforeEach(async () => {
  observers.length = 0;
  class FakeIO {
    constructor(cb, opts) {
      this.cb = cb;
      this.rootMargin = opts?.rootMargin;
      observers.push(this);
    }
    observe() {}
    disconnect() {}
  }
  vi.stubGlobal("IntersectionObserver", FakeIO);
  vi.stubGlobal("matchMedia", (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  vi.resetModules();
  ({ default: Reveal } = await import("@/components/landing/Reveal.jsx"));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const opacityOf = (el) => el.style.opacity;

describe("Reveal", () => {
  it("starts hidden and lifted", () => {
    render(<Reveal><h3>Quotes &amp; Orders</h3></Reveal>);
    const wrap = screen.getByText("Quotes & Orders").parentElement;
    expect(opacityOf(wrap)).toBe("0");
    expect(wrap.style.transform).toContain("24px");
  });

  it("reveals when it reaches the viewport", async () => {
    render(<Reveal><h3>Quotes &amp; Orders</h3></Reveal>);
    const wrap = screen.getByText("Quotes & Orders").parentElement;

    await act(async () => { fireAll(); });

    // The whole point of the component: content that hides must come back.
    // A reveal that never fires leaves the page permanently blank, which is
    // strictly worse than no animation at all.
    expect(opacityOf(wrap)).toBe("1");
    expect(wrap.style.transform).toBe("none");
  });

  it("stays revealed once shown", async () => {
    render(<Reveal><h3>Quotes &amp; Orders</h3></Reveal>);
    const wrap = screen.getByText("Quotes & Orders").parentElement;
    await act(async () => { fireAll(); });
    await act(async () => { fireAll(); });
    expect(opacityOf(wrap)).toBe("1");
  });

  it("carries a stagger delay into the transition", () => {
    render(<Reveal delay={160}><h3>Shop Floor</h3></Reveal>);
    const wrap = screen.getByText("Shop Floor").parentElement;
    expect(wrap.style.transition).toContain("160ms");
  });

  it("renders visible immediately under prefers-reduced-motion", async () => {
    vi.stubGlobal("matchMedia", (q) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }));
    vi.resetModules();
    const { default: R } = await import("@/components/landing/Reveal.jsx");

    render(<R><h3>Broker Integration</h3></R>);
    const wrap = screen.getByText("Broker Integration").parentElement;

    // No observer, no transition, no hidden first paint.
    expect(opacityOf(wrap)).toBe("1");
    expect(wrap.style.transition).toBe("none");
    expect(observers.length).toBe(0);
  });

  it("falls back to geometry when the observer never fires", async () => {
    vi.useFakeTimers();
    try {
      render(<Reveal><h3>Inventory</h3></Reveal>);
      const wrap = screen.getByText("Inventory").parentElement;
      wrap.getBoundingClientRect = () => ({ top: 100, bottom: 400 });
      Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });

      expect(opacityOf(wrap)).toBe("0");
      await act(async () => { vi.advanceTimersByTime(900); });
      expect(opacityOf(wrap)).toBe("1");
    } finally {
      vi.useRealTimers();
    }
  });
});
