// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import OrderNotesIcon, { orderNotesTooltip } from "../OrderNotesIcon";

describe("orderNotesTooltip", () => {
  it("returns trimmed notes", () => {
    expect(orderNotesTooltip({ notes: "  Rush job — call before printing  " }))
      .toBe("Rush job — call before printing");
  });

  it("empty for missing/blank/non-string notes", () => {
    expect(orderNotesTooltip({})).toBe("");
    expect(orderNotesTooltip({ notes: "   " })).toBe("");
    expect(orderNotesTooltip({ notes: 42 })).toBe("");
    expect(orderNotesTooltip(null)).toBe("");
  });

  it("truncates very long notes for the tooltip", () => {
    const t = orderNotesTooltip({ notes: "x".repeat(1000) });
    expect(t.length).toBeLessThanOrEqual(400);
    expect(t.endsWith("…")).toBe(true);
  });
});

describe("OrderNotesIcon", () => {
  it("renders nothing when the order has no notes", () => {
    const { container } = render(<OrderNotesIcon order={{ notes: "" }} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders with the notes as tooltip when present", () => {
    const { container } = render(<OrderNotesIcon order={{ notes: "Gray hoodies, not black" }} />);
    const el = container.firstChild;
    expect(el).not.toBeNull();
    expect(el.getAttribute("title")).toBe("Gray hoodies, not black");
  });
});
