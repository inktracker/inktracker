import React, { useRef, useState, useLayoutEffect, useId } from "react";
import useScrollScrub, { range, easeInOutCubic } from "./useScrollScrub";

// StitchText — a needle embroiders the headline as the reader scrolls.
//
// The letterforms are drawn as a dashed stroke, so the thread lands as
// discrete stitches rather than a continuous line, and the visible length of
// that stroke is driven by scroll. The needle rides the leading edge, bobbing
// through the fabric on each stitch, with thread trailing back to the last
// one placed.
//
// Two mechanisms, because one cannot do both jobs. The dash pattern gives the
// thread its stitch structure; a clip rectangle drives how much of it exists
// yet. stroke-dashoffset alone only slides a repeating pattern along the path,
// so the word appears fully sewn from the first frame — which is exactly how
// the first attempt failed.

const THREAD = "#f2efe6";
const THREAD_SHADOW = "rgba(0,0,0,0.45)";

// Stitch geometry. The gap has to be a real fraction of the dash or the
// thread reads as one continuous outline — 9-on/5-off looked solid at
// headline size. 12-on/9-off resolves into separate stitches.
const STITCH = "12 9";

function Needle({ x, y, angle, threading, steel }) {
  return (
    <g
      transform={`translate(${x} ${y}) rotate(${angle}) scale(1.7)`}
      style={{ pointerEvents: "none" }}
      aria-hidden="true"
    >
      {/* thread running back up to the machine, slack varying with the bob */}
      <path
        d={`M 0 -6 C -14 ${-60 - threading * 26}, -70 ${-96 - threading * 34}, -190 -150`}
        stroke={THREAD}
        strokeWidth="1.6"
        fill="none"
        opacity="0.5"
        strokeLinecap="round"
      />
      {/* shaft */}
      <rect x="-2.6" y="-64" width="5.2" height="64" rx="2.6" fill={`url(#${steel})`} />
      {/* point */}
      <path d="M -2.6 0 L 0 11 L 2.6 0 Z" fill="#e9edf2" />
      {/* eye */}
      <ellipse cx="0" cy="-12" rx="1.5" ry="4" fill="#0d0d0f" opacity="0.85" />
      {/* shank collar */}
      <rect x="-4.2" y="-70" width="8.4" height="8" rx="2" fill="#9aa1a8" />
    </g>
  );
}

