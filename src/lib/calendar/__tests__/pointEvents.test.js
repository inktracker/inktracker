import { describe, it, expect } from "vitest";
import { buildPointEvents } from "../pointEvents.js";

const completedChips = (map, date) =>
  (map[date] || []).filter((e) => e.step === "Completed");

describe("buildPointEvents — Completed chip dedup", () => {
  it("renders ONE Completed chip when step_dates and completed_date agree (the Line Life duplicate)", () => {
    // Real prod shape: dragging the completion chip wrote
    // step_dates.Completed while completed_date already held the same day —
    // both sources used to push a chip each.
    const order = {
      id: "o1",
      status: "Completed",
      completed_date: "2026-06-29",
      step_dates: { Completed: "2026-06-29" },
    };
    const map = buildPointEvents([order], []);
    expect(completedChips(map, "2026-06-29")).toHaveLength(1);
  });

  it("renders ONE Completed chip at completed_date when the two sources diverge", () => {
    const order = {
      id: "o1",
      status: "Completed",
      completed_date: "2026-06-27",
      step_dates: { Completed: "2026-06-29" },
    };
    const map = buildPointEvents([order], []);
    expect(completedChips(map, "2026-06-27")).toHaveLength(1);
    expect(completedChips(map, "2026-06-29")).toHaveLength(0);
  });

  it("still renders the planned Completed step chip while the order is in progress", () => {
    const order = {
      id: "o1",
      status: "Printing",
      step_dates: { Completed: "2026-07-10" },
    };
    const map = buildPointEvents([order], []);
    expect(completedChips(map, "2026-07-10")).toHaveLength(1);
  });

  it("falls back to the step chip for a Completed order missing completed_date (legacy rows)", () => {
    const order = {
      id: "o1",
      status: "Completed",
      completed_date: null,
      step_dates: { Completed: "2026-06-29" },
    };
    const map = buildPointEvents([order], []);
    expect(completedChips(map, "2026-06-29")).toHaveLength(1);
  });
});

describe("buildPointEvents — pre-existing behavior preserved", () => {
  it("keeps every other step chip on a Completed order (only the Completed step dedupes)", () => {
    const order = {
      id: "o1",
      status: "Completed",
      completed_date: "2026-06-29",
      step_dates: { "Pre-Press": "2026-06-25", Completed: "2026-06-29" },
    };
    const map = buildPointEvents([order], []);
    expect(map["2026-06-25"].map((e) => e.step)).toEqual(["Pre-Press"]);
    expect(completedChips(map, "2026-06-29")).toHaveLength(1);
  });

  it("expands a Printing range into start + end chips", () => {
    const order = {
      id: "o1",
      status: "Printing",
      step_dates: { Printing: { start: "2026-07-01", end: "2026-07-03" } },
    };
    const map = buildPointEvents([order], []);
    expect(map["2026-07-01"][0].step).toBe("Printing");
    expect(map["2026-07-03"][0].step).toBe("Printing");
  });

  it("adds Order Goods from order.date and a Due chip only while not Completed", () => {
    const active = { id: "o1", status: "Printing", date: "2026-07-01", due_date: "2026-07-05" };
    const done = { id: "o2", status: "Completed", completed_date: "2026-07-02", due_date: "2026-07-05" };
    const map = buildPointEvents([active, done], []);
    expect(map["2026-07-01"][0]).toMatchObject({ step: "Order Goods", isDue: false });
    const dueChips = map["2026-07-05"].filter((e) => e.isDue);
    expect(dueChips).toHaveLength(1);
    expect(dueChips[0].order.id).toBe("o1");
  });

  it("pushes quote lifecycle chips with ISO timestamps normalized to dates", () => {
    const quote = {
      id: "q1",
      sent_date: "2026-06-20",
      client_approved_at: "2026-06-22T15:30:00.000Z",
    };
    const map = buildPointEvents([], [quote]);
    expect(map["2026-06-20"][0]).toMatchObject({ kind: "quote", step: "Quote Sent" });
    expect(map["2026-06-22"][0]).toMatchObject({ kind: "quote", step: "Quote Approved" });
  });

  it("tolerates empty / missing inputs", () => {
    expect(buildPointEvents([], [])).toEqual({});
    expect(buildPointEvents(undefined, undefined)).toEqual({});
    expect(buildPointEvents([{ id: "o1", status: "Printing" }], [{}])).toEqual({});
  });
});

// ── Press-run chips (schedule ↔ calendar unification) ───────────────────────
describe("press-run events", () => {
  const base = { id: "o1", order_id: "ORD-1", status: "Pre-Press", due_date: "2026-08-15" };

  it("plots scheduled_date with the press name when both fields exist", () => {
    const map = buildPointEvents([{ ...base, scheduled_date: "2026-08-10", assigned_press: "Press 1" }], []);
    const runs = (map["2026-08-10"] || []).filter((e) => e.step === "Press Run");
    expect(runs).toHaveLength(1);
    expect(runs[0].press).toBe("Press 1");
    // ...and the due chip still lands on the due date — both views now
    // visible on one calendar (the 2026-06-06 disconnect).
    expect((map["2026-08-15"] || []).some((e) => e.isDue)).toBe(true);
  });

  it("no chip without a press assignment or without a date", () => {
    const noPress = buildPointEvents([{ ...base, scheduled_date: "2026-08-10" }], []);
    expect((noPress["2026-08-10"] || []).filter((e) => e.step === "Press Run")).toHaveLength(0);
    const noDate = buildPointEvents([{ ...base, assigned_press: "Press 1" }], []);
    expect(Object.values(noDate).flat().filter((e) => e.step === "Press Run")).toHaveLength(0);
  });

  it("completed orders don't get a press-run chip (planning aid, not history)", () => {
    const map = buildPointEvents([{ ...base, status: "Completed", completed_date: "2026-08-12", scheduled_date: "2026-08-10", assigned_press: "Press 1" }], []);
    expect(Object.values(map).flat().filter((e) => e.step === "Press Run")).toHaveLength(0);
  });

  it("normalizes legacy assigned_press object form to a display name", () => {
    const map = buildPointEvents([{ ...base, scheduled_date: "2026-08-10", assigned_press: { name: "Big Auto" } }], []);
    const runs = (map["2026-08-10"] || []).filter((e) => e.step === "Press Run");
    expect(runs).toHaveLength(1);
    expect(runs[0].press).toBe("Big Auto");
  });
});
