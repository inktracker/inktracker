import { describe, it, expect } from "vitest";
import { resolveArtworkPath } from "../artworkPath";
// Import from the pure validation module — NOT from uploadFile.js,
// which transitively loads supabaseClient and fails in CI without
// VITE_SUPABASE_URL set. uploadFile.js re-exports these for runtime
// callers, but tests should always go to the pure source.
import {
  validateUploadCandidate,
  getLogoDownscaleDims,
  ALLOWED_UPLOAD_EXTS,
  MAX_UPLOAD_BYTES,
} from "../uploadValidation";

function fakeFile(name, size = 1000) {
  return { name, size };
}

describe("validateUploadCandidate", () => {
  it("accepts every whitelisted extension", () => {
    for (const ext of ALLOWED_UPLOAD_EXTS) {
      expect(validateUploadCandidate(fakeFile(`logo.${ext}`))).toBe(ext);
    }
  });

  it("accepts uppercase extensions (case-insensitive)", () => {
    expect(validateUploadCandidate(fakeFile("LOGO.PNG"))).toBe("png");
  });

  it("rejects executables and unknown types", () => {
    expect(() => validateUploadCandidate(fakeFile("payload.exe"))).toThrow(/isn't allowed/);
    expect(() => validateUploadCandidate(fakeFile("script.js"))).toThrow(/isn't allowed/);
    expect(() => validateUploadCandidate(fakeFile("notes.txt"))).toThrow(/isn't allowed/);
    expect(() => validateUploadCandidate(fakeFile("a.html"))).toThrow(/isn't allowed/);
  });

  it("rejects files with no extension", () => {
    expect(() => validateUploadCandidate(fakeFile("noext"))).toThrow(/isn't allowed/);
  });

  it("rejects null / undefined", () => {
    expect(() => validateUploadCandidate(null)).toThrow(/No file/);
    expect(() => validateUploadCandidate(undefined)).toThrow(/No file/);
  });

  it("rejects files larger than the cap with a helpful MB number", () => {
    const huge = fakeFile("big.png", MAX_UPLOAD_BYTES + 1);
    expect(() => validateUploadCandidate(huge)).toThrow(/25 MB/);
  });

  it("accepts files at exactly the cap", () => {
    const rightAtCap = fakeFile("ok.png", MAX_UPLOAD_BYTES);
    expect(() => validateUploadCandidate(rightAtCap)).not.toThrow();
  });

  it("ignores the size check when file.size is unset (some uploaders)", () => {
    expect(() => validateUploadCandidate({ name: "ok.png" })).not.toThrow();
  });

  it("rejects double-extension tricks (last extension wins)", () => {
    // A file named "logo.png.exe" has extension `exe` after split, so
    // it gets rejected — the attacker can't hide an executable behind
    // a fake png prefix.
    expect(() => validateUploadCandidate(fakeFile("logo.png.exe"))).toThrow(/isn't allowed/);
    expect(validateUploadCandidate(fakeFile("logo.exe.png"))).toBe("png");
  });
});

describe("resolveArtworkPath", () => {
  it("returns null for empty / falsy input", () => {
    expect(resolveArtworkPath("")).toBeNull();
    expect(resolveArtworkPath(null)).toBeNull();
    expect(resolveArtworkPath(undefined)).toBeNull();
  });

  it("returns a bare path unchanged", () => {
    expect(resolveArtworkPath("1738282838-x1y2z3.pdf")).toBe("1738282838-x1y2z3.pdf");
  });

  it("extracts the path from a public URL", () => {
    const url = "https://skmltfbibaqcjddmeqvi.supabase.co/storage/v1/object/public/artwork/1738282838-x1y2z3.pdf";
    expect(resolveArtworkPath(url)).toBe("1738282838-x1y2z3.pdf");
  });

  it("extracts the path from a signed URL", () => {
    const url = "https://skmltfbibaqcjddmeqvi.supabase.co/storage/v1/object/sign/artwork/1738282838-x1y2z3.pdf?token=eyJhbGciOiJ...";
    expect(resolveArtworkPath(url)).toBe("1738282838-x1y2z3.pdf");
  });

  it("decodes URL-encoded path segments", () => {
    const url = "https://x.supabase.co/storage/v1/object/public/artwork/some%20file%20with%20spaces.pdf";
    expect(resolveArtworkPath(url)).toBe("some file with spaces.pdf");
  });

  it("returns null for URLs in a different bucket", () => {
    const url = "https://x.supabase.co/storage/v1/object/public/avatars/1.png";
    expect(resolveArtworkPath(url)).toBeNull();
  });

  it("returns null for unrelated URLs", () => {
    expect(resolveArtworkPath("https://example.com/file.pdf")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// getLogoDownscaleDims — logo dimension cap (546 WORKER_LIMIT guard)
// ─────────────────────────────────────────────────────────────────────

describe("getLogoDownscaleDims", () => {
  it("returns null for logos already within the cap", () => {
    expect(getLogoDownscaleDims("png", 512, 512)).toBeNull();
    expect(getLogoDownscaleDims("jpg", 100, 400)).toBeNull();
  });

  it("caps the long edge at MAX_LOGO_DIMENSION preserving aspect ratio", () => {
    // The real-world case: Dragon Head's 4200×4200 logo → 70 MB PDF → 546.
    expect(getLogoDownscaleDims("png", 4200, 4200)).toEqual({ width: 512, height: 512 });
    expect(getLogoDownscaleDims("png", 4200, 2100)).toEqual({ width: 512, height: 256 });
    expect(getLogoDownscaleDims("jpeg", 1000, 4000)).toEqual({ width: 128, height: 512 });
  });

  it("never rounds a dimension to zero on extreme aspect ratios", () => {
    expect(getLogoDownscaleDims("png", 100000, 10)).toEqual({ width: 512, height: 1 });
  });

  it("passes non-raster formats through untouched (canvas can't re-encode them)", () => {
    expect(getLogoDownscaleDims("pdf", 4200, 4200)).toBeNull();
    expect(getLogoDownscaleDims("ai", 4200, 4200)).toBeNull();
    expect(getLogoDownscaleDims("eps", 4200, 4200)).toBeNull();
    expect(getLogoDownscaleDims("psd", 4200, 4200)).toBeNull();
  });

  it("is case-insensitive on extension", () => {
    expect(getLogoDownscaleDims("PNG", 4200, 4200)).toEqual({ width: 512, height: 512 });
  });

  it("returns null on garbage dimensions rather than guessing", () => {
    expect(getLogoDownscaleDims("png", NaN, 4200)).toBeNull();
    expect(getLogoDownscaleDims("png", 0, 4200)).toBeNull();
    expect(getLogoDownscaleDims("png", undefined, undefined)).toBeNull();
  });
});
