import { describe, it, expect } from "vitest";
import { assertEmailDelivered } from "../email";

describe("assertEmailDelivered — the sent:false delivery guard", () => {
  it("throws on sent:false with the failed recipient + reason", () => {
    expect(() =>
      assertEmailDelivered(
        { sent: false, results: [{ to: "x@y.com", ok: false, reason: "422 invalid to" }] },
        "invoice email",
      ),
    ).toThrow(/invoice email.*x@y\.com.*422 invalid to/s);
  });

  it("throws on sent:false even with no results detail (no_api_key shape)", () => {
    expect(() => assertEmailDelivered({ sent: false }, "quote email")).toThrow(/quote email/);
  });

  it("no-ops on a real delivery", () => {
    expect(() => assertEmailDelivered({ sent: true, results: [{ ok: true }] })).not.toThrow();
  });

  it("no-ops on responses without a sent field (older functions)", () => {
    expect(() => assertEmailDelivered({ ok: true })).not.toThrow();
    expect(() => assertEmailDelivered(null)).not.toThrow();
  });
});
