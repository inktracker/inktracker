// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Mutable "current user" the mocks read (hoisted so the vi.mock factories,
// which are hoisted above module code, can reference it).
const H = vi.hoisted(() => ({ user: null }));

const READONLY_USER = { role: "shop", subscription_tier: "expired", subscription_status: "canceled", email: "s@x.com" };
const ACTIVE_USER = { role: "shop", subscription_tier: "shop", subscription_status: "active", email: "s@x.com" };

vi.mock("@/api/supabaseClient", () => ({
  base44: {
    auth: { me: () => Promise.resolve(H.user) },
    entities: { Quote: { list: () => Promise.resolve([]) }, Customer: { list: () => Promise.resolve([]) } },
  },
  supabase: { auth: { getSession: () => Promise.resolve({ data: { session: null } }) } },
}));
vi.mock("@/lib/queries/cachedEntity", () => ({
  cachedFilter: () => Promise.resolve([]),
  cachedList: () => Promise.resolve([]),
}));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ user: H.user }) }));
// Heavy child modals only render conditionally (not on first paint) — stub so
// importing Quotes doesn't drag in their whole trees.
vi.mock("../../components/quotes/QuoteEditorModal", () => ({ default: () => null }));
vi.mock("../../components/quotes/QuoteDetailModal", () => ({ default: () => null }));
vi.mock("../../components/AdvancedFilters", () => ({ default: () => null }));

import Quotes from "../Quotes";

const renderQuotes = () => render(<MemoryRouter><Quotes /></MemoryRouter>);

describe("Quotes — read-only affordance gating", () => {
  beforeEach(() => { H.user = null; });

  it("read-only (lapsed) user: '+ New Quote' is DISABLED with a Reactivate link", async () => {
    H.user = READONLY_USER;
    renderQuotes();
    const btn = await screen.findByRole("button", { name: /New Quote/i });
    expect(btn.disabled).toBe(true);
    // the user is told WHY + where to fix it (not silently hidden)
    expect(screen.getAllByText("Reactivate").length).toBeGreaterThan(0);
    // The empty-state "Create Quote" CTA is a SECOND create entry point — it
    // must be disabled too (regression: it opened the builder ungated).
    const emptyCtas = screen.getAllByRole("button", { name: /Create Quote/i });
    expect(emptyCtas.length).toBeGreaterThan(0);
    emptyCtas.forEach((b) => expect(b.disabled).toBe(true));
  });

  it("active user: '+ New Quote' is ENABLED and no Reactivate link", async () => {
    H.user = ACTIVE_USER;
    renderQuotes();
    const btn = await screen.findByRole("button", { name: /New Quote/i });
    expect(btn.disabled).toBe(false);
    expect(screen.queryByText("Reactivate")).toBeNull();
  });
});
