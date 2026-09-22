// changeOrderStatus — the single status path for Orders / Production / Shop
// Floor. Pins the side effects the 2026-09-22 floor audit found drifting.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../runOrderCompletion", () => ({ runOrderCompletion: vi.fn(async ({ order }) => ({ ...order, status: "Completed", completed_date: "2026-09-22" })) }));
vi.mock("../autoPoFromOrder", () => ({ ensurePoDraftsForOrder: vi.fn(async () => ({ created: [{ id: "po-1" }], warnings: [] })) }));

import { runOrderCompletion } from "../runOrderCompletion";
import { ensurePoDraftsForOrder } from "../autoPoFromOrder";
import { changeOrderStatus, buildStatusPayload, effectiveStatus, nextStatusOf, prevStatusOf, autoPoToast } from "../changeOrderStatus";
import { autoCheckTask, autoCheckArtApprovalTask } from "@/lib/orderGoodsProgress";

const user = { email: "owner@example.com", shop_owner: "owner@example.com" };
function client() {
  const update = vi.fn(async (id, payload) => ({ id, ...payload }));
  return { base44: { entities: { Order: { update } } }, update };
}

beforeEach(() => { vi.clearAllMocks(); });

describe("status helpers", () => {
  it("unknown/blank status is treated as the FIRST stage, not Pre-Press", () => {
    expect(effectiveStatus({})).toBe("Art Approval");
    expect(effectiveStatus({ status: "Shipped" })).toBe("Art Approval");
    expect(effectiveStatus({ status: "Printing" })).toBe("Printing");
    expect(nextStatusOf({ status: "Printing" })).toBe("Completed");
    expect(nextStatusOf({ status: "Completed" })).toBeNull();
    expect(prevStatusOf({ status: "Art Approval" })).toBeNull();
    expect(prevStatusOf({ status: "Pre-Press" })).toBe("Order Goods");
  });

  it("moving BACK clears the re-entered stage's checklist so it can't auto-bounce forward", () => {
    const order = { status: "Printing", checklist: { "Pre-Press": { "Burn screens": { by: "x" } }, Printing: { a: 1 } } };
    const p = buildStatusPayload(order, "Pre-Press");
    expect(p.checklist["Pre-Press"]).toEqual({});
    expect(p.checklist.Printing).toEqual({ a: 1 }); // untouched
    // forward move leaves checklists alone
    expect(buildStatusPayload({ status: "Order Goods", checklist: { "Pre-Press": { a: 1 } } }, "Pre-Press").checklist).toBeUndefined();
  });
});

describe("changeOrderStatus side effects", () => {
  it("Completed ALWAYS runs runOrderCompletion (no light status write)", async () => {
    const { base44, update } = client();
    const order = { id: "o1", status: "Printing" };
    const res = await changeOrderStatus({ order, newStatus: "Completed", user, base44 });
    expect(runOrderCompletion).toHaveBeenCalledWith({ order, user, base44 });
    expect(update).not.toHaveBeenCalled();
    expect(res.status).toBe("Completed");
  });

  it("entering Order Goods creates draft POs from EVERY page (was missing on the floor)", async () => {
    const { base44 } = client();
    const onAutoPo = vi.fn();
    const order = { id: "o1", order_id: "ORD-1", status: "Art Approval" };
    await changeOrderStatus({ order, newStatus: "Order Goods", user, base44, onAutoPo });
    await new Promise((r) => setTimeout(r, 0));
    expect(ensurePoDraftsForOrder).toHaveBeenCalledTimes(1);
    expect(onAutoPo).toHaveBeenCalledWith({ created: [{ id: "po-1" }], warnings: [] });
    expect(autoPoToast({ created: [{ id: "po-1" }] }, "ORD-1")).toMatch(/Draft PO created for ORD-1/);
    expect(autoPoToast({ created: [] }, "ORD-1")).toBeNull();
  });

  it("other transitions are a plain status write with no PO side effect", async () => {
    const { base44, update } = client();
    await changeOrderStatus({ order: { id: "o1", status: "Order Goods" }, newStatus: "Pre-Press", user, base44 });
    expect(update).toHaveBeenCalledWith("o1", { status: "Pre-Press" });
    expect(ensurePoDraftsForOrder).not.toHaveBeenCalled();
  });

  it("refuses a status outside O_STATUSES", async () => {
    const { base44 } = client();
    await expect(changeOrderStatus({ order: { id: "o1" }, newStatus: "Shipped", user, base44 })).rejects.toThrow(/unknown status/);
  });
});

describe("art approval derives from the customer's approval, never a floor tap", () => {
  it("Get approval mirrors order.art_approved; other tasks stay manual", () => {
    expect(autoCheckArtApprovalTask("Art Approval", "Get approval", { art_approved: true })).toBe(true);
    expect(autoCheckArtApprovalTask("Art Approval", "Get approval", { art_approved: false })).toBe(false);
    expect(autoCheckArtApprovalTask("Art Approval", "Send proof to customer", { art_approved: true })).toBeNull();
    expect(autoCheckArtApprovalTask("Printing", "Get approval", { art_approved: true })).toBeNull();
    expect(autoCheckTask("Art Approval", "Get approval", { art_approved: true })).toBe(true);
    expect(autoCheckTask("Pre-Press", "Burn screens", {})).toBeNull();
  });
});
