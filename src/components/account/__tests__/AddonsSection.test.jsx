// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/api/supabaseClient", () => ({
  base44: { entities: { Shop: { filter: vi.fn(() => Promise.resolve([])) } } },
}));

import AddonsSection, { DEFAULT_ADDONS } from "../AddonsSection";

describe("AddonsSection", () => {
  it("renders the default add-on rows and a save button", async () => {
    render(<AddonsSection user={{ email: "shop@example.com" }} />);
    // Default add-ons render as editable name inputs.
    expect(await screen.findByDisplayValue("Custom Tags")).toBeTruthy();
    expect(screen.getByDisplayValue("Ink Color Match")).toBeTruthy();
    expect(screen.getByText("Save Add-ons")).toBeTruthy();
    expect(DEFAULT_ADDONS.length).toBe(4);
  });
});
