import React, { useEffect, useRef, useState } from "react";

// Reveal — fades and lifts an element the first time it reaches the viewport.
//
// Apple tags essentially every section of a product page with an animation
// group, so headings, copy and callouts all enter as you arrive rather than
// sitting there pre-drawn. That continuous low-level motion is most of why
// their pages feel alive between the big set-piece animations; the videos
// alone would not carry it.
//
// Deliberately CSS-transition based rather than JS-animated: the compositor
// handles opacity and transform on its own thread, so a page carrying several
// live demos does not also pay for reveal work on the main thread.

const REVEAL_MARGIN = "0px 0px -12% 0px";

function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function Reveal({
  children,
  delay = 0,
  distance = 24,
  as: Tag = "div",
  className = "",
  ...rest
}) {
  const ref = useRef(null);
  // Reduced motion must be known on the very first render, otherwise the
  // element paints hidden and then corrects itself — a flash of missing
  // content for exactly the people least able to tolerate it.
  const [reduced] = useState(prefersReducedMotion);
  const [shown, setShown] = useState(reduced);

  useEffect(() => {
    if (reduced || shown) return undefined;
    const el = ref.current;
    if (!el) return undefined;

    const show = () => setShown(true);

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          show();
          io.disconnect();
        }
      },
      { rootMargin: REVEAL_MARGIN },
    );
    io.observe(el);

    // Backstop, same reasoning as ScrollDemo: an observer that never fires
    // would leave the entire page invisible, which is a far worse failure
    // than simply showing the content.
    const poll = setInterval(() => {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.92 && r.bottom > 0) {
        clearInterval(poll);
        io.disconnect();
        show();
      }
    }, 400);

    return () => {
      clearInterval(poll);
      io.disconnect();
    };
  }, [reduced, shown]);

  return (
    <Tag
      ref={ref}
      className={className}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? "none" : `translate3d(0, ${distance}px, 0)`,
        transition: reduced
          ? "none"
          : `opacity 700ms cubic-bezier(0.22, 0.61, 0.36, 1) ${delay}ms, transform 700ms cubic-bezier(0.22, 0.61, 0.36, 1) ${delay}ms`,
        willChange: shown ? "auto" : "opacity, transform",
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

// CountUp — animates a number up to its value once on entry. Used for the
// stat figures; a number that ticks reads as live in a way a printed one
// never does.
export function CountUp({ to, prefix = "", suffix = "", duration = 1100, className = "", ...rest }) {
  const ref = useRef(null);
  const [reduced] = useState(prefersReducedMotion);
  const [value, setValue] = useState(reduced ? to : 0);
  const started = useRef(reduced);

  useEffect(() => {
    if (started.current) return undefined;
    const el = ref.current;
    if (!el) return undefined;
    let raf = null;

    const run = () => {
      if (started.current) return;
      started.current = true;
      const t0 = performance.now();
      const step = (now) => {
        const p = Math.min(1, (now - t0) / duration);
        // easeOutCubic — decelerates into the final figure
        setValue(Math.round(to * (1 - Math.pow(1 - p, 3))));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };

    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        run();
        io.disconnect();
      }
    });
    io.observe(el);

    const poll = setInterval(() => {
      if (started.current) { clearInterval(poll); return; }
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight && r.bottom > 0) {
        clearInterval(poll);
        io.disconnect();
        run();
      }
    }, 400);

    return () => {
      clearInterval(poll);
      io.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [to, duration]);

  return (
    <span ref={ref} className={className} {...rest}>
      {prefix}
      {value}
      {suffix}
    </span>
  );
}
