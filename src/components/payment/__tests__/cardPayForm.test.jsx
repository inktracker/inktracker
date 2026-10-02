// @vitest-environment jsdom
//
// The card fee is shown BEFORE paying, Pay charges exactly the total the
// customer saw, and a declined card goes back to card entry.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { base44 } from "@/api/supabaseClient";
import CardPayForm from "../CardPayForm.jsx";

vi.mock("@/api/supabaseClient", () => ({ base44: { functions: { invoke: vi.fn() } } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

let handlers;
beforeEach(() => {
  handlers = {};
  const element = { on: (ev, fn) => { handlers[ev] = fn; }, mount: () => setTimeout(() => handlers.ready?.(), 0), destroy: () => {} };
  const elements = { create: () => element, submit: () => Promise.resolve({}) };
  window.Stripe = vi.fn(() => ({
    elements: () => elements,
    createConfirmationToken: () => Promise.resolve({ confirmationToken: { id: "ctoken_1" } }),
    handleNextAction: () => Promise.resolve({}),
  }));
});

const props = { docType: "quote", id: "q", token: "t", cardForm: { publishableKey: "pk_test_x", accountId: "acct_1" }, invoiceCents: 56872, feePct: 2.99, onBack: () => {} };

describe("CardPayForm", { timeout: 20000 }, () => {
  it("credit card: shows invoice + fee = total, then pays exactly that total", async () => {
    base44.functions.invoke.mockImplementation((_fn, body) => Promise.resolve({ data: body.action === "cardQuote"
      ? { payable: true, invoiceCents: 56872, surchargeCents: 1700, totalCents: 58572, funding: "credit", brand: "visa", last4: "4242" }
      : { payable: true, state: "paid", paymentIntentId: "pi_9" } }));
    const onPaid = vi.fn();
    render(<CardPayForm {...props} onPaid={onPaid} />);
    await waitFor(() => expect(screen.getByText("Continue").closest("button").disabled).toBe(false));
    expect(window.Stripe).toHaveBeenCalledWith("pk_test_x", { stripeAccount: "acct_1" });
    fireEvent.click(screen.getByText("Continue"));
    await screen.findByText("Credit card surcharge (2.99%)");
    expect(screen.getByText("$17.00")).toBeTruthy();
    fireEvent.click(screen.getByText("Pay $585.72"));
    await waitFor(() => expect(onPaid).toHaveBeenCalledWith("pi_9"));
    expect(base44.functions.invoke).toHaveBeenLastCalledWith("stripePayments", expect.objectContaining({ action: "cardPay", confirmationToken: "ctoken_1", expectTotalCents: 58572 }));
  });

  it("debit card: no fee", async () => {
    base44.functions.invoke.mockResolvedValue({ data: { payable: true, invoiceCents: 56872, surchargeCents: 0, totalCents: 56872, funding: "debit" } });
    render(<CardPayForm {...props} onPaid={() => {}} />);
    await waitFor(() => expect(screen.getByText("Continue").closest("button").disabled).toBe(false));
    fireEvent.click(screen.getByText("Continue"));
    await screen.findByText("None (debit card)");
    expect(screen.getByText("Pay $568.72")).toBeTruthy();
  });

  it("declined: the bank's words, back to card entry", async () => {
    base44.functions.invoke.mockImplementation((_fn, body) => Promise.resolve({ data: body.action === "cardQuote"
      ? { payable: true, invoiceCents: 56872, surchargeCents: 1700, totalCents: 58572, funding: "credit" }
      : { payable: true, declined: true, message: "Your card was declined." } }));
    const onPaid = vi.fn();
    render(<CardPayForm {...props} onPaid={onPaid} />);
    await waitFor(() => expect(screen.getByText("Continue").closest("button").disabled).toBe(false));
    fireEvent.click(screen.getByText("Continue"));
    fireEvent.click(await screen.findByText("Pay $585.72"));
    await screen.findByText("Your card was declined.");
    expect(screen.queryByText("Pay $585.72")).toBeNull();
    expect(onPaid).not.toHaveBeenCalled();
  });
  it("card form blocked (ad blocker): offers Stripe's own page instead", async () => {
    delete window.Stripe;
    const onCheckout = vi.fn();
    render(<CardPayForm {...props} onPaid={() => {}} onCheckout={onCheckout} />);
    const tag = document.head.querySelector('script[src="https://js.stripe.com/v3/"]');
    tag.onerror();
    fireEvent.click(await screen.findByText(/Pay on Stripe.s secure page instead/));
    expect(onCheckout).toHaveBeenCalled();
    expect(screen.queryByText("Continue")).toBeNull();
  });
  it("card details expired while the page sat open: back to card entry", async () => {
    base44.functions.invoke.mockImplementation((_fn, body) => Promise.resolve({ data: body.action === "cardQuote"
      ? { payable: true, invoiceCents: 56872, surchargeCents: 1700, totalCents: 58572, funding: "credit" }
      : { payable: false, reason: "card_unreadable", message: "That card couldn't be read. Please enter it again." } }));
    render(<CardPayForm {...props} onPaid={() => {}} />);
    await waitFor(() => expect(screen.getByText("Continue").closest("button").disabled).toBe(false));
    fireEvent.click(screen.getByText("Continue"));
    fireEvent.click(await screen.findByText("Pay $585.72"));
    await screen.findByText("That card couldn't be read. Please enter it again.");
    expect(screen.queryByText("Pay $585.72")).toBeNull();
  });
});
