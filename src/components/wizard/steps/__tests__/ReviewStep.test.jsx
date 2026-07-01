// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock the pricing module's price helper so the render doesn't depend on
// the module-level shop pricing config being loaded — the extraction is
// a pure structural move and this test only asserts the Step-3 JSX mounts
// and shows its key labels.
vi.mock("@/components/shared/pricing", async () => {
  return {
    calcLinkedLinePrice: () => ({ lineTotal: 100, qty: 25 }),
    BIG_SIZES: ["2XL", "3XL"],
    SIZES: ["S", "M", "L", "XL", "2XL", "3XL"],
    fmtMoney: (n) => `$${Number(n || 0).toFixed(2)}`,
    fmtDate: (d) => String(d),
    getMinOrderQty: () => 25,
    getWizardRushDisplay: () => ({ rate: 0.2, daysLabel: "7 days" }),
  };
});

import ReviewStep from "../ReviewStep";

const VALID_GARMENTS = [
  { id: "g1", style: { name: "AS Colour 5001", garmentCost: 6.5 }, color: "Black", sizes: { M: 25 } },
];
const IMPRINTS = [{ id: "p1", location: "Front", colors: 1, technique: "Screen Print" }];
const CONTACT = { name: "Jane", email: "jane@example.com", phone: "", company: "", dueDate: "" };

describe("ReviewStep", () => {
  it("renders the review summary + submit button", () => {
    render(
      <ReviewStep
        bc="#0d9488" bcDark="#0a6d64"
        validGarments={VALID_GARMENTS}
        imprints={IMPRINTS}
        artFiles={{}}
        rush={false}
        contact={CONTACT}
        liveTotals={{ total: 100 }}
        total={100}
        totalQtyAll={25}
        livePpp={4}
        submitError=""
        submitting={false}
        handleSubmit={vi.fn()}
        setStep={vi.fn()}
      />
    );
    expect(screen.getByText("Review & Submit")).toBeTruthy();
    expect(screen.getByText("Pricing Summary")).toBeTruthy();
    expect(screen.getByText("Submit Order Request →")).toBeTruthy();
  });
});
