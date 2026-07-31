import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { artworkProxyUrl } from "../proxyUrl";

const SUPA = "https://x.supabase.co";

describe("artworkProxyUrl (M-1)", () => {
  beforeEach(() => vi.stubEnv("VITE_SUPABASE_URL", SUPA));
  afterEach(() => vi.unstubAllEnvs());

  it("builds a token-gated proxy link from a bare path", () => {
    const u = artworkProxyUrl({ type: "quote", id: "q1", token: "tok", pathOrUrl: "123-abc.png" });
    expect(u).toBe(`${SUPA}/functions/v1/artworkProof?type=quote&id=q1&token=tok&path=123-abc.png`);
  });

  it("resolves the path out of a public storage url", () => {
    const u = artworkProxyUrl({
      type: "order", id: "o1", token: "t2",
      pathOrUrl: `${SUPA}/storage/v1/object/public/artwork/sub/dir/p.jpg`,
    });
    expect(u).toBe(`${SUPA}/functions/v1/artworkProof?type=order&id=o1&token=t2&path=sub%2Fdir%2Fp.jpg`);
  });

  it("appends &w= for thumbnail requests, omits it otherwise", () => {
    const u = artworkProxyUrl({ type: "quote", id: "q1", token: "tok", pathOrUrl: "123-abc.png", width: 640 });
    expect(u).toBe(`${SUPA}/functions/v1/artworkProof?type=quote&id=q1&token=tok&path=123-abc.png&w=640`);
    // Junk widths are dropped rather than emitting w=NaN — the proxy
    // whitelists widths server-side anyway; this just keeps URLs clean.
    for (const bad of [undefined, null, 0, -5, "abc"]) {
      const v = artworkProxyUrl({ type: "quote", id: "q1", token: "tok", pathOrUrl: "123-abc.png", width: bad });
      expect(v).toBe(`${SUPA}/functions/v1/artworkProof?type=quote&id=q1&token=tok&path=123-abc.png`);
    }
  });

  it("returns null when id/token/path is missing (caller falls back)", () => {
    expect(artworkProxyUrl({ type: "quote", id: "", token: "t", pathOrUrl: "p.png" })).toBeNull();
    expect(artworkProxyUrl({ type: "quote", id: "q", token: "", pathOrUrl: "p.png" })).toBeNull();
    expect(artworkProxyUrl({ type: "quote", id: "q", token: "t", pathOrUrl: "" })).toBeNull();
    expect(artworkProxyUrl({ type: "quote", id: "q", token: "t", pathOrUrl: "http://x/not-artwork.png" })).toBeNull();
  });
});
