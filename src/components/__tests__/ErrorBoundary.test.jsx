// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ErrorBoundary, { isCustomerFacingPath } from "../ErrorBoundary";

function Boom() {
  throw new Error("Cannot read properties of undefined (reading 'total')");
}

// The boundary logs the caught error; silence it so test output stays readable.
const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});
afterEach(() => vi.restoreAllMocks());

describe("isCustomerFacingPath", () => {
  it("recognizes the anonymous customer routes", () => {
    for (const p of ["/quotepayment", "/QuotePayment?id=1", "/artapproval", "/OrderStatus", "/quoterequest", "/embed"]) {
      expect(isCustomerFacingPath(p)).toBe(true);
    }
  });

  it("does not treat staff routes as customer-facing", () => {
    for (const p of ["/dashboard", "/quotes", "/orders", "/account", "/", ""]) {
      expect(isCustomerFacingPath(p)).toBe(false);
    }
  });
});

describe("ErrorBoundary — customer-facing crashes", () => {
  it("NEVER shows the raw exception text to a customer", () => {
    quiet();
    render(
      <ErrorBoundary customerFacing><Boom /></ErrorBoundary>,
    );
    expect(screen.queryByText(/Cannot read properties of undefined/)).toBeNull();
    expect(document.querySelector("pre")).toBeNull();
    expect(screen.getByText(/didn.t load properly/i)).toBeTruthy();
  });

  it("points a customer at the shop, not at our support inbox", () => {
    quiet();
    render(<ErrorBoundary customerFacing><Boom /></ErrorBoundary>);
    expect(screen.queryByText(/support@inktracker\.app/)).toBeNull();
    expect(screen.queryByText(/Go to Dashboard/)).toBeNull();
    expect(screen.getByText(/contact the shop/i)).toBeTruthy();
  });

  it("still shows technical detail to SHOP STAFF (non-customer routes)", () => {
    quiet();
    render(<ErrorBoundary customerFacing={false}><Boom /></ErrorBoundary>);
    expect(screen.getByText(/Cannot read properties of undefined/)).toBeTruthy();
    expect(document.querySelector("pre")).toBeTruthy();
  });

  it("infers customer-facing from the URL when not told explicitly", () => {
    quiet();
    const original = window.location;
    delete window.location;
    window.location = { ...original, pathname: "/quotepayment", reload: () => {} };
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(document.querySelector("pre")).toBeNull();
    window.location = original;
  });
});
