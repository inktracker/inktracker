import React, { useRef } from "react";
import useScrollScrub, { range, easeInOutCubic } from "./useScrollScrub";

// SqueegeePull — a squeegee stroke driven by the reader's scroll. Ink lands
// behind the blade, so the copy is literally printed onto the garment as you
// pull down the page.
//
// The whole piece is transform + clip-path only. Both are compositor
// properties, so the stroke stays smooth while live demos run elsewhere on
// the page; animating width or left here would force layout every frame.

const INK = "#0e0e0e";
const FOREST = "#2c5840";

// Halftone. Screen print at this scale shows its dot structure, and a flat
// fill reads as vinyl rather than plastisol. Two offset dot grids at low
// opacity give the ink a printed tooth without a texture download.
const HALFTONE =
  "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.14) 0.7px, transparent 0.8px)";

function Squeegee({ x, tilt, pressure }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        top: "-12%",
        // Travel is driven by `left`, which resolves against the PARENT, not
        // by a percentage translate, which resolves against the element's own
        // 190px width — that bug pinned the blade to the far left and made the
        // stroke look broken while the ink kept advancing without it.
        left: `${x}%`,
        height: "124%",
        width: 190,
        transform: `translate3d(-95px, 0, 0) rotate(${tilt}deg)`,
        transformOrigin: "50% 40%",
        willChange: "transform",
        pointerEvents: "none",
        zIndex: 4,
      }}
    >
      {/* Ink bead riding ahead of the blade — the roll of wet ink the blade
          pushes along. It swells slightly with pressure. */}
      <div
        style={{
          position: "absolute",
          left: 92,
          top: "6%",
          height: "88%",
          width: 16 + pressure * 10,
          borderRadius: 999,
          // The bead is the ink that is about to be laid down, so it matches
          // the print rather than the accent colour.
          background: "linear-gradient(90deg, rgba(14,14,14,0.92) 0%, rgba(14,14,14,0.6) 60%, rgba(14,14,14,0) 100%)",
          filter: "blur(2px)",
          opacity: 0.85,
        }}
      />
      {/* Blade — polyurethane, darker at the working edge where it loads ink */}
      <div
        style={{
          position: "absolute",
          left: 58,
          top: 0,
          bottom: 0,
          width: 36,
          borderRadius: "3px 6px 6px 3px",
          background:
            "linear-gradient(90deg, #1c1c1e 0%, #2a2a2d 35%, #3a3a3f 70%, #17171a 100%)",
          boxShadow: "6px 0 18px rgba(0,0,0,0.38), inset -2px 0 4px rgba(0,0,0,0.5)",
        }}
      />
      {/* Handle — anodised aluminium, with a highlight running its length */}
      <div
        style={{
          position: "absolute",
          left: 6,
          top: "3%",
          bottom: "3%",
          width: 56,
          borderRadius: 8,
          background:
            "linear-gradient(90deg, #6f7378 0%, #b9bec4 22%, #e8ebee 42%, #9aa0a6 68%, #5c6065 100%)",
          boxShadow: "0 10px 30px rgba(0,0,0,0.32)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 20,
          top: "6%",
          bottom: "6%",
          width: 7,
          borderRadius: 6,
          background: "linear-gradient(180deg, rgba(255,255,255,0.75), rgba(255,255,255,0.1))",
          opacity: 0.5,
        }}
      />
    </div>
  );
}

