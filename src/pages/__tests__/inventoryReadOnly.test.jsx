// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const H = vi.hoisted(() => ({ user: null }));
const READONLY_USER = { role: "shop", subscription_tier: "expired", subscription_status: "canceled", email: "s@x.com" };

vi.mock("@/api/supabaseClient", () => ({
  base44: { auth: { me: () => Promise.resolve(H.user) }, entities: { InventoryItem: { update: () => Promise.resolve({}) } } },
  supabase: { functions: { invoke: () => Promise.resolve({ data: {}, error: null }) } },
}));
vi.mock("@/lib/queries/cachedEntity", () => ({ cachedFilter: () => Promise.resolve([]), cachedList: () => Promise.resolve([]) }));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ user: H.user }) }));
vi.mock("../../components/inventory/ShoppingList", () => ({ default: () => null }));

import Inventory from "../Inventory";
const renderPage = () => render(<MemoryRouter><Inventory /></MemoryRouter>);

describe("Inventory — read-only smoke", () => {
  beforeEach(() => { H.user = READONLY_USER; });

  it("mounts for a read-only user (guards TDZ / render crash) with Add Item disabled", async () => {
    renderPage();
    expect(await screen.findByText("Inventory")).toBeTruthy(); // mounted, no crash
    const addBtns = await screen.findAllByRole("button", { name: /Add Item/i });
    expect(addBtns.length).toBeGreaterThan(0);
    addBtns.forEach((b) => expect(b.disabled).toBe(true));
  });
});
