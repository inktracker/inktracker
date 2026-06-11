// @vitest-environment jsdom
//
// Phase 5b — MFA enrollment inside the onboarding wizard (Joe,
// 2026-06-11: "We should have MFA during onboarding"). Pins:
//   - the Protect Your Account step exists between Email and Done
//   - enable flow follows the SecuritySection contract:
//     requestMfaSignInCode → verifyMfaSignInCode → enableMfaEmail
//   - skipping is allowed (nudge banner handles stragglers)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/api/supabaseClient", () => ({
  supabase: { auth: { getSession: () => Promise.resolve({ data: { session: null } }) }, functions: { invoke: vi.fn() } },
  base44: { entities: {}, auth: {}, functions: { invoke: vi.fn() } },
}));
vi.mock("@/lib/uploadFile", () => ({ uploadFile: vi.fn() }));
vi.mock("@/lib/demoSeed", () => ({ seedDemoData: vi.fn() }));
vi.mock("@/components/shared/pricing", () => ({ loadShopPricingConfig: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

const requestMfaSignInCode = vi.fn();
const verifyMfaSignInCode = vi.fn();
const enableMfaEmail = vi.fn();
vi.mock("@/lib/mfa", () => ({
  requestMfaSignInCode: (...a) => requestMfaSignInCode(...a),
  verifyMfaSignInCode: (...a) => verifyMfaSignInCode(...a),
  enableMfaEmail: (...a) => enableMfaEmail(...a),
}));

import OnboardingWizard from "../OnboardingWizard";

async function walkToSecurityStep() {
  render(<OnboardingWizard user={{ email: "shop@example.com" }} onComplete={() => {}} />);
  fireEvent.click(screen.getByText("Get Started"));
  // Shop Name input has no placeholder — find it via its autoFocus position
  // (the first text input on the Shop Details step).
  const shopInput = document.querySelector('input[type="text"]');
  fireEvent.change(shopInput, { target: { value: "Test Shop" } });
  fireEvent.click(screen.getByText("Continue"));   // shop -> branding
  fireEvent.click(screen.getByText("Continue"));   // branding -> email
  fireEvent.click(screen.getByText("Continue"));   // email -> security
  await screen.findByText("Two-factor authentication");
}

beforeEach(() => {
  requestMfaSignInCode.mockReset().mockResolvedValue({ ok: true });
  verifyMfaSignInCode.mockReset().mockResolvedValue({ ok: true });
  enableMfaEmail.mockReset().mockResolvedValue({ ok: true });
});

describe("OnboardingWizard — MFA step (Phase 5b)", () => {
  it("offers 2FA between Email and Done, with a skip path", async () => {
    await walkToSecurityStep();
    expect(screen.getByText(/Turn on 2FA/)).toBeTruthy();
    expect(screen.getByText("Skip")).toBeTruthy();
    fireEvent.click(screen.getByText("Skip"));
    await screen.findByText(/is ready!/);
    expect(requestMfaSignInCode).not.toHaveBeenCalled();
  });

  it("runs the verify-then-enable contract in order", async () => {
    await walkToSecurityStep();
    fireEvent.click(screen.getByText(/Turn on 2FA/));
    const codeInput = await screen.findByPlaceholderText("123456");
    expect(requestMfaSignInCode).toHaveBeenCalledTimes(1);

    fireEvent.change(codeInput, { target: { value: "654321" } });
    fireEvent.click(screen.getByText("Verify & turn on"));

    await screen.findByText("Two-factor authentication is on");
    expect(verifyMfaSignInCode).toHaveBeenCalledWith("654321");
    expect(enableMfaEmail).toHaveBeenCalledTimes(1);
    expect(verifyMfaSignInCode.mock.invocationCallOrder[0]).toBeLessThan(
      enableMfaEmail.mock.invocationCallOrder[0]
    );
  });

  it("does not enable when the code is rejected", async () => {
    verifyMfaSignInCode.mockResolvedValue({ ok: false, error: "mismatch" });
    await walkToSecurityStep();
    fireEvent.click(screen.getByText(/Turn on 2FA/));
    const codeInput = await screen.findByPlaceholderText("123456");
    fireEvent.change(codeInput, { target: { value: "000000" } });
    fireEvent.click(screen.getByText("Verify & turn on"));
    await screen.findByText(/didn't match/);
    expect(enableMfaEmail).not.toHaveBeenCalled();
  });
});
