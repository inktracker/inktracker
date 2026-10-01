// @vitest-environment jsdom
//
// Mockup proofs show the customer a PICTURE of the mockup, not an embedded
// PDF (Android phones can't draw PDFs inline). Plain PDFs keep the PDF view.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

vi.mock("@/api/supabaseClient", () => ({ base44: { functions: { invoke: vi.fn() } } }));

const { ProofPreviewBlock } = await import("../ArtApproval.jsx");

afterEach(cleanup);

const pdf = { name: "Art-Proof-ORD-1.pdf", url: "https://x/artwork/1700000000000-abc123.pdf", _src: "https://proxy/pdf" };

describe("ProofPreviewBlock", () => {
  it("mockup proof → the mockup picture; tapping opens the full proof", () => {
    const onEnlarge = vi.fn();
    render(<ProofPreviewBlock art={{ ...pdf, _previewThumb: "https://proxy/png?w=1024", _previewThumb2x: "https://proxy/png?w=2048" }} onEnlarge={onEnlarge} />);
    const img = screen.getByAltText("Art-Proof-ORD-1.pdf");
    expect(img.getAttribute("src")).toBe("https://proxy/png?w=1024");
    expect(document.querySelector("object")).toBeNull();
    fireEvent.click(screen.getByTitle("Open the full proof"));
    expect(onEnlarge).toHaveBeenCalled();
  });

  it("picture fails to load → falls back to the PDF view", () => {
    globalThis.fetch = vi.fn(() => new Promise(() => {}));
    render(<ProofPreviewBlock art={{ ...pdf, _previewThumb: "https://proxy/broken" }} onEnlarge={() => {}} />);
    fireEvent.error(screen.getByAltText("Art-Proof-ORD-1.pdf"));
    expect(screen.queryByTitle("Open the full proof")).toBeNull();
    expect(screen.getByText("PDF")).toBeTruthy();
  });

  it("plain PDF (no mockup picture) keeps the PDF view", () => {
    globalThis.fetch = vi.fn(() => new Promise(() => {}));
    render(<ProofPreviewBlock art={pdf} onEnlarge={() => {}} />);
    expect(screen.getByText("PDF")).toBeTruthy();
  });
});
