// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/api/supabaseClient", () => ({
  base44: { functions: { invoke: vi.fn(() => Promise.resolve({ data: null, error: null })) } },
  supabase: { auth: { getSession: vi.fn(() => Promise.resolve({ data: { session: null } })) } },
}));
vi.mock("@/lib/notify", () => ({ notify: { error: vi.fn() } }));

import CancellationBanner from "../CancellationBanner";

const future = () => new Date(Date.now() + 20 * 86400000).toISOString();
const past = () => new Date(Date.now() - 2 * 86400000).toISOString();

describe("CancellationBanner", () => {
  it("shows 'plan ends on X' for a pending-cancel shop with a future end date", () => {
    render(<CancellationBanner user={{ role: "shop", cancel_at_period_end: true, subscription_ends_at: future() }} />);
    expect(screen.getByText(/Your InkTracker plan ends on/i)).toBeTruthy();
    expect(screen.getByText(/You'll keep full access until then/i)).toBeTruthy();
    // owner gets the resume action
    expect(screen.getByRole("button", { name: /Resume subscription/i })).toBeTruthy();
  });

  it("shows the notice to a team member but without the billing button", () => {
    render(<CancellationBanner user={{ role: "manager", cancel_at_period_end: true, subscription_ends_at: future() }} />);
    expect(screen.getByText(/Your InkTracker plan ends on/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Resume subscription/i })).toBeNull();
    expect(screen.getByText(/shop owner can resume/i)).toBeTruthy();
  });

  it("renders nothing when no cancel is pending", () => {
    const { container } = render(
      <CancellationBanner user={{ role: "shop", cancel_at_period_end: false, subscription_ends_at: null }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing once the end date has passed (the expired banner takes over)", () => {
    const { container } = render(
      <CancellationBanner user={{ role: "shop", cancel_at_period_end: true, subscription_ends_at: past() }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing with no user", () => {
    const { container } = render(<CancellationBanner user={null} />);
    expect(container.firstChild).toBeNull();
  });
});
