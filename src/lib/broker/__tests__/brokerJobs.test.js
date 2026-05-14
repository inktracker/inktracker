import { describe, it, expect } from "vitest";
import {
  assembleCompletedJobs,
  filterJobsByDate,
  filterJobsBySearch,
  sortJobs,
  computeJobKpis,
} from "../brokerJobs.js";

const NOW = new Date("2026-05-14T00:00:00Z").getTime();
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();

// Stub calc functions: broker = total × 0.8, client = total × 1.0
const calcBroker = (q) => ({ total: (q._inputTotal || 0) * 0.8 });
const calcClient = (q) => ({ total: (q._inputTotal || 0) * 1.0 });

describe("assembleCompletedJobs", () => {
  it("combines Completed orders with broker/client totals from matching quotes", () => {
    const orders = [
      { id: "o1", order_id: "ORD-1", status: "Completed", total: 100, customer_name: "Acme" },
    ];
    const quotes = [
      { id: "q1", quote_id: "Q-1", converted_order_id: "ORD-1", _inputTotal: 100, status: "Converted to Order" },
    ];
    const out = assembleCompletedJobs(orders, quotes, { calcBroker, calcClient });
    expect(out).toHaveLength(1);
    expect(out[0]._type).toBe("order");
    expect(out[0]._brokerTotal).toBe(80);
    expect(out[0]._clientTotal).toBe(100);
    expect(out[0]._rawQuote.id).toBe("q1");
  });

  it("falls back to order.total when no matching quote", () => {
    const out = assembleCompletedJobs(
      [{ order_id: "ORD-1", status: "Completed", total: 125 }],
      [],
      { calcBroker, calcClient },
    );
    expect(out[0]._brokerTotal).toBe(125);
    expect(out[0]._clientTotal).toBe(125);
    expect(out[0]._rawQuote).toBe(null);
  });

  it("skips non-Completed orders", () => {
    const out = assembleCompletedJobs(
      [
        { order_id: "ORD-1", status: "Printing", total: 100 },
        { order_id: "ORD-2", status: "Completed", total: 100 },
      ],
      [],
      { calcBroker, calcClient },
    );
    expect(out.map((j) => j.order_id)).toEqual(["ORD-2"]);
  });

  it("includes Converted-to-Order quotes that don't have a matching order row", () => {
    const out = assembleCompletedJobs(
      [],
      [
        {
          id: "q1",
          quote_id: "Q-1",
          status: "Converted to Order",
          converted_order_id: "ORD-7",
          _inputTotal: 50,
        },
      ],
      { calcBroker, calcClient },
    );
    expect(out).toHaveLength(1);
    expect(out[0]._type).toBe("quote");
    expect(out[0].order_id).toBe("ORD-7");
    expect(out[0]._brokerTotal).toBe(40);
  });

  it("dedupes — a Converted quote whose order is already in the list does NOT double-count", () => {
    const out = assembleCompletedJobs(
      [{ id: "oid", order_id: "ORD-X", status: "Completed", total: 100 }],
      [{ id: "q", quote_id: "Q-X", status: "Converted to Order", converted_order_id: "ORD-X", _inputTotal: 100 }],
      { calcBroker, calcClient },
    );
    expect(out).toHaveLength(1);
    expect(out[0]._type).toBe("order"); // order wins over its quote
  });

  it("matches a quote via converted_order_id = order.id (legacy fallback)", () => {
    const out = assembleCompletedJobs(
      [{ id: "internal-uuid", order_id: "ORD-1", status: "Completed", total: 100 }],
      [{ id: "q", status: "Converted to Order", converted_order_id: "internal-uuid", _inputTotal: 100 }],
      { calcBroker, calcClient },
    );
    expect(out).toHaveLength(1);
    expect(out[0]._rawQuote).not.toBe(null);
  });

  it("survives calc fn throwing — uses order.total fallback", () => {
    const out = assembleCompletedJobs(
      [{ order_id: "ORD-1", status: "Completed", total: 60 }],
      [{ status: "Converted to Order", converted_order_id: "ORD-1" }],
      { calcBroker: () => { throw new Error("boom"); }, calcClient },
    );
    expect(out[0]._brokerTotal).toBe(60);
  });

  it("handles null/undefined inputs", () => {
    expect(assembleCompletedJobs(null, null, { calcBroker, calcClient })).toEqual([]);
    expect(assembleCompletedJobs(undefined, undefined, { calcBroker, calcClient })).toEqual([]);
  });
});

