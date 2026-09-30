import { describe, it, expect } from "vitest";
import { isAllowedRainforestScript, loadRainforestScript } from "../rainforestScript.js";

describe("rainforest script allowlist", () => {
  it("allows only Rainforest's own component scripts", () => {
    expect(isAllowedRainforestScript("https://static.rainforestpay.com/sandbox.payment.js")).toBe(true);
    expect(isAllowedRainforestScript("https://static.rainforestpay.com/merchant.js")).toBe(true);
    expect(isAllowedRainforestScript("https://static.rainforestpay.com.evil.com/payment.js")).toBe(false);
    expect(isAllowedRainforestScript("http://static.rainforestpay.com/payment.js")).toBe(false);
    expect(isAllowedRainforestScript("https://static.rainforestpay.com/other.js")).toBe(false);
    expect(isAllowedRainforestScript(null)).toBe(false);
  });
  it("refuses to load anything else", async () => {
    await expect(loadRainforestScript("https://evil.example/payment.js")).rejects.toThrow("Unexpected payment script");
  });
});
