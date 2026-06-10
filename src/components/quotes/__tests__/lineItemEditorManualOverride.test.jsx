// @vitest-environment jsdom
//
// Manual-entry override for the Brand / Garment Color dropdowns.
//
// Bug story (2026-06-10): Joe quoted customer-supplied tote bags. The
// supplier lookup matched two close-but-wrong products (Reprime RP998,
// Augusta 1703), and because brandOptions.length > 1 the Brand cell
// rendered as a locked <select> with no way to type what the goods
// actually were. Same lock on Garment Color once supplier colors load.
//
// The fix adds a "✎ Type my own…" option to both dropdowns that swaps
// the cell to a free-text input, drops the supplier-resolved pricing
// linkage (sizePrices/casePrice), and offers a "Back to" link to
// restore the matched list.

import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const TWO_BRAND_MATCHES = [
  {
    id: 101,
    brandName: "Artisan Collection by Reprime",
    styleNumber: "RP998",
    resolvedStyleNumber: "RP998",
    productNumber: "RP998",
    styleName: "Artisan Collection by Reprime — RP998",
    resolvedTitle: "Denim Tote Bag",
    title: "Denim Tote Bag",
    description: "Denim Tote Bag",
    styleCategory: "Bags",
    colors: [
      { colorName: "Denim", sizePrices: { OS: 4.1 } },
      { colorName: "Black Denim", sizePrices: { OS: 4.1 } },
    ],
    priceMap: { Denim: { piecePrice: 4.1 }, "Black Denim": { piecePrice: 4.1 } },
  },
  {
    id: 102,
    brandName: "Augusta Sportswear",
    styleNumber: "1703",
    resolvedStyleNumber: "1703",
    productNumber: "1703",
    styleName: "Augusta Sportswear — 1703",
    resolvedTitle: "Large Ripstop Duffel Bag",
    title: "Large Ripstop Duffel Bag",
    description: "Large Ripstop Duffel Bag",
    styleCategory: "Bags",
    colors: [{ colorName: "Navy", sizePrices: { OS: 11.5 } }],
    priceMap: { Navy: { piecePrice: 11.5 } },
  },
];

vi.mock("@/api/supabaseClient", () => ({
  supabase: {
    functions: {
      invoke: vi.fn((name) =>
        name === "ssLookupStyle"
          ? Promise.resolve({ data: { matches: TWO_BRAND_MATCHES }, error: null })
          : Promise.resolve({ data: { matches: [] }, error: null })
      ),
    },
  },
  base44: { entities: {}, auth: {}, functions: {} },
}));

import LineItemEditor from "../LineItemEditor";

function makeLi(overrides = {}) {
  return {
    id: "li-test-1",
    style: "TOTE1",
    category: "Customer Supplied",
    brand: "",
    garmentColor: "",
    garmentCost: "",
    sizes: {},
    imprints: [],
    sizePrices: {},
    ...overrides,
  };
}

// Controlled harness so onChange flows back into the component like in
// the real QuoteEditorModal.
function Harness({ initialLi, onLiChange }) {
  const [li, setLi] = useState(initialLi);
  return (
    <LineItemEditor
      li={li}
      onChange={(next) => {
        setLi(next);
        onLiChange?.(next);
      }}
      allLineItems={[li]}
      canRemove={false}
      onRemove={() => {}}
    />
  );
}

async function renderWithBrandDropdown(onLiChange) {
  render(<Harness initialLi={makeLi()} onLiChange={onLiChange} />);
  const styleInput = screen.getByPlaceholderText("e.g. 1717 or G500");
  fireEvent.blur(styleInput);
  // Brand select appears once the (mocked) lookup resolves two brands.
  // (displayValue matches the selected option's text — nothing selected yet.)
  return await screen.findByDisplayValue("Select brand…");
}

describe("LineItemEditor — manual override for supplier-matched dropdowns", () => {
  it("offers 'Type my own…' in the brand dropdown when the lookup returns multiple matches", async () => {
    const brandSelect = await renderWithBrandDropdown();
    const options = within(brandSelect).getAllByRole("option").map((o) => o.textContent);
    expect(options).toContain("✎ Type my own…");
    expect(options.some((t) => t.includes("Artisan Collection by Reprime"))).toBe(true);
    expect(options.some((t) => t.includes("Augusta Sportswear"))).toBe(true);
  });

  it("switches brand to a free-text input and clears supplier pricing linkage", async () => {
    const changes = [];
    const brandSelect = await renderWithBrandDropdown((next) => changes.push(next));

    fireEvent.change(brandSelect, { target: { value: "__custom__" } });

    // Free-text input appears and accepts arbitrary text
    const brandInput = await screen.findByPlaceholderText("e.g. Gildan");
    fireEvent.change(brandInput, { target: { value: "Customer's Own Canvas Tote" } });

    await waitFor(() => {
      const last = changes[changes.length - 1];
      expect(last.brand).toBe("Customer's Own Canvas Tote");
    });

    // Supplier linkage dropped when entering custom mode
    const custom = changes.find((c) => c.casePrice === "" && c.styleNumber === "");
    expect(custom).toBeTruthy();
    expect(custom.sizePrices).toEqual({});
  });

  it("offers a way back to the matched brand list", async () => {
    const brandSelect = await renderWithBrandDropdown();
    fireEvent.change(brandSelect, { target: { value: "__custom__" } });
    const back = await screen.findByText("↩ Back to matched brands");
    fireEvent.click(back);
    expect(await screen.findByDisplayValue("Select brand…")).toBeTruthy();
  });

  it("allows typing a custom garment color after a brand is selected", async () => {
    const changes = [];
    const brandSelect = await renderWithBrandDropdown((next) => changes.push(next));

    // Pick the Reprime brand so supplier colors load
    const reprime = within(brandSelect)
      .getAllByRole("option")
      .find((o) => o.textContent.includes("Reprime"));
    fireEvent.change(brandSelect, { target: { value: reprime.value } });

    // Color select now shows supplier colors + the custom escape hatch
    const colorOption = await screen.findByText("Black Denim");
    expect(colorOption).toBeTruthy();
    const colorSelect = colorOption.closest("select");
    fireEvent.change(colorSelect, { target: { value: "__custom__" } });

    const colorInput = await screen.findByPlaceholderText("e.g. Black");
    fireEvent.change(colorInput, { target: { value: "Faded Indigo (customer dyed)" } });

    await waitFor(() => {
      const last = changes[changes.length - 1];
      expect(last.garmentColor).toBe("Faded Indigo (customer dyed)");
      // The previously selected color's per-size prices must not stick
      // to the custom color.
      expect(last.sizePrices || {}).toEqual({});
    });
  });
});
