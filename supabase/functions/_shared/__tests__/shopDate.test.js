import { describe, it, expect } from "vitest";
import { shopTimezone, localDate, DEFAULT_SHOP_TZ } from "../shopDate.js";

describe("shop-local dates for QuickBooks", () => {
  it("a 6pm Reno payment is booked the same day, not tomorrow (UTC)", () => {
    const iso = "2026-10-03T01:00:00Z"; // Oct 2, 6pm PDT
    expect(iso.slice(0, 10)).toBe("2026-10-03");
    expect(localDate(iso, "America/Los_Angeles")).toBe("2026-10-02");
    expect(localDate(iso, "America/New_York")).toBe("2026-10-02");
    expect(localDate("2026-10-03T05:00:00Z", "America/New_York")).toBe("2026-10-03");
  });
  it("timezone: shop setting, else state, else Pacific; junk never throws", () => {
    expect(shopTimezone({ timezone: "America/Denver", state: "NV" })).toBe("America/Denver");
    expect(shopTimezone({ timezone: null, state: "ms" })).toBe("America/Chicago");
    expect(shopTimezone({ timezone: "Not/AZone", state: "ID" })).toBe("America/Boise");
    expect(shopTimezone({})).toBe(DEFAULT_SHOP_TZ);
    expect(localDate("garbage", "America/Los_Angeles")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
