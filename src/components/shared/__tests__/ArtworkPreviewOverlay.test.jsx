// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/uploadFile", () => ({ signArtworkUrl: () => Promise.resolve(null) }));

import ArtworkPreviewOverlay from "../ArtworkPreviewOverlay";

afterEach(() => vi.unstubAllGlobals());

const ART = { name: "proof.png", url: "https://x/storage/v1/object/public/artwork/proof.png" };

describe("ArtworkPreviewOverlay — URL preflight (#681)", () => {
  it("renders the media once the URL probes reachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    render(<ArtworkPreviewOverlay art={ART} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByAltText("proof.png")).toBeTruthy());
    // Download link only appears for a verified URL
    expect(screen.getByText("Download")).toBeTruthy();
  });

  it("shows a friendly message — never the raw embed — when the URL is dead", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400 }));
    const { container } = render(<ArtworkPreviewOverlay art={ART} onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText(/couldn.t be loaded right now/i)).toBeTruthy()
    );
    // No <img>/<object>/<iframe> may mount with the dead URL (that's what
    // rendered the storage API's raw JSON error to a customer).
    expect(container.querySelector("img, object, iframe")).toBeNull();
    // And no Download link pointing at the dead URL either.
    expect(screen.queryByText("Download")).toBeNull();
  });

  it("treats a fetch failure (network/CORS) as unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<ArtworkPreviewOverlay art={ART} onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText(/couldn.t be loaded right now/i)).toBeTruthy()
    );
  });
});
