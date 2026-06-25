import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the data layer so we can count underlying fetches without a real
// Supabase client. resolveTable mirrors the real entity→table map for the
// entities used here.
const filterSpy = vi.fn();
const listSpy = vi.fn();
vi.mock("@/api/supabaseClient", () => ({
  resolveTable: (p) => ({ Order: "orders", Quote: "quotes", User: "profiles" }[p] ?? p.toLowerCase() + "s"),
  base44: {
    entities: {
      Order: { filter: (...a) => filterSpy(...a) },
      User: { list: (...a) => listSpy(...a) },
    },
  },
}));

import { cachedFilter, cachedList, entityKey, invalidateEntity } from "@/lib/queries/cachedEntity";
import { queryClientInstance } from "@/lib/query-client";

beforeEach(() => {
  queryClientInstance.clear();
  filterSpy.mockReset().mockResolvedValue([{ id: 1 }]);
  listSpy.mockReset().mockResolvedValue([{ id: 2 }]);
});

describe("entityKey", () => {
  it("keys by resolved TABLE name so it matches the mutation-invalidation prefix", () => {
    const key = entityKey("Order", { filters: { shop_owner: "x" } });
    expect(key[0]).toBe("entity");
    expect(key[1]).toBe("orders"); // not "Order" — must match ["entity","orders"]
  });

  it("is order-independent over filter keys", () => {
    expect(entityKey("Order", { a: 1, b: 2 })).toEqual(entityKey("Order", { b: 2, a: 1 }));
  });

  it("distinguishes different params", () => {
    expect(entityKey("Order", { a: 1 })).not.toEqual(entityKey("Order", { a: 2 }));
  });
});

describe("cachedFilter / cachedList", () => {
  it("serves a second identical read from cache (no extra fetch)", async () => {
    const args = { filters: { shop_owner: "x" }, sort: "-created_date", limit: 50 };
    const a = await cachedFilter("Order", args);
    const b = await cachedFilter("Order", args);
    expect(a).toEqual([{ id: 1 }]);
    expect(b).toEqual([{ id: 1 }]);
    expect(filterSpy).toHaveBeenCalledTimes(1); // second call hit the cache
  });

  it("forwards filters/sort/limit/columns to the underlying call", async () => {
    await cachedFilter("Order", { filters: { shop_owner: "x" }, sort: "-created_date", limit: 50, columns: "id,total" });
    expect(filterSpy).toHaveBeenCalledWith({ shop_owner: "x" }, "-created_date", 50, "id,total");
  });

  it("treats different params as separate cache entries", async () => {
    await cachedFilter("Order", { filters: { shop_owner: "a" } });
    await cachedFilter("Order", { filters: { shop_owner: "b" } });
    expect(filterSpy).toHaveBeenCalledTimes(2);
  });

  it("caches list() reads too", async () => {
    await cachedList("User");
    await cachedList("User");
    expect(listSpy).toHaveBeenCalledTimes(1);
  });
});

describe("invalidateEntity", () => {
  it("busts the cache so the next read refetches", async () => {
    const args = { filters: { shop_owner: "x" } };
    await cachedFilter("Order", args);
    expect(filterSpy).toHaveBeenCalledTimes(1);

    await invalidateEntity("Order");
    await cachedFilter("Order", args);
    expect(filterSpy).toHaveBeenCalledTimes(2); // refetched after invalidation
  });
});
