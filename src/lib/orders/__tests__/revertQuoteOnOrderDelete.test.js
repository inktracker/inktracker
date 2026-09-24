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

  it("RPC failure is swallowed and the broker is still notified", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "not allowed" } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(revertQuoteOnOrderDelete({ order_id: "O-3", broker_id: "b@x.com" })).resolves.toBeUndefined();
    expect(notify).toHaveBeenCalled();
    warn.mockRestore();
  });
});
