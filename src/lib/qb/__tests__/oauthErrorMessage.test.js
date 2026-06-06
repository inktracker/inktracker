// Pinned contract for OAuth callback error copy. If the message map
// drifts away from the codes qbOAuthCallback can emit, users see
// raw error codes ("Connection failed: state_expired") instead of
// the helpful "Your connection request took too long. Please click
// Connect QuickBooks again..." — exactly the regression #340
// shipped by adding state_expired without updating the map.

import { describe, it, expect } from "vitest";
import { qbOAuthErrorMessage } from "../oauthErrorMessage";

describe("qbOAuthErrorMessage", () => {
  it("returns empty string for falsy input (no qb_error param)", () => {
    expect(qbOAuthErrorMessage(null)).toBe("");
    expect(qbOAuthErrorMessage(undefined)).toBe("");
    expect(qbOAuthErrorMessage("")).toBe("");
  });

  it("returns friendly copy for every code qbOAuthCallback emits", () => {
    // If this list drops a code, qbOAuthCallback will redirect with a
    // qb_error= value that falls through to the raw-render branch.
    // Keep in sync with supabase/functions/qbOAuthCallback/index.ts.
    const callbackCodes = [
      "state_mismatch",
      "state_expired",
      "missing_params",
      "token_exchange_failed",
      "malformed_token_response",
      "storage_failed",
      "server_error",
    ];
    for (const code of callbackCodes) {
      const msg = qbOAuthErrorMessage(code);
      expect(msg).toBeTruthy();
      // The raw-render fallback starts with "Connection failed:" —
      // a friendly message should NOT match that prefix verbatim.
      expect(msg.startsWith(`Connection failed: ${code}`)).toBe(false);
    }
  });

  it("state_expired explains the 30-minute window (regression check for #340)", () => {
    expect(qbOAuthErrorMessage("state_expired")).toMatch(/30 minutes/i);
  });

  it("falls back to a raw render for unknown codes", () => {
    // Better than nothing — at least the user sees a string instead
    // of a blank panel. Unknown codes likely indicate a callback
    // version drift, so the raw render also doubles as a debug aid.
    expect(qbOAuthErrorMessage("future_code_we_dont_know_yet")).toBe(
      "Connection failed: future_code_we_dont_know_yet",
    );
  });
});
