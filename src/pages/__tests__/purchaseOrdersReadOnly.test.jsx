// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const H = vi.hoisted(() => ({ user: null }));
const READONLY_USER = { role: "shop", subscription_tier: "expired", subscription_status: "canceled", email: "s@x.com" };

vi.mock("@/api/supabaseClient", () => ({
  base44: {
    auth: { me: () => Promise.resolve(H.user) },
    entities: { PurchaseOrder: { filter: () => Promise.resolve([]), create: () => Promise.resolve({}), update: () => Promise.resolve({}), delete: () => Promise.resolve({}) } },
  },
  supabase: { functions: { invoke: () => Promise.resolve({ data: {}, error: null }) } },
}));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ user: H.user }) }));
vi.mock("@/components/purchaseOrders/AddItemsPanel", () => ({ default: () => null }));

import PurchaseOrders from "../PurchaseOrders";
const renderPage = () => render(<MemoryRouter><PurchaseOrders /></MemoryRouter>);

describe("PurchaseOrders — read-only smoke", () => {
  beforeEach(() => { H.user = READONLY_USER; });

  it("mounts for a read-only user without crashing (guards TDZ / render)", async () => {
    renderPage();
    expect(await screen.findByText("Purchase Orders")).toBeTruthy();
  });
});
