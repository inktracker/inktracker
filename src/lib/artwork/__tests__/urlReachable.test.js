import { describe, it, expect, vi, afterEach } from "vitest";
import { probeUrl } from "../urlReachable";

afterEach(() => vi.unstubAllGlobals());

describe("probeUrl", () => {
  it("returns true for a reachable URL", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    await expect(probeUrl("https://x/artwork.pdf")).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledWith("https://x/artwork.pdf", { method: "HEAD" });
  });

  it("returns false when the server rejects (dead public-bucket URL)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400 }));
    await expect(probeUrl("https://x/object/public/artwork/a.pdf")).resolves.toBe(false);
  });

  it("returns false when fetch throws (network/CORS)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(probeUrl("https://x/a.pdf")).resolves.toBe(false);
  });

  it("returns false for an empty/missing URL without fetching", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    await expect(probeUrl("")).resolves.toBe(false);
    await expect(probeUrl(null)).resolves.toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
