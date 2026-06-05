// Deno tests for the supplier cache pure helpers.
// Run with:  deno test supabase/functions/_shared/__tests__/supplierCache.test.ts
//
// Covers the deterministic logic (key building + TTL/kill-switch parsing).
// The read/write DB functions are fail-open by construction and exercised
// against a real local Supabase via the load tests, not unit-mocked here.

import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildSupplierCacheKey,
  supplierCacheTtlSeconds,
  supplierCacheEnabled,
} from "../supplierCache.ts";

Deno.test("buildSupplierCacheKey trims and upper-cases values", () => {
  assertEquals(
    buildSupplierCacheKey({ q: " 1717 " }),
    buildSupplierCacheKey({ q: "1717" }),
  );
});

Deno.test("buildSupplierCacheKey is independent of key order", () => {
  assertEquals(
    buildSupplierCacheKey({ a: "1", b: "2" }),
    buildSupplierCacheKey({ b: "2", a: "1" }),
  );
});

Deno.test("buildSupplierCacheKey distinguishes includeInventory flag", () => {
  assertNotEquals(
    buildSupplierCacheKey({ code: "5001", inv: "1" }),
    buildSupplierCacheKey({ code: "5001", inv: "0" }),
  );
});

Deno.test("TTL: unset/empty/invalid falls back to default", () => {
  Deno.env.delete("SUPPLIER_CACHE_TTL_SECONDS");
  assertEquals(supplierCacheTtlSeconds(), 3600);
  Deno.env.set("SUPPLIER_CACHE_TTL_SECONDS", "");
  assertEquals(supplierCacheTtlSeconds(), 3600);
  Deno.env.set("SUPPLIER_CACHE_TTL_SECONDS", "abc");
  assertEquals(supplierCacheTtlSeconds(), 3600);
  Deno.env.set("SUPPLIER_CACHE_TTL_SECONDS", "-5");
  assertEquals(supplierCacheTtlSeconds(), 3600);
});

Deno.test("TTL: zero is the kill switch (cache disabled)", () => {
  Deno.env.set("SUPPLIER_CACHE_TTL_SECONDS", "0");
  assertEquals(supplierCacheTtlSeconds(), 0);
  assertEquals(supplierCacheEnabled(), false);
});

Deno.test("TTL: valid value parses and floors", () => {
  Deno.env.set("SUPPLIER_CACHE_TTL_SECONDS", "60");
  assertEquals(supplierCacheTtlSeconds(), 60);
  assertEquals(supplierCacheEnabled(), true);
  Deno.env.set("SUPPLIER_CACHE_TTL_SECONDS", "3600.9");
  assertEquals(supplierCacheTtlSeconds(), 3600);
  Deno.env.delete("SUPPLIER_CACHE_TTL_SECONDS");
});
