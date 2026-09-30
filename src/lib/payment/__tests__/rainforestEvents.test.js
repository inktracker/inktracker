import { describe, it, expect } from "vitest";
import { readApproved, readMethodUpdated } from "../rainforestEvents.js";

describe("readApproved", () => {
  it("reads the documented array form and common nestings", () => {
    expect(readApproved([{ payin_id: "pyi_1", method_type: "CARD" }])).toEqual({ payinId: "pyi_1", method: "card" });
    expect(readApproved([{ data: { payin_id: "pyi_2", method_type: "ACH" } }])).toEqual({ payinId: "pyi_2", method: "ach" });
    expect(readApproved({ payin: { payin_id: "pyi_3", method_type: "PLAID_ACH" } })).toEqual({ payinId: "pyi_3", method: "ach" });
  });
  it("never throws on junk", () => {
    expect(readApproved(null)).toEqual({ payinId: null, method: null });
    expect(readApproved("x")).toEqual({ payinId: null, method: null });
  });
});

describe("readMethodUpdated", () => {
  it("reads the selected method in the shapes we might get", () => {
    expect(readMethodUpdated(["ACH"])).toBe("ach");
    expect(readMethodUpdated([{ method: "CARD" }])).toBe("card");
    expect(readMethodUpdated({ data: { method_type: "ACH" } })).toBe("ach");
    expect(readMethodUpdated(null)).toBeNull();
    expect(readMethodUpdated([{ method: "VENMO" }])).toBeNull();
  });
});
