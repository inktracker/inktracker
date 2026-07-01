// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { StepBadge, summarizeImprint, summarizeImprints, colorNameToHex } from "../wizardHelpers";

describe("wizardHelpers", () => {
  it("renders StepBadge with its title + subtitle", () => {
    render(<StepBadge n={1} title="Pick a color" subtitle="Tap a swatch" />);
    expect(screen.getByText("Pick a color")).toBeTruthy();
    expect(screen.getByText("Tap a swatch")).toBeTruthy();
  });

  it("summarizeImprint / summarizeImprints produce the human phrases", () => {
    expect(summarizeImprint({ location: "Front", colors: 2, technique: "Screen Print" })).toBe("2-color front");
    expect(summarizeImprint({ location: "Left Chest", technique: "Embroidery" })).toBe("embroidered left chest");
    expect(summarizeImprints([
      { location: "Front", colors: 1, technique: "Screen Print" },
      { location: "Back", colors: 3, technique: "Screen Print" },
    ])).toBe("1-color front, 3-color back");
  });

  it("colorNameToHex resolves known + fuzzy names", () => {
    expect(colorNameToHex("Black")).toBe("#222222");
    expect(colorNameToHex("")).toBeNull();
  });
});
