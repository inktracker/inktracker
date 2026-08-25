// @vitest-environment jsdom
//
// Sign-in recovery paths, all three from one real support case.
//
// Truman (2026-08-25) reported "I sign in with Google and the app won't let
// me in." There is no Google auth in InkTracker — his browser had been
// autofilling a password he'd never typed. In the app nothing autofills, so
// he was stuck; he then requested sign-in links and hit "Email link is
// invalid or has expired" three times before falling back to a password
// reset. Every step of that was silent or unexplained. These pin the fixes.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const signInWithOtp = vi.fn(() => Promise.resolve({ error: null }));
const signInWithPassword = vi.fn(() =>
  Promise.resolve({ data: null, error: { message: "Invalid login credentials" } }),
);

vi.mock("@/api/supabaseClient", () => ({
  supabase: {
    auth: {
      signInWithOtp: (...a) => signInWithOtp(...a),
      signInWithPassword: (...a) => signInWithPassword(...a),
      signUp: vi.fn(),
      resetPasswordForEmail: vi.fn(() => Promise.resolve({ error: null })),
      getSession: vi.fn(() => Promise.resolve({ data: { session: null } })),
    },
    from: vi.fn(),
  },
  base44: { auth: {}, entities: {}, functions: {} },
}));

const isNative = vi.fn(() => false);
vi.mock("@/lib/mobile/native", () => ({
  isNative: () => isNative(),
  authRedirectUrl: (p) => (isNative() ? "app.inktracker.mobile://mobile-auth" : `https://www.inktracker.app${p}`),
  openAuthRedirect: vi.fn(),
}));

import LoginModal from "../LoginModal";

function setHash(h) {
  window.history.replaceState(null, "", `/${h}`);
}

beforeEach(() => {
  isNative.mockReturnValue(false);
  signInWithOtp.mockClear();
  setHash("");
});
afterEach(() => setHash(""));

describe("dead sign-in link is explained, not silently swallowed", () => {
  it("surfaces an expired/used link on mount", async () => {
    setHash("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
    render(<LoginModal isOpen />);
    // Must explain the prefetch cause — otherwise users retry the same dead
    // link, which is precisely what happened.
    expect(await screen.findByText(/already been used or has expired/i)).toBeTruthy();
    expect(screen.getByText(/scan for viruses/i)).toBeTruthy();
  });

  it("never shows Supabase's raw wording", async () => {
    setHash("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
    render(<LoginModal isOpen />);
    await screen.findByText(/already been used or has expired/i);
    expect(screen.queryByText(/Email link is invalid or has expired/)).toBeNull();
  });

  it("clears the hash so a refresh doesn't re-show a stale error", async () => {
    setHash("#error=access_denied&error_code=otp_expired");
    render(<LoginModal isOpen />);
    await screen.findByText(/couldn't be used|already been used/i);
    expect(window.location.hash).toBe("");
  });

  it("stays quiet on a normal load", () => {
    render(<LoginModal isOpen />);
    expect(screen.queryByText(/expired/i)).toBeNull();
    expect(screen.queryByText(/couldn't be used/i)).toBeNull();
    expect(screen.queryByText(/didn't work/i)).toBeNull();
  });

  // The dangerous false positive: a SUCCESSFUL callback uses the same hash.
  it("does not treat a successful token callback as a failure", async () => {
    setHash("#access_token=abc&refresh_token=def&type=magiclink");
    render(<LoginModal isOpen />);
    await waitFor(() => {
      expect(screen.queryByText(/expired|couldn't be used/i)).toBeNull();
    });
  });
});

describe("magic-link copy tells you WHERE to open it", () => {
  async function requestLink() {
    render(<LoginModal isOpen />);
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "truman@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /email me a sign-in link/i }));
    await waitFor(() => expect(signInWithOtp).toHaveBeenCalled());
  }

  it("on native, says to open it on this phone", async () => {
    // The native link carries the app's custom scheme; a desktop browser
    // cannot open it, so "check your email" alone is a dead end.
    isNative.mockReturnValue(true);
    await requestLink();
    expect(await screen.findByText(/on this phone/i)).toBeTruthy();
  });

  it("on web, keeps the plain wording", async () => {
    isNative.mockReturnValue(false);
    await requestLink();
    expect(await screen.findByText(/check truman@example\.com for a sign-in link/i)).toBeTruthy();
    expect(screen.queryByText(/on this phone/i)).toBeNull();
  });
});

describe("the autofill trap is named, so it becomes a self-serve reset", () => {
  async function failPassword() {
    render(<LoginModal isOpen />);
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "truman@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), { target: { value: "wrong-guess" } });
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
    await screen.findByText(/couldn't sign you in with that password/i);
  }

  it("explains on native why the app differs from their computer", async () => {
    isNative.mockReturnValue(true);
    await failPassword();
    expect(screen.getByText(/signs you in automatically on your computer/i)).toBeTruthy();
    expect(screen.getByText(/can't use those/i)).toBeTruthy();
  });

  // On the web the browser IS autofilling, so the explanation would be
  // nonsense — it only makes sense where autofill is unavailable.
  it("omits it on the web", async () => {
    isNative.mockReturnValue(false);
    await failPassword();
    expect(screen.queryByText(/signs you in automatically on your computer/i)).toBeNull();
  });

  it("still offers both recovery paths", async () => {
    isNative.mockReturnValue(true);
    await failPassword();
    // Two magic-link buttons render here by design: one inside the recovery
    // panel and the standing one under the "or" divider.
    expect(screen.getAllByRole("button", { name: /email me a sign-in link/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /reset password/i }).length).toBeGreaterThan(0);
  });
});
