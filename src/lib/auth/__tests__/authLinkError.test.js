import { describe, it, expect } from "vitest";
import { parseAuthLinkError, isAuthSuccessHash } from "../authLinkError";

describe("parseAuthLinkError", () => {
  it("explains an expired/used sign-in link without blaming the user", () => {
    const r = parseAuthLinkError(
      "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    );
    expect(r.code).toBe("otp_expired");
    // The prefetch explanation is the whole point — users retry the SAME dead
    // link otherwise, which is exactly what happened before this shipped.
    expect(r.message).toMatch(/already been used or has expired/i);
    expect(r.message).toMatch(/scan for viruses/i);
    expect(r.message).toMatch(/fresh one/i);
  });

  it("falls back to actionable copy for an unrecognised code", () => {
    const r = parseAuthLinkError("#error=server_error&error_code=something_new");
    expect(r.code).toBe("something_new");
    expect(r.message).toMatch(/fresh sign-in link/i);
  });

  it("uses `error` when no error_code is present", () => {
    const r = parseAuthLinkError("#error=access_denied");
    expect(r.code).toBe("access_denied");
    expect(r.message).toMatch(/couldn't be used/i);
  });

  it("keeps Supabase's raw wording for logs but not for display", () => {
    const r = parseAuthLinkError(
      "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    );
    expect(r.raw).toBe("Email link is invalid or has expired");
    expect(r.message).not.toContain("Email link is invalid or has expired");
  });

  // The dangerous false positive: a SUCCESSFUL callback carries access_token
  // in the same hash. Reading that as an error would show a scary message to
  // someone who just signed in fine.
  it("returns null for a successful token hash", () => {
    expect(parseAuthLinkError("#access_token=abc123&refresh_token=def&type=magiclink")).toBeNull();
  });

  it("returns null for empty / missing / junk input", () => {
    for (const v of ["", "#", "?", null, undefined, 42, {}]) {
      expect(parseAuthLinkError(v)).toBeNull();
    }
  });

  it("accepts a query string as well as a hash", () => {
    expect(parseAuthLinkError("?error_code=otp_expired").code).toBe("otp_expired");
  });
});

describe("isAuthSuccessHash", () => {
  it("recognises a token callback", () => {
    expect(isAuthSuccessHash("#access_token=abc&refresh_token=def")).toBe(true);
    expect(isAuthSuccessHash("#refresh_token=def")).toBe(true);
  });

  it("is false for errors and for nothing", () => {
    expect(isAuthSuccessHash("#error=access_denied&error_code=otp_expired")).toBe(false);
    expect(isAuthSuccessHash("")).toBe(false);
    expect(isAuthSuccessHash(null)).toBe(false);
  });
});
