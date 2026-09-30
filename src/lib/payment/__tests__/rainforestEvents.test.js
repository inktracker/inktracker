import { describe, it, expect } from "vitest";
import { readApproved } from "../rainforestEvents.js";

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
