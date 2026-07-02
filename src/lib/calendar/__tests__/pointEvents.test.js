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
