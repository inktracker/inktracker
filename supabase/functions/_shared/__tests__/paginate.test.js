import { describe, it, expect } from "vitest";
import { fetchAllRows, EDGE_PAGE } from "../paginate.js";

// A fake query builder: .range(from,to) resolves the slice of `rows` in that
// inclusive range, mirroring PostgREST. buildQuery returns a fresh one each
// call (the contract fetchAllRows depends on).
function makeSource(rows) {
  let rangeCalls = 0;
  const build = () => ({
    range(from, to) {
      rangeCalls++;
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
    },
  });
  build.calls = () => rangeCalls;
  return build;
}

describe("fetchAllRows", () => {
  it("returns everything across multiple pages", async () => {
    const rows = Array.from({ length: 2350 }, (_, i) => ({ i }));
    const out = await fetchAllRows(makeSource(rows), 1000);
    expect(out).toHaveLength(2350);
    expect(out[0].i).toBe(0);
    expect(out[2349].i).toBe(2349);
  });

  it("stops after a short (final) page — no extra request", async () => {
    const rows = Array.from({ length: 2350 }, (_, i) => ({ i }));
    const build = makeSource(rows);
    await fetchAllRows(build, 1000);
    // 1000 + 1000 + 350 → the third page is short, so exactly 3 requests.
    expect(build.calls()).toBe(3);
  });

  it("makes exactly one request when the first page is short", async () => {
    const build = makeSource([{ i: 0 }, { i: 1 }]);
    const out = await fetchAllRows(build, 1000);
    expect(out).toHaveLength(2);
    expect(build.calls()).toBe(1);
  });

  it("makes a second (empty) request when the count is an exact multiple", async () => {
    const rows = Array.from({ length: 2000 }, (_, i) => ({ i }));
    const build = makeSource(rows);
    const out = await fetchAllRows(build, 1000);
    expect(out).toHaveLength(2000);
    // Two full pages look like there might be more → one extra empty page.
    expect(build.calls()).toBe(3);
  });

  it("throws on a query error (surfaced to the caller's try/catch)", async () => {
    const build = () => ({ range: () => Promise.resolve({ data: null, error: { message: "boom" } }) });
    await expect(fetchAllRows(build, 1000)).rejects.toEqual({ message: "boom" });
  });

  it("defaults to the 1000-row PostgREST cap", () => {
    expect(EDGE_PAGE).toBe(1000);
  });
});
