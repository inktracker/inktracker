import { describe, it, expect } from "vitest";
import { notifyPrefEnabled } from "../notificationPrefs";

describe("notifyPrefEnabled", () => {
  it("defaults ON for missing keys, empty prefs, and null prefs", () => {
    expect(notifyPrefEnabled({}, "task_pings")).toBe(true);
    expect(notifyPrefEnabled(null, "order_status")).toBe(true);
    expect(notifyPrefEnabled(undefined, "comment_copies")).toBe(true);
    expect(notifyPrefEnabled({ other: false }, "task_pings")).toBe(true);
  });

  it("only an explicit false disables — truthy junk stays on", () => {
    expect(notifyPrefEnabled({ task_pings: false }, "task_pings")).toBe(false);
    expect(notifyPrefEnabled({ task_pings: true }, "task_pings")).toBe(true);
    expect(notifyPrefEnabled({ task_pings: "no" }, "task_pings")).toBe(true);
    expect(notifyPrefEnabled({ task_pings: 0 }, "task_pings")).toBe(true);
  });
});