describe("filterJobsByDate", () => {
  const jobs = [
    { id: "1", date: daysAgo(5) },
    { id: "2", date: daysAgo(45) },
    { id: "3", date: daysAgo(120) },
    { id: "4", date: new Date(NOW - 400 * 86400000).toISOString() }, // last year
  ];

  it("returns all when filter is 'all' or falsy", () => {
    expect(filterJobsByDate(jobs, "all", NOW)).toHaveLength(4);
    expect(filterJobsByDate(jobs, "", NOW)).toHaveLength(4);
    expect(filterJobsByDate(jobs, null, NOW)).toHaveLength(4);
  });

  it("'30d' keeps only the last 30 days", () => {
    expect(filterJobsByDate(jobs, "30d", NOW).map((j) => j.id)).toEqual(["1"]);
  });

  it("'90d' keeps the last 90 days", () => {
    expect(filterJobsByDate(jobs, "90d", NOW).map((j) => j.id)).toEqual(["1", "2"]);
  });

  it("'year' keeps only jobs in the current calendar year", () => {
    // jobs 1,2,3 all in 2026; job 4 is ~400 days back = 2025.
    expect(filterJobsByDate(jobs, "year", NOW).map((j) => j.id)).toEqual(["1", "2", "3"]);
  });

  it("keeps undated jobs rather than dropping them (matches inline behavior)", () => {
    expect(filterJobsByDate([{ id: "x" }], "30d", NOW).map((j) => j.id)).toEqual(["x"]);
  });

  it("falls back to created_date when date is missing", () => {
    const out = filterJobsByDate(
      [{ id: "a", created_date: daysAgo(5) }, { id: "b", created_date: daysAgo(60) }],
      "30d",
      NOW,
    );
    expect(out.map((j) => j.id)).toEqual(["a"]);
  });
});

describe("filterJobsBySearch", () => {
  const jobs = [
    { id: "1", customer_name: "Acme Corp", order_id: "ORD-001" },
    { id: "2", customer_name: "Beta LLC", order_id: "ORD-002", quote_id: "Q-002" },
    { id: "3", customer_name: "", order_id: "ORD-3RD" },
  ];

  it("returns all jobs on empty query", () => {
    expect(filterJobsBySearch(jobs, "")).toHaveLength(3);
    expect(filterJobsBySearch(jobs, null)).toHaveLength(3);
  });

  it("matches customer_name case-insensitively", () => {
    expect(filterJobsBySearch(jobs, "ACME").map((j) => j.id)).toEqual(["1"]);
  });

  it("matches order_id", () => {
    expect(filterJobsBySearch(jobs, "ORD-002").map((j) => j.id)).toEqual(["2"]);
  });

  it("matches quote_id when present", () => {
    expect(filterJobsBySearch(jobs, "Q-002").map((j) => j.id)).toEqual(["2"]);
  });
});

describe("sortJobs", () => {
  const jobs = [
    { id: "a", date: "2026-03-01", _brokerTotal: 100 },
    { id: "b", date: "2026-01-01", _brokerTotal: 300 },
    { id: "c", date: "2026-05-01", _brokerTotal: 200 },
  ];

  it("date_desc: newest first", () => {
    expect(sortJobs(jobs, "date_desc").map((j) => j.id)).toEqual(["c", "a", "b"]);
  });

  it("date_asc: oldest first", () => {
    expect(sortJobs(jobs, "date_asc").map((j) => j.id)).toEqual(["b", "a", "c"]);
  });

  it("value_desc: highest broker total first", () => {
    expect(sortJobs(jobs, "value_desc").map((j) => j.id)).toEqual(["b", "c", "a"]);
  });

  it("value_asc: lowest broker total first", () => {
    expect(sortJobs(jobs, "value_asc").map((j) => j.id)).toEqual(["a", "c", "b"]);
  });

  it("unknown sort key: returns list unchanged", () => {
    expect(sortJobs(jobs, "garbage").map((j) => j.id)).toEqual(["a", "b", "c"]);
  });

  it("doesn't mutate the input array", () => {
    const input = [...jobs];
    sortJobs(input, "value_desc");
    expect(input.map((j) => j.id)).toEqual(["a", "b", "c"]);
  });
});

describe("computeJobKpis", () => {
  it("computes KPIs across the list", () => {
    const out = computeJobKpis([
      { _brokerTotal: 100, _clientTotal: 120 },
      { _brokerTotal: 200, _clientTotal: 250 },
    ]);
    expect(out).toEqual({
      count: 2,
      totalRevenue: 300,
      totalClientRevenue: 370,
      totalMargin: 70,
      avgJobValue: 150,
    });
  });

  it("returns zeros on empty input (no NaN from division)", () => {
    expect(computeJobKpis([])).toEqual({
      count: 0,
      totalRevenue: 0,
      totalClientRevenue: 0,
      totalMargin: 0,
      avgJobValue: 0,
    });
  });

  it("treats missing fields as 0", () => {
    const out = computeJobKpis([{ _brokerTotal: 100 }]);
    expect(out.totalRevenue).toBe(100);
    expect(out.totalClientRevenue).toBe(0);
    expect(out.totalMargin).toBe(-100); // negative margin is real signal: client price < broker cost
  });

  it("survives null input", () => {
    expect(computeJobKpis(null).count).toBe(0);
  });
});
