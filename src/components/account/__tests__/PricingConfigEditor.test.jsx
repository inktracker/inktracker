// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Shop.filter resolves to [] → the editor falls back to DEFAULTS and renders.
vi.mock("@/api/supabaseClient", () => ({
  base44: { entities: { Shop: { filter: vi.fn(() => Promise.resolve([])) } } },
}));
vi.mock("@/components/shared/pricing", () => ({ loadShopPricingConfig: vi.fn() }));
vi.mock("@/lib/pricing/inputValidation", () => ({
  decidePricingSave: () => ({ canSave: true }),
}));

import PricingConfigEditor from "../PricingConfigEditor";

describe("PricingConfigEditor", () => {
  it("renders the pricing editor once config loads from defaults", async () => {
    render(<PricingConfigEditor user={{ email: "shop@example.com" }} />);
    // Garment Markup is the first section rendered from DEFAULTS.
    expect(await screen.findByText("Garment Markup")).toBeTruthy();
    expect(screen.getByText("Save Pricing")).toBeTruthy();
    // Screen Print tab is the default active decoration tab.
    expect(screen.getByText("Screen Print")).toBeTruthy();
  });
});
