import React, { useEffect, useRef, useState } from "react";

// ScrollDemo — plays one coded product demo inline on the landing page,
// using the choreography Apple's product pages use for their startframe →
// video → endframe sandwiches:
//
//   1. Reserve the slot immediately (no layout shift), render nothing heavy.
//   2. Within ~2 viewports, lazy-load the scene chunk so it is decoded and
//      ready before the reader arrives. (Apple: load-keyframe "t - 200vh".)
//   3. Mounted but paused at t=0 — the demo reads as a still screenshot.
//   4. Once actually on screen, play through exactly once.
//   5. Hold the final frame. It reads as a still screenshot again.
//
// The difference from Apple is that our "film" stays live DOM rather than an
// encoded video: these demos are rendered UI, so keeping them as DOM means
// crisp at any DPI, responsive at any width, and no re-encode when a scene
// is edited.

const PRELOAD_MARGIN = "200% 0px"; // ≈ Apple's "t - 200vh" load window
const PLAY_MARGIN = "-12% 0px"; // wait until it's meaningfully on screen

function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function ScrollDemo({
  load,
  component: componentName = "default",
  duration,
  clipStart = 0,
  clipEnd = null,
  width = 1920,
  height = 1080,
  background = "#0B0B0E",
  label,
  className = "",
}) {
  const slotRef = useRef(null);
  // Engine and scene are fetched together inside the lazy boundary. Importing
  // Stage statically would drag the whole animation engine into the main
  // landing bundle for every visitor, including those who never scroll here.
  const [mod, setMod] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [replayNonce, setReplayNonce] = useState(0);
  const hasPlayed = useRef(false);
  // Lazy initializer, not an effect: this is read during the first render to
  // decide whether to animate at all, so it has to be right immediately.
  const [reduced] = useState(prefersReducedMotion);

  // Stage 1 — lazy-load the scene chunk well before it is needed.
  useEffect(() => {
    const el = slotRef.current;
    if (!el || mod) return undefined;
    let cancelled = false;

    const arm = () => {
      Promise.all([import("./anim/engine.jsx"), load()]).then(([engine, scene]) => {
        if (cancelled) return;
        setMod({ Stage: engine.Stage, Scene: scene[componentName] || scene.default });
      });
    };

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        arm();
      },
      { rootMargin: PRELOAD_MARGIN },
    );
    io.observe(el);

    // Safety net. The entire feature is observer-gated, so anything that stops
    // the observer firing — no support, a stalled compositor, a background tab
    // that never composites — would otherwise leave a permanently dead black
    // box on the page. Poll the geometry directly as a backstop.
    const poll = setInterval(() => {
      const r = el.getBoundingClientRect();
      const reach = window.innerHeight * 3;
      if (r.top < reach && r.bottom > -reach) {
        clearInterval(poll);
        io.disconnect();
        arm();
      }
    }, 400);

    return () => {
      cancelled = true;
      clearInterval(poll);
      io.disconnect();
    };
  }, [load, componentName, mod]);

  // Stage 2 — play once, when it is genuinely on screen.
  useEffect(() => {
    const el = slotRef.current;
    if (!el || !mod) return undefined;

    // Reduced motion used to mean "never animate", which rendered the whole
    // feature invisible — indistinguishable from the thing being broken. It
    // now still presents the demo, just without auto-playing it, behind an
    // unmissable control rather than a 36px corner button.
    if (reduced) {
      setEnded(true);
      return undefined;
    }

    const start = () => {
      if (hasPlayed.current) return;
      hasPlayed.current = true;
      setPlaying(true);
    };

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        start();
        io.disconnect();
      },
      { rootMargin: PLAY_MARGIN },
    );
    io.observe(el);

    const poll = setInterval(() => {
      if (hasPlayed.current) { clearInterval(poll); return; }
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.88 && r.bottom > 0) {
        clearInterval(poll);
        io.disconnect();
        start();
      }
    }, 400);

    return () => { clearInterval(poll); io.disconnect(); };
  }, [mod, reduced]);

  const handleEnded = () => {
    setPlaying(false);
    setEnded(true);
  };

  const replay = () => {
    hasPlayed.current = true;
    setEnded(false);
    setReplayNonce((n) => n + 1);
    setPlaying(true);
  };

  const stagePlaying = playing;
  // Under reduced motion nothing has auto-played, so the affordance is a real
  // Play control, not a corner replay glyph.
  const awaitingManualStart = reduced && !hasPlayed.current;

  return (
    <div className={`relative w-full overflow-hidden rounded-2xl bg-black ${className}`} style={{ aspectRatio: `${width} / ${height}` }}>
      <div ref={slotRef} className="absolute inset-0">
        {mod ? (
          <mod.Stage
            width={width}
            height={height}
            duration={duration}
            clipStart={clipStart}
            clipEnd={clipEnd}
            background={background}
            autoplay={false}
            loop={false}
            persist={false}
            keyboard={false}
            playing={stagePlaying}
            seekNonce={replayNonce}
            onEnded={handleEnded}
          >
            <mod.Scene />
          </mod.Stage>
        ) : (
          // Slot holder before the chunk lands. Matches the stage background
          // so the demo fades in rather than popping against a light page.
          <div className="absolute inset-0" style={{ background }} />
        )}
      </div>

      {/* Apple ships a manual control on every animation ("Play iPad features
          animation"). Same idea: once it has settled, let the reader replay. */}
      {ended ? (
        awaitingManualStart ? (
          // Reduced motion: an unmissable control, so the demo reads as
          // something you can play rather than something that is broken.
          <button
            type="button"
            onClick={replay}
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/45 text-white backdrop-blur-[2px] transition hover:bg-black/55 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-white/80">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
            <span className="text-[11px] font-bold uppercase tracking-[0.22em]">Play {label}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={replay}
            aria-label={`Replay ${label} animation`}
            className="absolute bottom-3 right-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur transition hover:bg-black/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <path d="M3 4v5h5" />
            </svg>
          </button>
        )
      ) : null}
    </div>
  );
}
