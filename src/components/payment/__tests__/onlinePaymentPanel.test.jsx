// @vitest-environment jsdom
//
// The card / bank choice shows each price, and the bank saving, when the
// shop has a bank-transfer discount.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import OnlinePaymentPanel from "../OnlinePaymentPanel.jsx";

vi.mock("@/api/supabaseClient", () => ({ base44: { functions: { invoke: vi.fn() } } }));
afterEach(cleanup);

describe("OnlinePaymentPanel prices", { timeout: 20000 }, () => {
  it("exact card and bank prices with the saving", () => {
    render(<OnlinePaymentPanel docType="quote" id="q" token="t" pricing={{ bankDiscountPct: 2, cardCents: 56872, bankCents: 55735, bankSavingsCents: 1137 }} />);
    expect(screen.getByText("$568.72")).toBeTruthy();
    expect(screen.getByText("$557.35 · save $11.37")).toBeTruthy();
    expect(screen.getByText(/2% off for paying from your bank account/)).toBeTruthy();
  });
  it("deposits / balances: just the percentage", () => {
    render(<OnlinePaymentPanel docType="quote" id="q" token="t" pricing={{ bankDiscountPct: 2 }} />);
    expect(screen.getByText("Save 2%")).toBeTruthy();
  });
  it("no discount: no prices promised, no saving shown", () => {
    render(<OnlinePaymentPanel docType="quote" id="q" token="t" pricing={null} />);
    expect(screen.queryByText(/save/i)).toBeNull();
  });
});
