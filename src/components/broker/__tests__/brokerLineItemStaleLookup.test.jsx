// @vitest-environment jsdom
//
// Regression: broker quote cells resetting mid-entry (Joe, 2026-08-17:
// "while quoting via broker portal the cells sometimes reset after
// entering info").
//
// The race: blurring the Style field starts a supplier lookup that can take
// seconds. The broker keeps working — types size quantities, adjusts the
// line — and when the lookup finally resolves, handleStyleBlur used to call
// applySelectedMatch with the CLOSURE-CAPTURED line item from blur time,
// rolling the whole line back to that snapshot. Every cell filled during
// the lookup silently reset. The shop-side LineItemEditor fixed this exact
// class with a liRef guard; the broker editor never got it.
//
// This test drives the real component through the race with a lookup whose
// resolution WE control: blur → type sizes while pending → resolve → the
// typed sizes must survive.

import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// A deferred the test resolves by hand — this IS the in-flight lookup window.
let resolveLookup;
const lookupPromise = new Promise((res) => { resolveLookup = res; });

const MATCH = {
  id: 501,
  brandName: "AS Colour",
  styleNumber: "5026",
  resolvedStyleNumber: "5026",
  styleName: "Staple Tee",
  resolvedTitle: "Staple Tee",
  title: "Staple Tee",
  description: "Heavyweight cotton tee",
  styleCategory: "T-Shirts",
  colors: [{ colorName: "Navy", sizePrices: { M: 6.1, L: 6.1 } }],
  priceMap: { Navy: { piecePrice: 6.1, casePrice: 6.1 } },
};

vi.mock("@/api/supabaseClient", () => ({
  supabase: {
    functions: {
      invoke: vi.fn((name) =>
        name === "ssLookupStyle"
          ? lookupPromise.then(() => ({ data: { matches: [MATCH] }, error: null }))
          : Promise.resolve({ data: { matches: [] }, error: null })
      ),
    },
  },
  base44: { entities: {}, auth: {}, functions: {} },
}));

import BrokerLineItemEditor from "../BrokerLineItemEditor";

function Harness() {
  const [li, setLi] = useState({
    id: "li-1",
    style: "5026",
    brand: "",
    garmentColor: "",
    sizes: {},
    imprints: [],
  });
  return (
    <BrokerLineItemEditor
      li={li}
      rushRate={0}
      extras={[]}
      allLineItems={[li]}
      shopPricingConfig={{}}
      brokerPricingConfig={{}}
      onChange={setLi}
      onRemove={() => {}}
      onDuplicate={() => {}}
      canRemove={false}
    />
  );
}

describe("broker line editor — cells typed during a slow lookup survive it", () => {
  it("keeps size quantities entered while the style lookup is in flight", async () => {
    render(<Harness />);

    // 1. Blur the style field → lookup starts and STAYS pending.
    const styleInput = screen.getByPlaceholderText("e.g. 1717 or G500");
    fireEvent.blur(styleInput);

    // 2. Broker keeps working: types quantities into the M and L cells.
    const sizeInputs = screen.getAllByPlaceholderText("0");
    // SIZES order starts XS, S, M, L … — index 2 = M, 3 = L.
    fireEvent.change(sizeInputs[2], { target: { value: "17" } });
    fireEvent.change(sizeInputs[3], { target: { value: "23" } });
    expect(sizeInputs[2].value).toBe("17");
    expect(sizeInputs[3].value).toBe("23");

    // 3. The slow lookup finally lands.
    resolveLookup();

    // The lookup result must still apply (brand fills in)…
    await waitFor(() => {
      expect(screen.getByDisplayValue("AS Colour")).toBeTruthy();
    });

    // …and the quantities typed DURING the lookup must survive it.
    // Before the liRef fix these reset to empty — the reported bug.
    expect(screen.getAllByPlaceholderText("0")[2].value).toBe("17");
    expect(screen.getAllByPlaceholderText("0")[3].value).toBe("23");
  });
});
