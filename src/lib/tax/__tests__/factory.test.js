import { describe, it, expect, vi } from "vitest";
import { taxProviderFor } from "../factory";

describe("taxProviderFor", () => {
  it("returns the InternalTaxProvider when shop.tax_mode='internal'", () => {
    const p = taxProviderFor({ tax_mode: "internal" });
    expect(p.mode).toBe("internal");
  });

  it("returns the QuickBooksTaxProvider when shop.tax_mode='quickbooks'", () => {
    const p = taxProviderFor(
      { tax_mode: "quickbooks" },
      { httpClient: vi.fn(), qbSyncUrl: "https://x", accessToken: "t" }
    );
    expect(p.mode).toBe("quickbooks");
  });

  it("defaults to internal when shop.tax_mode is missing", () => {
    expect(taxProviderFor({}).mode).toBe("internal");
    expect(taxProviderFor(null).mode).toBe("internal");
  });
});
