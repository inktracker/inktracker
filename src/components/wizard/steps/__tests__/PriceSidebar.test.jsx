// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import PriceSidebar from "../PriceSidebar";

const GARMENTS = [
  { id: "g1", style: { name: "AS Colour 5001" }, color: "Black", sizes: { M: 25 } },
];
const IMPRINTS = [{ id: "p1", location: "Front", colors: 1, technique: "Screen Print" }];

describe("PriceSidebar", () => {
  it("renders the empty state when no priceable summary yet", () => {
    render(
      <PriceSidebar
        bcDark="#0a6d64" bcDarker="#064e48"
        showPriceSummary={false}
        garments={[{ id: "g0", style: null, color: "", sizes: {} }]}
        imprints={IMPRINTS}
        totalAllQty={0}
        liveTotals={null}
        livePerGarmentPpp={{}}
        livePpp={0}
        rush={false}
        enrichingStyle={false}
      />
    );
    expect(screen.getByText("Start building")).toBeTruthy();
    expect(screen.getByText("Total quantity")).toBeTruthy();
  });

  it("renders the run total when a priceable summary is ready", () => {
    render(
      <PriceSidebar
        bcDark="#0a6d64" bcDarker="#064e48"
        showPriceSummary={true}
        garments={GARMENTS}
        imprints={IMPRINTS}
        totalAllQty={25}
        liveTotals={{ total: 250 }}
        livePerGarmentPpp={{ g1: 10 }}
        livePpp={10}
        rush={false}
        enrichingStyle={false}
      />
    );
    expect(screen.getByText("Building your run")).toBeTruthy();
    expect(screen.getByText("Run Total")).toBeTruthy();
  });
});
