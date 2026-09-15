// @vitest-environment jsdom
//
// PricePanel cost & margin block.
//
// Bug story (2026-09-15): a reopened IN-HOUSE line showed "Your cost ()
// $0.00 / Your margin 100%". The save path stamps `_partner_cost: null` on
// in-house lines and the panel coerced it with Number(null) === 0, which is
// finite — so "no partner" read as "partner costs $0". Follow-up ask: for
// in-house lines show the raw blank cost as an ESTIMATED cost/margin.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PricePanel from "../PricePanel";

const line = (over = {}) => ({
  id: "li-1",
  garmentCost: 5,
  sizes: { M: 100 },
  imprints: [{ id: "imp-1", location: "Front", colors: 1, technique: "Screen Print" }],
  ...over,
});

describe("PricePanel override + rush (Joe 2026-09-15: rush must apply on top of a flat price)", () => {
  it("shows the Rush Fee row and adds 20% on top of the $20 override", () => {
    render(<PricePanel li={line({ clientPpp: 20 })} rushRate={0.2} extras={{}} allLineItems={[]} onChange={() => {}} />);
    expect(screen.getByText(/Rush Fee \(20%\)/)).toBeTruthy();
    // 100 × $20 = $2,000 + 20% rush $400 = $2,400 line total
    expect(screen.getByText("$400.00")).toBeTruthy();
    expect(screen.getByText("$2,400.00")).toBeTruthy();
  });

  it("no rush → override line total is exactly override × qty", () => {
    render(<PricePanel li={line({ clientPpp: 20 })} rushRate={0} extras={{}} allLineItems={[]} onChange={() => {}} />);
    expect(screen.queryByText(/Rush Fee/)).toBeNull();
    expect(screen.getByText("$2,000.00")).toBeTruthy();
  });
});

describe("PricePanel cost & margin", () => {
  it("in-house line stamped _partner_cost:null does NOT read as $0 partner cost", () => {
    render(<PricePanel li={line({ _partner_cost: null })} rushRate={0} extras={{}} allLineItems={[]} onChange={() => {}} />);
    expect(screen.queryByText(/Your cost/i)).toBeNull();
    expect(screen.queryByText(/Your margin/i)).toBeNull();
  });

  it("in-house line shows ESTIMATED cost = raw blank cost (pre-markup) and margin vs retail", () => {
    render(<PricePanel li={line({ _partner_cost: null })} rushRate={0} extras={{}} allLineItems={[]} onChange={() => {}} />);
    expect(screen.getByText(/Est\. cost \(blanks\)/i)).toBeTruthy();
    expect(screen.getByText(/Est\. margin/i)).toBeTruthy();
    expect(screen.getByText(/Estimated — blank cost only/i)).toBeTruthy();
    // 100 × $5.00 raw blanks = $500.00 (garment MARKUP must not be in cost)
    expect(screen.getByText("$500.00")).toBeTruthy();
  });

  it("in-house line with no garment cost (customer-supplied) hides the block instead of claiming 100% margin", () => {
    render(<PricePanel li={line({ garmentCost: 0, _partner_cost: null })} rushRate={0} extras={{}} allLineItems={[]} onChange={() => {}} />);
    expect(screen.queryByText(/Est\. cost/i)).toBeNull();
    expect(screen.queryByText(/100%/)).toBeNull();
  });

  it("partner line with a snapshotted cost shows the partner's cost and true margin", () => {
    render(
      <PricePanel
        li={line({ partner_source: "Summit", _partner_cost: 250 })}
        rushRate={0} extras={{}} allLineItems={[]} onChange={() => {}}
        partnerLabel="Summit" partnerConfig={null}
      />,
    );
    expect(screen.getByText(/Your cost \(Summit\)/i)).toBeTruthy();
    expect(screen.getByText("$250.00")).toBeTruthy();
    expect(screen.queryByText(/Est\. cost/i)).toBeNull();
  });

  it("partner line with no usable rate shows the amber notice, never $0 / 100%", () => {
    render(
      <PricePanel
        li={line({ partner_source: "Summit", _partner_cost: null })}
        rushRate={0} extras={{}} allLineItems={[]} onChange={() => {}}
        partnerLabel="Summit" partnerConfig={null}
      />,
    );
    expect(screen.getByText(/hasn.t published rates/i)).toBeTruthy();
    expect(screen.queryByText(/Your cost/i)).toBeNull();
    expect(screen.queryByText(/100%/)).toBeNull();
  });
});
