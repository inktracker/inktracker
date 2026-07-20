// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import JobFeesSection from "../JobFeesSection";

const byScope = {
  root: [
    { key: "artFee", label: "Art fee", rate: 25, mode: "flat", basis: "per_job" },
    { key: "underbase", label: "Underbase", rate: 0.5, mode: "flat", basis: "per_print" }, // NOT per_job
  ],
  embroidery: [{ key: "handling", label: "Handling", rate: 10, mode: "percent", basis: "per_job" }],
  custom: {},
};

describe("JobFeesSection", () => {
  it("lists only per_job fees (per_print/garment excluded)", () => {
    render(<JobFeesSection addonsByScope={byScope} additionalCharges={[]} subtotal={800} onChange={() => {}} />);
    expect(screen.getByText("Art fee")).toBeTruthy();
    expect(screen.getByText("Handling")).toBeTruthy();
    expect(screen.queryByText("Underbase")).toBeNull();
  });

  it("toggling ON adds a flat jobfee_ additional charge (taxable)", () => {
    const onChange = vi.fn();
    render(<JobFeesSection addonsByScope={byScope} additionalCharges={[]} subtotal={800} onChange={onChange} />);
    fireEvent.click(screen.getByText("Art fee"));
    expect(onChange).toHaveBeenCalledWith([{ id: "jobfee_artFee", label: "Art fee", amount: 25, taxable: true }]);
  });

  it("toggling ON a percent fee snapshots rate% of the subtotal", () => {
    const onChange = vi.fn();
    render(<JobFeesSection addonsByScope={byScope} additionalCharges={[]} subtotal={800} onChange={onChange} />);
    fireEvent.click(screen.getByText("Handling"));
    expect(onChange).toHaveBeenCalledWith([{ id: "jobfee_handling", label: "Handling", amount: 80, taxable: true }]);
  });

  it("toggling OFF removes only that jobfee_ entry, keeping other charges", () => {
    const onChange = vi.fn();
    const charges = [
      { id: "jobfee_artFee", label: "Art fee", amount: 25, taxable: true },
      { id: "ac-1", label: "Shipping", amount: 15, taxable: true },
    ];
    render(<JobFeesSection addonsByScope={byScope} additionalCharges={charges} subtotal={800} onChange={onChange} />);
    fireEvent.click(screen.getByText("Art fee"));
    expect(onChange).toHaveBeenCalledWith([{ id: "ac-1", label: "Shipping", amount: 15, taxable: true }]);
  });

  it("renders nothing when the shop has no per_job fees", () => {
    const { container } = render(
      <JobFeesSection addonsByScope={{ root: [], embroidery: [], custom: {} }} additionalCharges={[]} onChange={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
