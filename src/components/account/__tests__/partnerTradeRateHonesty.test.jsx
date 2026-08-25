// @vitest-environment jsdom
//
// The Quick Price slider must never claim a trade rate that isn't in effect.
//
// Reported 2026-08-25: "I checked my partnership rate and it was set to 75%
// but showed 100% prices in the charts. I moved the slider and it updated."
//
// Cause: with no saved sheet, `quickPct` was hardcoded to 75 in BOTH the
// initial useState and the load fallback, while buildDraft(null, shopConfig)
// fell back to the shop's own config — i.e. full retail. So the UI printed
// "75% of my standard rates" directly above a table of 100% prices, asserting
// a discount that had never been saved.
//
// Not a mispricing (SendToPartnerModal suggests 0 without a sheet rather than
// silently charging retail), but a margin-truthfulness failure: the number on
// screen has to describe reality.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const getMyTradeSheet = vi.fn();
vi.mock("@/lib/partnerTradeSheet", async () => {
  const actual = await vi.importActual("@/lib/partnerTradeSheet");
  return {
    ...actual,
    DEFAULT_PARTNER: "*",
    getMyTradeSheet: (...a) => getMyTradeSheet(...a),
    savePartnerTradeSheet: vi.fn(() => Promise.resolve()),
  };
});
vi.mock("@/lib/partners", () => ({
  listPartnerships: vi.fn(() => Promise.resolve([])),
  activePartners: vi.fn(() => []),
}));
vi.mock("@/lib/notify", () => ({ notify: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({ user: { email: "joe@biotamfg.co", shop_owner: null } }),
}));
vi.mock("@/components/shared/pricing", async () => {
  const actual = await vi.importActual("@/components/shared/pricing");
  return { ...actual, getShopPricingConfig: () => SHOP_CONFIG };
});
vi.mock("@/api/supabaseClient", () => ({
  supabase: { from: vi.fn() },
  base44: { auth: {}, entities: {}, functions: {} },
}));

import PartnerTradeSheetEditor from "../PartnerTradeSheetEditor";

var SHOP_CONFIG = {
  tiers: [24, 50, 100, 200],
  maxColors: 4,
  firstPrint: { 1: { 24: 6.3, 50: 5.67, 100: 5.22, 200: 4.9 } },
  addlPrint: { 1: { 24: 2, 50: 1.8, 100: 1.6, 200: 1.5 } },
  embroidery: { enabled: false },
};

beforeEach(() => getMyTradeSheet.mockReset());

describe("Quick Price slider tells the truth", () => {
  it("reads 100% — not 75% — when no sheet is saved", async () => {
    getMyTradeSheet.mockResolvedValue(null);
    render(<PartnerTradeSheetEditor />);

    // The exact bug: 75% printed over full-retail tables.
    await waitFor(() => expect(screen.getByText("100%")).toBeTruthy());
    expect(screen.queryByText("75%")).toBeNull();
  });

  it("says plainly that nothing is saved yet", async () => {
    getMyTradeSheet.mockResolvedValue(null);
    render(<PartnerTradeSheetEditor />);
    expect(await screen.findByText(/no trade rate saved yet/i)).toBeTruthy();
    expect(screen.getByText(/prices below are your full retail/i)).toBeTruthy();
  });

  it("shows the saved percentage when a sheet exists", async () => {
    getMyTradeSheet.mockResolvedValue({ scale_pct: 80, config: { firstPrint: { 1: { 24: 5.04 } } } });
    render(<PartnerTradeSheetEditor />);
    await waitFor(() => expect(screen.getByText("80%")).toBeTruthy());
    expect(screen.queryByText(/no trade rate saved yet/i)).toBeNull();
  });

  it("does not claim 'not saved' for a saved row that predates scale_pct", async () => {
    // Old rows can carry a config with no scale_pct. That's a saved sheet —
    // showing "no trade rate saved yet" over real trade prices would be a
    // second lie in the opposite direction.
    getMyTradeSheet.mockResolvedValue({ scale_pct: null, config: { firstPrint: { 1: { 24: 5.04 } } } });
    render(<PartnerTradeSheetEditor />);
    await waitFor(() => expect(screen.getByText("100%")).toBeTruthy());
    expect(screen.queryByText(/no trade rate saved yet/i)).toBeNull();
  });
});
