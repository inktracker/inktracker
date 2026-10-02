import { describe, it, expect, vi, beforeEach } from "vitest";

const filter = vi.fn();
const update = vi.fn();
const notify = vi.fn();
const rpc = vi.fn();

vi.mock("@/api/supabaseClient", () => ({
  base44: {
    entities: {
      Quote: { filter: (...a) => filter(...a), update: (...a) => update(...a) },
      BrokerNotification: { create: (...a) => notify(...a) },
    },
  },
  supabase: { rpc: (...a) => rpc(...a) },
}));

import { revertQuoteOnOrderDelete } from "@/lib/orders/revertQuoteOnOrderDelete";

beforeEach(() => {
  filter.mockReset().mockResolvedValue([{ id: "q-uuid-1", quote_id: "Q-1" }]);
  update.mockReset().mockResolvedValue({});
  notify.mockReset().mockResolvedValue({});
  rpc.mockReset().mockResolvedValue({ data: null, error: null });
});

describe("revertQuoteOnOrderDelete", () => {
  it("broker order → hands the quote back via the RPC, never a null shop_owner update", async () => {
    await revertQuoteOnOrderDelete({ order_id: "O-1", broker_id: "b@x.com", shop_owner: "shop@x.com" });
    expect(rpc).toHaveBeenCalledWith("return_quote_to_broker", { p_quote_id: "q-uuid-1" });
    expect(update).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ broker_id: "b@x.com", action: "shop_deleted_order" }));
  });

  it("shop order → quote goes back to Approved with a direct update", async () => {
    await revertQuoteOnOrderDelete({ order_id: "O-2", shop_owner: "shop@x.com" });
    expect(update).toHaveBeenCalledWith("q-uuid-1", { status: "Approved", converted_order_id: null });
    expect(rpc).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("RPC failure returns ok:false with the quote id — and does NOT notify the broker", async () => {
    // Old contract swallowed the failure (returned undefined) and still told
    // the broker the quote was handed back — a lie when the restore failed,
    // and the quote stayed stranded invisible while the delete confirm had
    // promised "nothing is lost" (audit 2026-10-02). New contract: report the
    // failure so the caller can surface it, and skip the misleading bell.
    rpc.mockResolvedValue({ data: null, error: { message: "not allowed" } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await revertQuoteOnOrderDelete({ order_id: "O-3", broker_id: "b@x.com" });
    expect(r.ok).toBe(false);
    expect(r.quoteId).toBe("Q-1");
    expect(r.error).toMatch(/not allowed/);
    expect(notify).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("success returns ok:true with restored + quoteId (shop path)", async () => {
    const r = await revertQuoteOnOrderDelete({ order_id: "O-4", shop_owner: "shop@x.com" });
    expect(r).toEqual({ ok: true, restored: true, quoteId: "Q-1" });
  });

  it("no originating quote → ok:true, restored:false (direct order, nothing to restore)", async () => {
    filter.mockResolvedValue([]);
    const r = await revertQuoteOnOrderDelete({ order_id: "O-5", shop_owner: "shop@x.com" });
    expect(r.ok).toBe(true);
    expect(r.restored).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("lookup failure → ok:false (can't tell if a quote exists; caller must surface)", async () => {
    filter.mockRejectedValue(new Error("rls denied"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await revertQuoteOnOrderDelete({ order_id: "O-6", shop_owner: "shop@x.com" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/rls denied/);
    warn.mockRestore();
  });
});
