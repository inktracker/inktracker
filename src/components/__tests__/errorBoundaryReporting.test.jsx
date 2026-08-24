// @vitest-environment jsdom
//
// The ErrorBoundary must REPORT, not just render a nice apology.
//
// Until 2026-08-24 componentDidCatch only console.error'd. The full-page
// "Something went wrong" screen — the most user-visible failure the app has —
// produced no Sentry event at all. That was discovered the expensive way:
// a shop owner reported a recurring "Reveal is not defined" crash, and with
// no captured stack there was nothing to attribute it from (the identifier
// appears in none of our shipped chunks, so the stack was the only way to
// find the real source).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const captureException = vi.fn();
vi.mock("@/lib/sentry", () => ({
  captureException: (...a) => captureException(...a),
  initSentry: vi.fn(),
  setSentryUser: vi.fn(),
  clearSentryUser: vi.fn(),
}));

import ErrorBoundary, { isCustomerFacingPath } from "../ErrorBoundary";

function Boom() {
  throw new Error("kaboom");
}

// The boundary logs to console.error by design; keep the suite readable.
let errSpy;
beforeEach(() => {
  captureException.mockClear();
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errSpy.mockRestore());

// componentDidCatch's report is a fire-and-forget dynamic import, so it
// resolves a microtask after render.
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("ErrorBoundary → Sentry", () => {
  it("reports the caught error", async () => {
    render(
      <MemoryRouter>
        <ErrorBoundary><Boom /></ErrorBoundary>
      </MemoryRouter>,
    );
    await flush();
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(captureException.mock.calls[0][0].message).toBe("kaboom");
  });

  it("attaches the component stack — the difference between a useless and a useful report", async () => {
    render(
      <MemoryRouter>
        <ErrorBoundary><Boom /></ErrorBoundary>
      </MemoryRouter>,
    );
    await flush();
    const ctx = captureException.mock.calls[0][1];
    expect(ctx.componentStack).toEqual(expect.stringContaining("Boom"));
    expect(ctx.boundary).toBe("page");
  });

  it("still renders the fallback UI (reporting must not replace recovery)", async () => {
    render(
      <MemoryRouter>
        <ErrorBoundary><Boom /></ErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByText(/something went wrong/i)).toBeTruthy();
    await flush();
  });

  it("flags customer-facing crashes so they can be triaged first", async () => {
    render(
      <MemoryRouter>
        <ErrorBoundary customerFacing><Boom /></ErrorBoundary>
      </MemoryRouter>,
    );
    await flush();
    expect(captureException.mock.calls[0][1].customerFacing).toBe(true);
  });

  it("marks inline boundaries distinctly from full-page ones", async () => {
    render(
      <MemoryRouter>
        <ErrorBoundary mode="inline"><Boom /></ErrorBoundary>
      </MemoryRouter>,
    );
    await flush();
    expect(captureException.mock.calls[0][1].boundary).toBe("inline");
  });
});

describe("isCustomerFacingPath", () => {
  it("treats the anonymous routes as customer-facing", () => {
    for (const p of ["/QuotePayment", "/quoterequest?id=1", "/ArtApproval/abc", "/embed"]) {
      expect(isCustomerFacingPath(p)).toBe(true);
    }
  });

  it("leaves staff routes alone (they get the technical detail)", () => {
    for (const p of ["/Quotes", "/Orders", "/Account", "/"]) {
      expect(isCustomerFacingPath(p)).toBe(false);
    }
  });
});
