import { describe, it, expect } from "vitest";
import {
  buildDbManifest,
  buildStorageManifest,
  compareManifests,
} from "../lib/backupManifest.mjs";

const prevDb = buildDbManifest({ quotes: 100, orders: 50, empty_always: 0 }, 8);

describe("compareManifests — db", () => {
  it("first run (no previous) passes with a note", () => {
    const r = compareManifests(null, prevDb);
    expect(r.ok).toBe(true);
    expect(r.note).toMatch(/first run/);
  });

  it("healthy growth passes", () => {
    const cur = buildDbManifest({ quotes: 110, orders: 55, empty_always: 0 }, 9);
    expect(compareManifests(prevDb, cur).ok).toBe(true);
  });

  it("previously non-empty table now empty FAILS", () => {
    const cur = buildDbManifest({ quotes: 0, orders: 50, empty_always: 0 }, 8);
    const r = compareManifests(prevDb, cur);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/quotes: was 100, now EMPTY/);
  });

  it("always-empty table staying empty is fine", () => {
    const cur = buildDbManifest({ quotes: 100, orders: 50, empty_always: 0 }, 8);
    expect(compareManifests(prevDb, cur).ok).toBe(true);
  });

  it("drastic shrink (>50%) FAILS; mild shrink passes", () => {
    const drastic = buildDbManifest({ quotes: 40, orders: 50, empty_always: 0 }, 8);
    expect(compareManifests(prevDb, drastic).ok).toBe(false);
    const mild = buildDbManifest({ quotes: 80, orders: 45, empty_always: 0 }, 8);
    expect(compareManifests(prevDb, mild).ok).toBe(true);
  });

  it("small tables are exempt from the ratio check (floor)", () => {
    const prev = buildDbManifest({ tiny: 5 }, 1);
    const cur = buildDbManifest({ tiny: 2 }, 1);
    expect(compareManifests(prev, cur).ok).toBe(true);
  });

  it("table missing entirely from the new backup FAILS", () => {
    const cur = buildDbManifest({ orders: 50, empty_always: 0 }, 8);
    const r = compareManifests(prevDb, cur);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/quotes: present in previous backup, MISSING/);
  });

  it("auth identities vanishing FAILS", () => {
    const cur = buildDbManifest({ quotes: 100, orders: 50, empty_always: 0 }, 0);
    const r = compareManifests(prevDb, cur);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/auth_users: was 8, now EMPTY/);
  });
});

describe("compareManifests — storage", () => {
  const prev = buildStorageManifest({
    artwork: { count: 200, bytes: 5_000_000 },
    "tax-certificates": { count: 12, bytes: 300_000 },
  });

  it("healthy run passes and totals compute", () => {
    expect(prev.total_objects).toBe(212);
    expect(prev.total_bytes).toBe(5_300_000);
    const cur = buildStorageManifest({
      artwork: { count: 210, bytes: 5_100_000 },
      "tax-certificates": { count: 12, bytes: 300_000 },
    });
    expect(compareManifests(prev, cur).ok).toBe(true);
  });

  it("bucket coming back empty FAILS", () => {
    const cur = buildStorageManifest({
      artwork: { count: 0, bytes: 0 },
      "tax-certificates": { count: 12, bytes: 300_000 },
    });
    const r = compareManifests(prev, cur);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/artwork: was 200, now EMPTY/);
  });

  it("kind mismatch never cross-compares", () => {
    expect(compareManifests(prev, prevDb).ok).toBe(true);
  });
});
