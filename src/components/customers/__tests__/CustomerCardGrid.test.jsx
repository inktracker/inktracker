// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import CustomerCardGrid from "../CustomerCardGrid";

const CUSTOMERS = [
  { id: "c1", name: "Jane Smith", company: "Acme Co", email: "jane@acme.test" },
];

describe("CustomerCardGrid", () => {
  it("renders a card per customer with an Edit action", () => {
    render(
      <CustomerCardGrid
        filtered={CUSTOMERS}
        invoiceStats={{}}
        artworkByCustomer={{}}
        navigate={() => {}}
        setEditing={() => {}}
        setConfirmDelete={() => {}}
        setArtworkNote={() => {}}
        setArtworkColorCount={() => {}}
      />
    );
    expect(screen.getByText("Acme Co")).toBeTruthy();
    expect(screen.getByText("Edit")).toBeTruthy();
  });
});
