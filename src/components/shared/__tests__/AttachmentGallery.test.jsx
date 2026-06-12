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

describe("AttachmentGallery — upload/remove", () => {
  it("shows the Add tile only when onUpload is provided", () => {
    const { rerender } = render(<AttachmentGallery record={RECORD} />);
    expect(screen.queryByText("Add files")).toBeNull();
    rerender(<AttachmentGallery record={RECORD} onUpload={() => {}} />);
    expect(screen.getByText("Add files")).toBeTruthy();
  });

  it("renders the Add tile even when there are no attachments (so you can start)", () => {
    render(<AttachmentGallery record={{ selected_artwork: [] }} onUpload={() => {}} />);
    expect(screen.getByText("Add files")).toBeTruthy();
  });

  it("shows a spinner + disables the input while uploading", () => {
    render(<AttachmentGallery record={RECORD} onUpload={() => {}} uploading />);
    expect(screen.getByText("Uploading…")).toBeTruthy();
  });

  it("calls onRemove only for record-level attachments, not imprint art", () => {
    const onRemove = vi.fn();
    render(<AttachmentGallery record={RECORD} onUpload={() => {}} onRemove={onRemove} />);
    // mockup.png is record-level (removable); logo.pdf is imprint-level (not)
    const removeButtons = screen.getAllByTitle("Remove attachment");
    expect(removeButtons).toHaveLength(1);
    fireEvent.click(removeButtons[0]);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove.mock.calls[0][0].name).toBe("mockup.png");
  });

  it("surfaces an upload error", () => {
    render(<AttachmentGallery record={RECORD} onUpload={() => {}} uploadError="Upload failed." />);
    expect(screen.getByText("Upload failed.")).toBeTruthy();
  });
});
