// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import WizardSuccessScreen from "../WizardSuccessScreen";

const GARMENT = { id: "g1", style: { name: "Staple Tee" }, color: "Black", sizes: { M: "25" } };

describe("WizardSuccessScreen", () => {
  it("renders the confirmation with the submitted garment + estimated total", () => {
    render(
      <WizardSuccessScreen
        submittedGarments={[GARMENT]}
        validGarments={[]}
        imprints={[{ location: "Front", colors: 1 }]}
        rush={false}
        liveTotals={{ total: 123 }}
        total={123}
        bc="#000"
        onReset={() => {}}
      />,
    );
    expect(screen.getByText("Order Request Submitted")).toBeTruthy();
    expect(screen.getByText(/Staple Tee · Black/)).toBeTruthy();
    expect(screen.getByText("$123.00")).toBeTruthy();
  });

  it("fires onReset from the Start Another Order button", () => {
    const onReset = vi.fn();
    render(
      <WizardSuccessScreen
        submittedGarments={[GARMENT]}
        validGarments={[]}
        imprints={[]}
        rush={false}
        liveTotals={null}
        total={0}
        bc="#000"
        onReset={onReset}
      />,
    );
    fireEvent.click(screen.getByText("Start Another Order"));
    expect(onReset).toHaveBeenCalled();
  });
});
