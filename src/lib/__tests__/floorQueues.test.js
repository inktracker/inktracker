import { describe, it, expect } from "vitest";
import { isReadyForPress, readyForPress, pressOptions, byScheduledThenDue } from "../floorQueues";

const orders = [
  { id: 1, status: "Art Approval", due_date: "2026-09-20", assigned_press: "Press 1" },
  { id: 2, status: "Order Goods", due_date: "2026-09-21" },
  { id: 3, status: "Pre-Press", due_date: "2026-09-25", assigned_press: "Press 2" },
  { id: 4, status: "Printing", due_date: "2026-09-23", assigned_press: "press 1" },
  { id: 5, status: "Printing", scheduled_date: "2026-09-22", due_date: "2026-09-30" },
  { id: 6, status: "Completed", due_date: "2026-09-19", assigned_press: "Press 3" },
  { id: 7, status: "Printing" }, // undated → last
];

describe("ready for press", () => {
  it("is exactly Pre-Press + Printing (art approved, goods in), never earlier or Completed", () => {
    expect(orders.filter(isReadyForPress).map((o) => o.id)).toEqual([3, 4, 5, 7]);
  });

  it("sorts by scheduled date, then due date, undated last", () => {
    expect(readyForPress(orders).map((o) => o.id)).toEqual([5, 4, 3, 7]);
    expect([{ due_date: "2026-01-02" }, { scheduled_date: "2026-01-01", due_date: "2026-12-31" }].sort(byScheduledThenDue)[0].scheduled_date).toBe("2026-01-01");
  });

  it("narrows to one press, case-insensitively", () => {
    expect(readyForPress(orders, "Press 1").map((o) => o.id)).toEqual([4]);
    expect(readyForPress(orders, "press 2").map((o) => o.id)).toEqual([3]);
    expect(readyForPress(orders, "").length).toBe(4);
  });

  it("press options come only from ready jobs, deduped, natural-sorted", () => {
    // Press 3 is on a Completed job and Press 1 on an Art Approval job → excluded
    expect(pressOptions(orders)).toEqual(["press 1", "Press 2"]);
    expect(pressOptions([{ status: "Printing", assigned_press: "Press 10" }, { status: "Printing", assigned_press: "Press 2" }])).toEqual(["Press 2", "Press 10"]);
    expect(pressOptions([])).toEqual([]);
  });
});
