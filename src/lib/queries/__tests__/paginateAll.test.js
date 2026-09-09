import { describe, it, expect, vi } from "vitest";
import { paginateAll } from "../paginateAll";

// Build a fake page fetcher over `total` synthetic rows, page size `page`.
function fakeFetcher(total, page) {
  return vi.fn(async (n) => {
    const start = n * page;
    return Array.from({ length: Math.max(0, Math.min(page, total - start)) }, (_, i) => start + i);
  });
}

describe("paginateAll", () => {
  it("returns everything across multiple pages", async () => {
    const rows = await paginateAll(fakeFetcher(2153, 1000), 1000);
    expect(rows).toHaveLength(2153);
    expect(rows[0]).toBe(0);
    expect(rows[2152]).toBe(2152);
  });

  it("stops after one page when under the cap", async () => {
    const fetch = fakeFetcher(42, 1000);
    const rows = await paginateAll(fetch, 1000);
    expect(rows).toHaveLength(42);
    expect(fetch).toHaveBeenCalledTimes(1); // no wasted second request
  });

  it("makes exactly one extra request when total is an exact multiple", async () => {
    // 2000 rows / 1000: page 0 full, page 1 full, page 2 empty → stop.
    const fetch = fakeFetcher(2000, 1000);
    const rows = await paginateAll(fetch, 1000);
    expect(rows).toHaveLength(2000);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("handles an empty table", async () => {
    const rows = await paginateAll(fakeFetcher(0, 1000), 1000);
    expect(rows).toEqual([]);
  });

  it("tolerates a fetcher returning null/undefined as empty", async () => {
    const rows = await paginateAll(async () => null, 1000);
    expect(rows).toEqual([]);
  });
});