export default function StitchText({
  eyebrow = "Stitched in",
  headline,
  sub,
  height = "300vh",
}) {
  const track = useRef(null);
  const p = useScrollScrub(track);

  const sew = easeInOutCubic(range(p, 0.14, 0.86));

  // Measure the rendered glyphs so the needle rides the actual leading edge of
  // the lettering rather than a guessed span — the word's width depends on the
  // headline text and on whether the display face has loaded yet.
  const textRef = useRef(null);
  const clipId = useId().replace(/:/g, "");
  const [box, setBox] = useState({ x: 140, w: 720 });

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el || !el.getBBox) return undefined;
    const measure = () => {
      try {
        const b = el.getBBox();
        if (b.width > 0) setBox({ x: b.x, w: b.width });
      } catch { /* not laid out yet */ }
    };
    measure();
    // Re-measure once webfonts land; Anton arriving late changes the width.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure).catch(() => {});
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [headline]);

  // Leading edge of the stitching, and the needle riding it.
  const edge = box.x + sew * box.w;
  const bob = Math.abs(Math.sin(sew * Math.PI * 26));
  const ny = 236 - bob * 34;
  const angle = -6 + Math.sin(sew * Math.PI * 26) * 5;

  const fadeSub = range(p, 0.82, 0.95);

  return (
    <section ref={track} style={{ height, position: "relative" }} aria-label={headline}>
      <div
        style={{
          position: "sticky",
          top: 0,
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          // Garment behind the needle: a dark knit, so pale thread reads.
          backgroundColor: "#14211a",
          backgroundImage: `
            repeating-linear-gradient(45deg,  rgba(255,255,255,0.028) 0 2px, transparent 2px 5px),
            repeating-linear-gradient(-45deg, rgba(0,0,0,0.22) 0 2px, transparent 2px 5px),
            radial-gradient(120% 100% at 50% 45%, rgba(90,130,105,0.28), rgba(0,0,0,0.55))`,
        }}
      >
        <div style={{ width: "min(1100px, 94vw)" }}>
          <p
            style={{
              margin: "0 0 clamp(10px, 2vw, 22px)",
              color: "rgba(242,239,230,0.62)",
              fontSize: "clamp(10px, 1.1vw, 13px)",
              fontWeight: 700,
              letterSpacing: "0.28em",
              textTransform: "uppercase",
              fontFamily: '"Inter", system-ui, sans-serif',
              textAlign: "center",
            }}
          >
            {eyebrow}
          </p>

          <svg viewBox="0 0 1000 320" style={{ width: "100%", display: "block", overflow: "visible" }}>
            <defs>
              <linearGradient id={`steel-${clipId}`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#7d848b" />
                <stop offset="45%" stopColor="#eef2f6" />
                <stop offset="100%" stopColor="#6d747b" />
              </linearGradient>
              {/* How much of the lettering has been sewn. Generous vertical
                  bounds so ascenders and the stroke width are never cropped. */}
              <clipPath id={`sewn-${clipId}`}>
                <rect x="0" y="-40" width={edge} height="400" />
              </clipPath>
            </defs>

            <g clipPath={`url(#sewn-${clipId})`}>
              {/* Punched holes in the fabric, under the thread */}
              <text
              x="500"
              y="230"
              textAnchor="middle"
              fontFamily='"Anton", "Oswald", "Arial Narrow", sans-serif'
              fontSize="150"
              letterSpacing="2"
              fill="none"
              style={{ strokeDasharray: STITCH }}
                stroke="rgba(0,0,0,0.55)"
                strokeWidth="14"
              >
                {headline}
              </text>

              {/* Thread shadow, offset a hair to lift it off the knit */}
              <text
              x="500"
              y="230"
              textAnchor="middle"
              fontFamily='"Anton", "Oswald", "Arial Narrow", sans-serif'
              fontSize="150"
              letterSpacing="2"
              fill="none"
              style={{ strokeDasharray: STITCH }}
                stroke={THREAD_SHADOW}
                strokeWidth="12"
                strokeLinecap="round"
                transform="translate(1.5 3)"
              >
                {headline}
              </text>

              {/* The thread itself. This layer is measured — it is the one
                  whose glyph box the needle tracks. */}
              <text
                ref={textRef}
              x="500"
              y="230"
              textAnchor="middle"
              fontFamily='"Anton", "Oswald", "Arial Narrow", sans-serif'
              fontSize="150"
              letterSpacing="2"
              fill="none"
              style={{ strokeDasharray: STITCH }}
                stroke={THREAD}
                strokeWidth="10"
                strokeLinecap="round"
              >
                {headline}
              </text>
            </g>

            {/* Needle sits OUTSIDE the clip, on top, so it is never sliced by
                the reveal it is driving. */}
            {sew > 0.005 && sew < 0.995 ? (
              <Needle x={edge} y={ny} angle={angle} threading={bob} steel={`steel-${clipId}`} />
            ) : null}
          </svg>

          {sub ? (
            <p
              style={{
                margin: "clamp(14px, 2.6vw, 30px) auto 0",
                maxWidth: "52ch",
                textAlign: "center",
                color: "rgba(242,239,230,0.78)",
                fontFamily: '"Inter", system-ui, sans-serif',
                fontSize: "clamp(0.86rem, 1.5vw, 1.08rem)",
                lineHeight: 1.6,
                opacity: fadeSub,
                transform: `translate3d(0, ${(1 - fadeSub) * 14}px, 0)`,
                willChange: "opacity, transform",
              }}
            >
              {sub}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
