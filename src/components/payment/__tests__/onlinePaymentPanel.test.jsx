// @vitest-environment jsdom
//
// The card / bank choice shows what each way of paying costs when the shop
// passes processing fees on, and nothing extra when it doesn't.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import OnlinePaymentPanel from "../OnlinePaymentPanel.jsx";

vi.mock("@/api/supabaseClient", () => ({ base44: { functions: { invoke: vi.fn() } } }));
vi.mock("../CardPayForm", () => ({ default: () => <div>card form</div> }));
afterEach(cleanup);

const FEES = { enabled: true, cardPct: 2.99, bankPct: 1 };

describe("OnlinePaymentPanel prices", { timeout: 20000 }, () => {
  it("exact totals with each fee, and no fee on debit", () => {
    render(<OnlinePaymentPanel docType="quote" id="q" token="t"
      pricing={{ fees: FEES, invoiceCents: 56872, creditFeeCents: 1700, bankFeeCents: 569, cardForm: { publishableKey: "pk_test_x", accountId: "acct_1" } }} />);
    expect(screen.getByText("$585.72")).toBeTruthy();
    expect(screen.getByText("Credit card: includes 2.99% surcharge ($17.00). Debit card: no surcharge, $568.72.")).toBeTruthy();
    expect(screen.getByText("$574.41")).toBeTruthy();
    expect(screen.getByText(/Includes 1% fee \(\$5\.69\)/)).toBeTruthy();
  });
  it("deposits / balances: just the percentages", () => {
    render(<OnlinePaymentPanel docType="quote" id="q" token="t" pricing={{ fees: FEES, cardForm: { publishableKey: "pk_test_x", accountId: "acct_1" } }} />);
    expect(screen.getByText("Credit card: includes 2.99% surcharge. Debit card: no surcharge.")).toBeTruthy();
    expect(screen.getByText(/Includes 1% fee\. Clears/)).toBeTruthy();
  });
  it("fees off: no fee promised anywhere", () => {
    render(<OnlinePaymentPanel docType="quote" id="q" token="t" pricing={null} />);
    expect(screen.queryByText(/fee|surcharge/i)).toBeNull();
  });
  it("only the ways the shop takes are offered", () => {
    render(<OnlinePaymentPanel docType="quote" id="q" token="t" pricing={{ accepts: { card: false, ach: true } }} />);
    expect(screen.queryByText("Pay by card")).toBeNull();
    expect(screen.getByText("Pay by bank transfer")).toBeTruthy();
    expect(screen.getByText("Pay online")).toBeTruthy();
  });
  it("card opens InkTracker's card form when the shop passes the card fee on", () => {
    render(<OnlinePaymentPanel docType="quote" id="q" token="t" pricing={{ fees: FEES, cardForm: { publishableKey: "pk_test_x", accountId: "acct_1" } }} />);
    fireEvent.click(screen.getByText("Pay by card"));
    expect(screen.getByText("card form")).toBeTruthy();
  });
});
