// Pin the buildBrandOptions contract for both the shop's LineItemEditor
// and the broker's BrokerLineItemEditor.
//
// Bug story (2026-06-08): Typing style 5071 in the quote builder
// returned matches from both S&S (Augusta Sportswear) and AS Colour.
// Both supplier APIs happened to return `id: 5071` for their match
// (S&S's styleID for Augusta == AS Colour's product.id for theirs).
// Because the option's `id` was set as `match.id || \`brand-${index}\``,
// both options ended up with the same `<option value>`. When the user
// clicked either one, `brandOptions.find(o => o.id === selected)`
// returned whichever came first in the array (always Augusta, since
// lookupStyle grabs S&S first). The dropdown LOOKED like AS Colour
// was selected (alphabetical sort), but the data applied to the line
// was always Augusta. Toggling did nothing.
//
// Fix: prefix every option id with the brand name, guaranteeing
// uniqueness even when two suppliers report the same internal id for
// their respective records. Both editors carry their own copy of the
// helper — until they're DRY'd up, both need to pass this contract.

import { describe, it, expect, vi } from "vitest";

// Both editor modules import `@/api/supabaseClient` at the top, which
// runs `createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)` at
// module-load time. In CI those env vars aren't set, so importing the
// editor would throw "supabaseUrl is required" before any test runs.
// Mock the client to a no-op so the module-level createClient never
// fires. `buildBrandOptions` is pure — it doesn't use any of these
// stubs, they only exist to keep the editor module loadable.
vi.mock("@/api/supabaseClient", () => ({
  supabase: {
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  },
  base44: { entities: {}, auth: {}, functions: {} },
}));

import { buildBrandOptions as buildBrandOptionsShop }   from "../LineItemEditor";
import { buildBrandOptions as buildBrandOptionsBroker } from "../../broker/BrokerLineItemEditor";

const SAME_ID_5071 = [
  // Order mirrors what `lookupStyle` produces — S&S first, AC second.
  {
    id: 5071,
    brandName: "Augusta Sportswear",
    styleNumber: "354",
    resolvedStyleNumber: "354",
    productNumber: "5071",
    styleName: "Augusta Sportswear — 354",
    resolvedTitle: "Augusta Sportswear — 354",
    title: "Augusta Sportswear — 354",
    description: "Augusta Sportswear Mens 354 Cutter Jersey",
    styleCategory: "T-Shirts",
    colors: [],
    priceMap: {},
  },
  {
    id: 5071,
    brandName: "AS Colour",
    styleNumber: "5071",
    resolvedStyleNumber: "5071",
    productNumber: "5071",
    styleName: "5071",
    resolvedTitle: "Classic L/S Tee",
    title: "Classic L/S Tee",
    description: "Classic L/S Tee",
    styleCategory: "Long Sleeve",
    colors: [],
    priceMap: {},
  },
];

describe.each([
  ["LineItemEditor",       buildBrandOptionsShop],
  ["BrokerLineItemEditor", buildBrandOptionsBroker],
])("%s buildBrandOptions — supplier id collision", (_label, buildBrandOptions) => {
  it("returns unique ids even when two suppliers return the same match.id", () => {
    const options = buildBrandOptions(SAME_ID_5071, "5071");
    const ids = options.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps both brands in the result (no deduplication by id)", () => {
    const options = buildBrandOptions(SAME_ID_5071, "5071");
    const brands = options.map((o) => o.brandName);
    expect(brands).toContain("Augusta Sportswear");
    expect(brands).toContain("AS Colour");
  });

  it("prefixes the id with the brand so find-by-id resolves to the right option", () => {
    const options = buildBrandOptions(SAME_ID_5071, "5071");
    const augusta = options.find((o) => o.brandName === "Augusta Sportswear");
    const asColour = options.find((o) => o.brandName === "AS Colour");
    expect(augusta.id).not.toBe(asColour.id);
    // Find-by-id should return the right brand, not always the first
    // one in array order (which was the bug).
    expect(options.find((o) => o.id === augusta.id).brandName).toBe("Augusta Sportswear");
    expect(options.find((o) => o.id === asColour.id).brandName).toBe("AS Colour");
  });

  it("still survives when both suppliers report null id (falls back to brand+index)", () => {
    const nullIds = SAME_ID_5071.map((m) => ({ ...m, id: null }));
    const options = buildBrandOptions(nullIds, "5071");
    const ids = options.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// Bug story (2026-07-17, Lisa Gotts): a brandless match ("customer supplied
// goods" typed into the style field) fell back to the literal string
// "Unknown Brand", which applySelectedMatch persisted onto the line and every
// description builder then printed on the quote email, PDF, and QB invoice
// ("Unknown Brand Customer Supplied Goods Natural | OS:400 | …"). The
// contract now: brandName stays EMPTY (so the line keeps the user's typed
// brand, or stays blank); only the dropdown LABEL says "Unknown brand".
describe.each([
  ["shop editor",   buildBrandOptionsShop],
  ["broker editor", buildBrandOptionsBroker],
])("buildBrandOptions — brandless match (%s)", (_name, buildBrandOptions) => {
  const BRANDLESS = [{
    id: "cs-1",
    brandName: "",
    styleNumber: "CUSTOMER SUPPLIED GOODS",
    description: "Customer Supplied Goods",
    colors: [],
  }];

  it("never emits the literal 'Unknown Brand' as brandName", () => {
    const [option] = buildBrandOptions(BRANDLESS, "customer supplied goods");
    expect(option.brandName).toBe("");
  });

  it("keeps a human label for the dropdown", () => {
    const [option] = buildBrandOptions(BRANDLESS, "customer supplied goods");
    expect(option.label).toMatch(/^Unknown brand — /);
  });

  it("keeps option ids unique between a brandless and a branded match with the same style id", () => {
    const mixed = [
      ...BRANDLESS,
      { ...BRANDLESS[0], brandName: "Gildan" },
    ];
    const ids = buildBrandOptions(mixed, "customer supplied goods").map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
