// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Heavy-ish sibling components pulled in at import time. Stub them so the
// smoke test stays focused on ConfigureStep's own JSX. This mirrors the
// AttachmentGallery test's import-time mock pattern.
vi.mock("@/components/shared/ColorAnalysisResult", () => ({ default: () => null }));

import ConfigureStep from "../ConfigureStep";

// A styleless garment keeps the render on the category-picker path and
// avoids the color/size/run-level pricing branches (those need a loaded
// pricing config). The extraction is a pure structural move; this test
// asserts the Step-1 shell mounts and shows the category accordion.
const GARMENTS = [{ id: "g0", style: null, color: "", sizes: {} }];
const POPULAR_STYLES = [
  { id: "ts-staple", garment: "T-Shirts", styleNumber: "5001", brand: "AS Colour", tag: "Staple" },
];

function noop() {}

const PROPS = {
  POPULAR_STYLES,
  bc: "#0d9488", bcDark: "#0a6d64", bcDarker: "#064e48",
  garments: GARMENTS, activeIdx: 0, setActiveIdx: noop,
  style: null, color: "", sizes: {},
  setG: noop, setStyle: noop, setColor: noop, setSizes: noop,
  selectedGarment: "", setSelectedGarment: noop,
  setPreviewStyle: noop,
  enrichedPreviews: {}, enrichStylePreviews: noop, selectAndEnrichStyle: noop,
  enrichingStyle: false,
  ssLookupInput: "", setSsLookupInput: noop, ssLookupLoading: false, ssLookupError: "", handleSSLookup: noop,
  ssMatches: [], setSsMatches: noop, pickSSMatch: noop,
  uid: () => "id",
  setColorPreview: noop,
  imprints: [{ id: "p1", location: "Front", colors: 1, technique: "Screen Print" }],
  updateImprint: noop, removeImprint: noop, setImprints: noop,
  artFiles: {}, setArtFiles: noop, colorResults: {}, setColorResults: noop,
  uploading: {}, handleArtUpload: noop,
  rush: false, setRush: noop,
  sizesRef: { current: null },
  qty: 0,
  addGarment: noop, removeGarment: noop,
  getValidationIssues: () => ["Select a garment style"],
  setStep: noop,
};

describe("ConfigureStep", () => {
  it("mounts and renders the category accordion + add-garment CTA", () => {
    render(<ConfigureStep {...PROPS} />);
    expect(screen.getByText("T-Shirts")).toBeTruthy();
    expect(screen.getByText("+ Add Another Garment")).toBeTruthy();
    expect(screen.getByText("Or search by style #")).toBeTruthy();
  });
});
