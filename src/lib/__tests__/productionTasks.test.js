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

describe("getMissingAutoDerivedTasks", () => {
  it("returns [] for stages other than Order Goods (no auto-derive anywhere else)", () => {
    expect(getMissingAutoDerivedTasks("Art Approval", [])).toEqual([]);
    expect(getMissingAutoDerivedTasks("Pre-Press", [])).toEqual([]);
    expect(getMissingAutoDerivedTasks("Printing", [])).toEqual([]);
  });

  it("returns both canonical names when the list is empty", () => {
    expect(getMissingAutoDerivedTasks("Order Goods", [])).toEqual([
      "Place blank order",
      "Receive goods",
    ]);
  });

  it("returns both when the input is null/undefined/not an array", () => {
    expect(getMissingAutoDerivedTasks("Order Goods", null)).toEqual(ORDER_GOODS_AUTO_DERIVED_TASKS);
    expect(getMissingAutoDerivedTasks("Order Goods", undefined)).toEqual(ORDER_GOODS_AUTO_DERIVED_TASKS);
    expect(getMissingAutoDerivedTasks("Order Goods", "not an array")).toEqual(ORDER_GOODS_AUTO_DERIVED_TASKS);
  });

  it("returns just one when only one canonical name is renamed/removed", () => {
    expect(getMissingAutoDerivedTasks("Order Goods", ["Place blank order", "Inspect goods"]))
      .toEqual(["Receive goods"]);
    expect(getMissingAutoDerivedTasks("Order Goods", ["Order screens", "Receive goods"]))
      .toEqual(["Place blank order"]);
  });

  it("returns [] when both canonical names are present (even with other tasks alongside)", () => {
    expect(getMissingAutoDerivedTasks("Order Goods", [
      "Place blank order",
      "Email vendor",
      "Receive goods",
      "Count units",
    ])).toEqual([]);
  });

  it("is whitespace/case-sensitive — 'place blank order' counts as missing", () => {
    expect(getMissingAutoDerivedTasks("Order Goods", ["place blank order", "Receive goods"]))
      .toEqual(["Place blank order"]);
    expect(getMissingAutoDerivedTasks("Order Goods", [" Place blank order ", "Receive goods"]))
      .toEqual(["Place blank order"]);
  });
});
