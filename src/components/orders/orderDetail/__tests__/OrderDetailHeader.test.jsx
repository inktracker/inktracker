// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import OrderDetailHeader from "../OrderDetailHeader";

const ORDER = {
  id: "o1",
  order_id: "ORD-2026-001",
  quote_id: "Q-2026-001",
  status: "Printing",
  paid: false,
  order_date: "2026-06-01",
  due_date: "2026-06-10",
  assigned_operator: "Sam",
};

describe("OrderDetailHeader", () => {
  it("renders the order id, client, and paid state", () => {
    render(
      <OrderDetailHeader
        order={ORDER}
        displayClient="Acme Co"
        displayJobTitle="Team Tees"
        artworkFiles={[{ id: "a1" }]}
        onClose={() => {}}
        onAdvance={() => {}}
        onRevert={() => {}}
      />
    );
    expect(screen.getByText(/ORD-2026-001/)).toBeTruthy();
    expect(screen.getByText("Acme Co")).toBeTruthy();
    expect(screen.getByText("Unpaid")).toBeTruthy();
    expect(screen.getByText("1 artwork file")).toBeTruthy();
  });
});
