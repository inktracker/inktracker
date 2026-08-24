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

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        Promise.all([import("./anim/engine.jsx"), load()]).then(([engine, scene]) => {
          if (cancelled) return;
          setMod({ Stage: engine.Stage, Scene: scene[componentName] || scene.default });
        });
      },
      { rootMargin: PRELOAD_MARGIN },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [load, componentName, mod]);

  // Stage 2 — play once, when it is genuinely on screen.
  useEffect(() => {
    const el = slotRef.current;
    if (!el || !mod) return undefined;

    // Reduced motion: never animate. Sit on the final composed frame, which
    // is the most informative single image of the demo anyway.
    if (reduced) {
      hasPlayed.current = true;
      setEnded(true);
      return undefined;
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        if (hasPlayed.current) return;
        hasPlayed.current = true;
        setPlaying(true);
        io.disconnect();
      },
      { rootMargin: PLAY_MARGIN },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [mod, reduced]);

  const handleEnded = () => {
    setPlaying(false);
    setEnded(true);
  };

  const replay = () => {
    setEnded(false);
    setReplayNonce((n) => n + 1);
    setPlaying(true);
  };

  // Reduced motion pins the playhead at the end; otherwise the Stage owns it.
  const stagePlaying = reduced ? false : playing;

  return (
    <div className={`relative w-full overflow-hidden rounded-2xl bg-black ${className}`} style={{ aspectRatio: `${width} / ${height}` }}>
      <div ref={slotRef} className="absolute inset-0">
        {mod ? (
          <mod.Stage
            width={width}
            height={height}
            duration={duration}
            background={background}
            autoplay={false}
            loop={false}
            persist={false}
            keyboard={false}
            playing={stagePlaying}
            seekNonce={reduced ? 0 : replayNonce}
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
      ) : null}
    </div>
  );
}
