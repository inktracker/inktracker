// @vitest-environment jsdom
//
// Regression: the custom display-title box wouldn't accept typing.
//
// Reported 2026-08-18 ("When I click customize header it won't let me type").
// The onChange handler called `update("customTitle", …)` — a function that
// does not exist anywhere in the file or its imports. Every keystroke threw
// ReferenceError, so the controlled input never updated and looked frozen.
//
// It shipped because eslint's recommended rules (including no-undef) were
// silently disabled by a config bug: the recommended configs were spread into
// an object whose later `rules:` key replaced them wholesale. That's fixed in
// eslint.config.js; this test pins the behavior the user actually cares about.

import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/api/supabaseClient", () => ({
  supabase: {
    functions: { invoke: vi.fn(() => Promise.resolve({ data: { matches: [] }, error: null })) },
  },
  base44: { entities: {}, auth: {}, functions: {} },
}));

import LineItemEditor from "../LineItemEditor";

function Harness({ onLiChange }) {
  const [li, setLi] = useState({
    id: "li-title-1",
    style: "6006",
    brand: "YP Classics",
    garmentColor: "Multicam Black/ Black",
    sizes: {},
    imprints: [],
  });
  return (
    <LineItemEditor
      li={li}
      onChange={(next) => { setLi(next); onLiChange?.(next); }}
      allLineItems={[li]}
      canRemove={false}
      onRemove={() => {}}
    />
  );
}

describe("custom display title", () => {
  it("accepts typing and reports it upward", () => {
    const onLiChange = vi.fn();
    render(<Harness onLiChange={onLiChange} />);

    // Opens the inline editor (button label depends on whether a title exists).
    fireEvent.click(screen.getByText("Customize title"));

    const input = screen.getByPlaceholderText(
      "Your title for this garment (leave blank to use the supplier's)"
    );

    // A single keystroke used to throw ReferenceError here.
    fireEvent.change(input, { target: { value: "Multicam Trucker" } });

    expect(onLiChange).toHaveBeenCalled();
    expect(onLiChange.mock.calls.at(-1)[0].customTitle).toBe("Multicam Trucker");
    expect(
      screen.getByPlaceholderText(
        "Your title for this garment (leave blank to use the supplier's)"
      ).value
    ).toBe("Multicam Trucker");
  });

  it("keeps the typed title through subsequent edits (no reset)", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Customize title"));
    const input = screen.getByPlaceholderText(
      "Your title for this garment (leave blank to use the supplier's)"
    );
    fireEvent.change(input, { target: { value: "Cap" } });
    fireEvent.change(input, { target: { value: "Cap — Multicam" } });
    expect(input.value).toBe("Cap — Multicam");
  });
});
