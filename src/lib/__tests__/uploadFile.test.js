import { describe, it, expect } from "vitest";
import { resolveArtworkPath } from "../artworkPath";

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
