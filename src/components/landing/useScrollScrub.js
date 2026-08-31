import { useEffect, useRef, useState } from "react";

// useScrollScrub — maps a tall "track" element's position to 0..1 progress.
//
// The pattern is a tall track wrapping a sticky panel: the panel pins to the
// viewport while the track scrolls past behind it, and progress reports how
// far through that pin you are. The reader's scroll IS the animation timeline,
// which is what separates a set piece that feels physical from a video that
// happens to autoplay.
//
// Every subscriber shares ONE passive scroll listener and ONE rAF loop.
// Per-component listeners are how scroll pages die: each one reads layout,
// and n components reading layout on every scroll event is n forced reflows
// per frame. Here layout is read once per frame for everyone.

const subscribers = new Set();
let running = false;
let frame = null;

function tick() {
  frame = null;
  // Read every subscriber's geometry in one batch, then write. Interleaving
  // reads and writes here would reintroduce the thrash this exists to avoid.
  const reads = [];
  subscribers.forEach((s) => {
    const el = s.ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    reads.push([s, rect]);
  });

  const vh = window.innerHeight || 1;
  reads.forEach(([s, rect]) => {
    // Distance scrolled into the track, over the track's scrubbable length.
    const span = Math.max(1, rect.height - vh);
    const raw = -rect.top / span;
    const p = raw < 0 ? 0 : raw > 1 ? 1 : raw;
    if (Math.abs(p - s.last) > 0.0005) {
      s.last = p;
      s.set(p);
    }
  });

  if (subscribers.size > 0) schedule();
  else running = false;
}

function schedule() {
  if (frame != null) return;
  frame = requestAnimationFrame(tick);
}

function start() {
  if (running) return;
  running = true;
  schedule();
}

function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function useScrollScrub(ref) {
  // Reduced motion parks the piece at its finished state: fully squeegeed,
  // fully stitched. The information is the point; the motion is the delivery.
  const [reduced] = useState(prefersReducedMotion);
  const [progress, setProgress] = useState(reduced ? 1 : 0);
  const sub = useRef(null);

  useEffect(() => {
    if (reduced) return undefined;
    const s = { ref, set: setProgress, last: -1 };
    sub.current = s;
    subscribers.add(s);

    const onScroll = () => schedule();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    start();

    return () => {
      subscribers.delete(s);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [ref, reduced]);

  return progress;
}

// Maps progress onto a sub-range, so several things can be choreographed
// against one scrub: the squeegee travels over 0.1-0.8, the ink dries after.
export function range(p, from, to) {
  if (to === from) return p >= to ? 1 : 0;
  const v = (p - from) / (to - from);
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
