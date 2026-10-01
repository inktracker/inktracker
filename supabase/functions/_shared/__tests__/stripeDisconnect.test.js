import { describe, it, expect, vi } from "vitest";
import { disconnectStripeAccount, DISCONNECT } from "../stripeDisconnect.js";

const base = { accountId: "acct_1", accountLive: true, keyLive: true, clientId: "ca_1" };

describe("disconnectStripeAccount — shop deletion leaves InkTracker no access", () => {
  it("disconnects with the platform client id (works for accounts InkTracker created too)", async () => {
    const deauthorize = vi.fn().mockResolvedValue({ stripe_user_id: "acct_1" });
    expect(await disconnectStripeAccount({ ...base, deauthorize })).toEqual({ status: DISCONNECT.DISCONNECTED });
    expect(deauthorize).toHaveBeenCalledWith("acct_1", "ca_1");
  });
  it("already disconnected by the shop → done, not a failure", async () => {
    const deauthorize = vi.fn().mockRejectedValue(new Error("Stripe deauthorize → 401: {\"error\":\"invalid_client\",\"error_description\":\"acct_1 is not connected to ca_1\"}"));
    expect((await disconnectStripeAccount({ ...base, deauthorize })).status).toBe(DISCONNECT.ALREADY);
  });
  it("a test-mode account under the live key → nothing to do (it doesn't exist there)", async () => {
    const deauthorize = vi.fn();
    expect((await disconnectStripeAccount({ ...base, accountLive: false, deauthorize })).status).toBe(DISCONNECT.TEST_ACCOUNT);
    expect(deauthorize).not.toHaveBeenCalled();
  });
  it("no client id, or Stripe down → MANUAL with the account to remove", async () => {
    const r = await disconnectStripeAccount({ ...base, clientId: "", deauthorize: vi.fn() });
    expect(r.status).toBe(DISCONNECT.MANUAL);
    expect(r.detail).toMatch(/acct_1/);
    const down = await disconnectStripeAccount({ ...base, deauthorize: vi.fn().mockRejectedValue(new Error("Stripe deauthorize → 503: upstream")) });
    expect(down.status).toBe(DISCONNECT.MANUAL);
  });
  it("no account → nothing", async () => {
    expect((await disconnectStripeAccount({ ...base, accountId: null, deauthorize: vi.fn() })).status).toBe(DISCONNECT.NONE);
  });
});
