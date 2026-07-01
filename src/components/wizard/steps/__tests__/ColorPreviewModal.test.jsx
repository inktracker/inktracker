// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ColorPreviewModal from "../ColorPreviewModal";

describe("ColorPreviewModal", () => {
  it("renders nothing when there is no colorPreview", () => {
    const { container } = render(<ColorPreviewModal colorPreview={null} setColorPreview={() => {}} bc="#000" />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the color name and the active image", () => {
    render(
      <ColorPreviewModal
        colorPreview={{ colorName: "Forest Green", images: [{ url: "http://x/a.png", label: "Front" }] }}
        setColorPreview={() => {}}
        bc="#123"
      />,
    );
    expect(screen.getByText("Forest Green")).toBeTruthy();
    expect(screen.getByAltText(/Forest Green/)).toBeTruthy();
  });

  it("closes on the ✕ button", () => {
    const setColorPreview = vi.fn();
    render(
      <ColorPreviewModal
        colorPreview={{ colorName: "Red", images: [] }}
        setColorPreview={setColorPreview}
        bc="#123"
      />,
    );
    fireEvent.click(screen.getByText("✕"));
    expect(setColorPreview).toHaveBeenCalledWith(null);
  });
});
