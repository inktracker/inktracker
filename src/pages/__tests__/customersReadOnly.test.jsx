// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const H = vi.hoisted(() => ({ user: null }));

const READONLY_USER = { role: "shop", subscription_tier: "expired", subscription_status: "canceled", email: "s@x.com" };
const ACTIVE_USER = { role: "shop", subscription_tier: "shop", subscription_status: "active", email: "s@x.com" };

vi.mock("@/api/supabaseClient", () => ({
  base44: { auth: { me: () => Promise.resolve(H.user) }, entities: {} },
  supabase: { auth: { getSession: () => Promise.resolve({ data: { session: null } }) } },
}));
vi.mock("@/lib/queries/cachedEntity", () => ({ cachedFilter: () => Promise.resolve([]), cachedList: () => Promise.resolve([]) }));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ user: H.user }) }));
// Stub the decomposed customer children (not under test).
vi.mock("@/components/customers/AddCustomerForm", () => ({ default: () => null }));
vi.mock("@/components/customers/CustomerCardGrid", () => ({ default: () => null }));
vi.mock("@/components/customers/EditCustomerModal", () => ({ default: () => null }));
vi.mock("@/components/customers/MergeDuplicatesModal", () => ({ default: () => null }));
vi.mock("@/components/customers/QbReconcileReviewModal", () => ({ default: () => null }));

import Customers from "../Customers";

const renderCustomers = () => render(<MemoryRouter><Customers /></MemoryRouter>);

describe("Customers — read-only affordance gating (light)", () => {
  beforeEach(() => { H.user = null; });

  it("read-only (lapsed) user: '+ Add Customer' is DISABLED", async () => {
    H.user = READONLY_USER;
    renderCustomers();
    const btn = await screen.findByRole("button", { name: /Add Customer/i });
    expect(btn.disabled).toBe(true);
  });

  it("active user: '+ Add Customer' is ENABLED", async () => {
    H.user = ACTIVE_USER;
    renderCustomers();
    const btn = await screen.findByRole("button", { name: /Add Customer/i });
    expect(btn.disabled).toBe(false);
  });
});
