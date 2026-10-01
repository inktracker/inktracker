import { describe, it, expect, beforeEach } from "vitest";
import {
  PRODUCTION_STAGES,
  DEFAULT_TASKS,
  ORDER_GOODS_AUTO_DERIVED_TASKS,
  loadShopProductionTasks,
  getStageTasks,
  getAllStageTasks,
  getMissingAutoDerivedTasks,
} from "../productionTasks";

beforeEach(() => {
  // Reset module-level cache between tests so one test's loadShop... call
  // doesn't bleed into the next.
  loadShopProductionTasks(null);
});

describe("PRODUCTION_STAGES", () => {
  it("matches the slim 4-stage pipeline (no legacy Finishing / QC / Packing)", () => {
    expect(PRODUCTION_STAGES).toEqual([
      "Art Approval",
      "Order Goods",
      "Pre-Press",
      "Printing",
    ]);
  });
});

describe("ORDER_GOODS_AUTO_DERIVED_TASKS", () => {
  it("contains exactly the two canonical names that auto-check from goods_progress", () => {
    expect(ORDER_GOODS_AUTO_DERIVED_TASKS).toEqual([
      "Place blank order",
      "Receive goods",
    ]);
  });
});

describe("getStageTasks", () => {
  it("returns DEFAULT_TASKS when no shop config is loaded", () => {
    expect(getStageTasks("Art Approval")).toEqual(DEFAULT_TASKS["Art Approval"]);
    expect(getStageTasks("Printing")).toEqual(DEFAULT_TASKS["Printing"]);
  });

  it("returns the shop's override when one is configured", () => {
    loadShopProductionTasks({
      "Art Approval": ["Custom step 1", "Custom step 2"],
    });
    expect(getStageTasks("Art Approval")).toEqual(["Custom step 1", "Custom step 2"]);
  });

  it("falls back to defaults for stages the shop hasn't customized", () => {
    loadShopProductionTasks({ "Art Approval": ["Custom"] });
    expect(getStageTasks("Pre-Press")).toEqual(DEFAULT_TASKS["Pre-Press"]);
  });

  it("falls back to defaults when shop config has an empty array for a stage", () => {
    loadShopProductionTasks({ "Art Approval": [] });
    expect(getStageTasks("Art Approval")).toEqual(DEFAULT_TASKS["Art Approval"]);
  });

  it("filters out non-string and empty-string tasks in the shop override", () => {
    loadShopProductionTasks({
      "Art Approval": ["Real task", "  ", "", null, 42, "Another real one"],
    });
    expect(getStageTasks("Art Approval")).toEqual(["Real task", "Another real one"]);
  });

  it("returns a fresh array — mutations don't leak into the cache", () => {
    const a = getStageTasks("Art Approval");
    a.push("MUTATED");
    expect(getStageTasks("Art Approval")).not.toContain("MUTATED");
  });

  it("returns [] for an unknown stage", () => {
    expect(getStageTasks("Nonexistent Stage")).toEqual([]);
  });
});

describe("getAllStageTasks", () => {
  it("returns a complete map: one entry per PRODUCTION_STAGES item", () => {
    const all = getAllStageTasks();
    expect(Object.keys(all).sort()).toEqual([...PRODUCTION_STAGES].sort());
  });

  it("each stage's list matches getStageTasks(stage)", () => {
    const all = getAllStageTasks();
    for (const stage of PRODUCTION_STAGES) {
      expect(all[stage]).toEqual(getStageTasks(stage));
    }
  });
});

describe("DEFAULT_TASKS goods split", () => {
  it("Order Goods is ordering-only; Receive goods leads Pre-Press", () => {
    // The 2026-09-28 move: receiving happens on Pre-Press so Order Goods
    // clearly means 'still needs ordering'.
    expect(DEFAULT_TASKS["Order Goods"]).toEqual(["Place blank order"]);
    expect(DEFAULT_TASKS["Pre-Press"][0]).toBe("Receive goods");
    expect(DEFAULT_TASKS["Pre-Press"]).toContain("Burn screens");
  });
});

describe("getMissingAutoDerivedTasks", () => {
  it("returns [] for stages with no auto-derived tasks", () => {
    expect(getMissingAutoDerivedTasks("Printing", [])).toEqual([]);
  });

  it("Art Approval warns when the proof / approval tasks are renamed away", () => {
    expect(getMissingAutoDerivedTasks("Art Approval", [])).toEqual(["Send proof to customer", "Get approval"]);
    expect(getMissingAutoDerivedTasks("Art Approval", ["Send proof to customer", "Get approval"])).toEqual([]);
  });

  it("Order Goods expects only 'Place blank order'", () => {
    expect(getMissingAutoDerivedTasks("Order Goods", [])).toEqual(["Place blank order"]);
    expect(getMissingAutoDerivedTasks("Order Goods", ["Place blank order"])).toEqual([]);
    // Receive goods is NOT an Order Goods auto-task anymore.
    expect(getMissingAutoDerivedTasks("Order Goods", ["Inspect goods"])).toEqual(["Place blank order"]);
  });

  it("Pre-Press expects only 'Receive goods'", () => {
    expect(getMissingAutoDerivedTasks("Pre-Press", [])).toEqual(["Receive goods"]);
    expect(getMissingAutoDerivedTasks("Pre-Press", ["Receive goods", "Burn screens"])).toEqual([]);
    expect(getMissingAutoDerivedTasks("Pre-Press", ["Burn screens"])).toEqual(["Receive goods"]);
  });

  it("returns the stage's expected task when input is null/undefined/not an array", () => {
    expect(getMissingAutoDerivedTasks("Order Goods", null)).toEqual(["Place blank order"]);
    expect(getMissingAutoDerivedTasks("Pre-Press", undefined)).toEqual(["Receive goods"]);
    expect(getMissingAutoDerivedTasks("Order Goods", "not an array")).toEqual(["Place blank order"]);
  });

  it("is whitespace/case-sensitive — 'place blank order' counts as missing", () => {
    expect(getMissingAutoDerivedTasks("Order Goods", ["place blank order"]))
      .toEqual(["Place blank order"]);
    expect(getMissingAutoDerivedTasks("Order Goods", [" Place blank order "]))
      .toEqual(["Place blank order"]);
  });
});
