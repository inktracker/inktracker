// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/api/supabaseClient", () => ({
  base44: { functions: { invoke: vi.fn(() => Promise.resolve({ data: null, error: null })) } },
  supabase: { auth: { getSession: vi.fn(() => Promise.resolve({ data: { session: null } })) } },
}));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ checkAppState: vi.fn() }) }));

import BillingSection from "../BillingSection";

describe("BillingSection", () => {
  it("mounts and shows the current-plan label", async () => {
    render(<BillingSection user={{ email: "shop@example.com" }} />);
    // Loads async; the Current Plan header renders once the (mocked, empty)
    // subscription fetch resolves and loading flips off.
    expect(await screen.findByText("Current Plan")).toBeTruthy();
  });
});
