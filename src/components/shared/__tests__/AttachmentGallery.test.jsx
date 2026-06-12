// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/lib/uploadFile", () => ({ signArtworkUrl: () => Promise.resolve(null) }));

import AttachmentGallery from "../AttachmentGallery";

const RECORD = {
  selected_artwork: [{ id: "m1", name: "mockup.png", url: "http://x/mockup.png", source: "proof" }],
  line_items: [{ imprints: [{ artwork_id: "a2", artwork_name: "logo.pdf", artwork_url: "http://x/logo.pdf", location: "Front", title: "Logo" }] }],
};

describe("AttachmentGallery", () => {
  it("renders a thumbnail per collected attachment with a count", () => {
    render(<AttachmentGallery record={RECORD} />);
    expect(screen.getByText("mockup.png")).toBeTruthy();
    expect(screen.getByText("logo.pdf")).toBeTruthy();
    expect(screen.getByText("(2)")).toBeTruthy();
    expect(screen.getByText("Front · Logo")).toBeTruthy(); // imprint placement
  });

  it("renders nothing when there are no attachments", () => {
    const { container } = render(<AttachmentGallery record={{ selected_artwork: [] }} />);
    expect(container.firstChild).toBeNull();
  });

  it("opens the preview overlay on click", () => {
    render(<AttachmentGallery record={RECORD} backLabel="Back to quote" />);
    fireEvent.click(screen.getByText("mockup.png").closest("button"));
    expect(screen.getByText("Back to quote")).toBeTruthy(); // overlay back button
  });
});
