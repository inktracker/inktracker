// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import OrderJobCostSection from "../OrderJobCostSection";

const noop = () => {};

const PROPS = {
  order: { total: 500, actual_cost: 0 },
  showJobCost: true,
  setShowJobCost: noop,
  estimatedHours: "", setEstimatedHours: noop,
  laborHours: "", setLaborHours: noop,
  actualCost: "", setActualCost: noop,
  laborCost: "", setLaborCost: noop,
  assignedPress: "", setAssignedPress: noop,
  assignedOperator: "", setAssignedOperator: noop,
  presses: [],
  employees: [],
  handleSaveJobCost: noop,
  savingCost: false,
  costSaved: false,
};

describe("OrderJobCostSection", () => {
  it("renders the job costing fields when expanded", () => {
    render(<OrderJobCostSection {...PROPS} />);
    expect(screen.getByText("Job Costing & Production")).toBeTruthy();
    expect(screen.getByText("Material Cost")).toBeTruthy();
    expect(screen.getByText("Assigned Press")).toBeTruthy();
  });
});