export default function SqueegeePull({
  eyebrow = "One pull",
  headline,
  // headline may be JSX (for a hard line break), so the accessible name has to
  // be given separately rather than interpolated — otherwise the label reads
  // "[object Object]" to a screen reader.
  label,
  lines = [],
  height = "300vh",
}) {
  const track = useRef(null);
  const p = useScrollScrub(track);

  // The stroke itself occupies the middle of the scrub, leaving room to read
  // the blank garment first and the finished print after.
  const stroke = easeInOutCubic(range(p, 0.12, 0.82));
  const pct = stroke * 100;

  // Blade travel as a percentage of the panel width.
  const bladeX = pct;

  // Pressure eases in as the pull starts and off as it finishes — a real pull
  // loads up and releases rather than moving at constant force.
  const pressure = Math.sin(Math.PI * stroke);
  const tilt = -7 + pressure * 2.5;

  return (
    <section ref={track} style={{ height, position: "relative" }} aria-label={label}>
      <div
        style={{
          position: "sticky",
          top: 0,
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          background: "#141414",
        }}
      >
        <div
          style={{
            position: "relative",
            width: "min(1100px, 92vw)",
            aspectRatio: "16 / 10",
            borderRadius: 14,
            overflow: "hidden",
            // Garment. A heather weave built from two crossed micro-gradients
            // plus a broad vignette, so it reads as fabric rather than paper.
            backgroundColor: "#e9e6df",
            backgroundImage: `
              repeating-linear-gradient(90deg, rgba(0,0,0,0.045) 0 1px, transparent 1px 3px),
              repeating-linear-gradient(0deg,  rgba(0,0,0,0.035) 0 1px, transparent 1px 3px),
              radial-gradient(120% 90% at 50% 40%, rgba(255,255,255,0.5), rgba(0,0,0,0.13))`,
            boxShadow: "0 40px 90px rgba(0,0,0,0.5)",
          }}
        >
          {/* The print. Clipped to the blade's trailing edge, so ink exists
              only where the squeegee has already passed. */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              padding: "clamp(24px, 5vw, 72px)",
              clipPath: `inset(0 ${100 - pct}% 0 0)`,
              willChange: "clip-path",
              zIndex: 2,
            }}
          >
            <p
              style={{
                margin: 0,
                color: FOREST,
                fontSize: "clamp(10px, 1.1vw, 13px)",
                fontWeight: 700,
                letterSpacing: "0.28em",
                textTransform: "uppercase",
                fontFamily: '"Inter", system-ui, sans-serif',
              }}
            >
              {eyebrow}
            </p>
            <h2
              style={{
                margin: "0.4em 0 0",
                color: INK,
                fontFamily: '"Anton", "Oswald", "Arial Narrow", sans-serif',
                textTransform: "uppercase",
                letterSpacing: "0.01em",
                lineHeight: 0.92,
                fontSize: "clamp(2.1rem, 6.4vw, 5.2rem)",
                backgroundImage: HALFTONE,
                backgroundSize: "3px 3px",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
              }}
            >
              {headline}
            </h2>
            <ul
              style={{
                margin: "clamp(14px, 2.4vw, 30px) 0 0",
                padding: 0,
                listStyle: "none",
                display: "grid",
                gap: "clamp(6px, 1vw, 12px)",
                maxWidth: "46ch",
              }}
            >
              {lines.map((l) => (
                <li
                  key={l}
                  style={{
                    color: "#2b2b2b",
                    fontFamily: '"Inter", system-ui, sans-serif',
                    fontSize: "clamp(0.82rem, 1.5vw, 1.06rem)",
                    lineHeight: 1.5,
                    display: "flex",
                    gap: "0.7em",
                  }}
                >
                  <span style={{ color: FOREST, fontWeight: 700 }}>—</span>
                  {l}
                </li>
              ))}
            </ul>
          </div>

          {/* Wet sheen. A narrow band immediately behind the blade that fades
              out over the pull, so ink laid down early reads as dry and ink at
              the blade still reads as wet. */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 3,
              pointerEvents: "none",
              opacity: stroke > 0 && stroke < 1 ? 0.5 : 0,
              background: `linear-gradient(90deg,
                transparent 0%,
                transparent ${Math.max(0, pct - 9)}%,
                rgba(255,255,255,0.42) ${Math.max(0, pct - 3)}%,
                rgba(255,255,255,0.06) ${pct}%,
                transparent ${Math.min(100, pct + 2)}%)`,
              transition: "opacity 240ms linear",
            }}
          />

          <Squeegee x={bladeX} tilt={tilt} pressure={pressure} />
        </div>
      </div>
    </section>
  );
}
