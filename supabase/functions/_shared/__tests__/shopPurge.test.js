import { describe, it, expect } from "vitest";
import { SHOP_PURGE_TABLES, SHOP_PURGE_BUCKETS, authorizeShopPurge, extractArtworkPaths, ARTWORK_SOURCE_TABLES } from "../shopPurge.js";

describe("extractArtworkPaths", () => {
  it("pulls bucket paths from public + signed URLs in row JSON, deduped", () => {
    const rows = [
      { selected_artwork: ["https://x.supabase.co/storage/v1/object/public/artwork/1776-abc.png"] },
      { attachment_url: "https://x.supabase.co/storage/v1/object/sign/artwork/1776-abc.png?token=zz" },
      { line_items: [{ mockup: "https://x/storage/v1/object/public/artwork/sub/dir/file2.jpg" }] },
    ];
    const paths = extractArtworkPaths(rows);
    expect(paths).toContain("1776-abc.png");
    expect(paths).toContain("sub/dir/file2.jpg");
    expect(paths.filter((p) => p === "1776-abc.png").length).toBe(1); // deduped across rows
  });
  it("ignores non-artwork strings and bad input", () => {
    expect(extractArtworkPaths([{ note: "see /tax-certificates/abc.pdf and /artworkish/no.png" }])).toEqual([]);
    expect(extractArtworkPaths(null)).toEqual([]);
    expect(extractArtworkPaths([null, 5, "x"])).toEqual([]);
  });
  it("pulls bare { path } refs — the legacy order-modal shape with no /artwork/ url", () => {
    const rows = [
      { selected_artwork: [{ id: "2acc_1783_ycy.jpg", name: "47185_f_fl.jpg", path: "2acc_1783_ycy.jpg", source: "Uploaded to order" }] },
    ];
    const paths = extractArtworkPaths(rows);
    expect(paths).toContain("2acc_1783_ycy.jpg");
    // The display name is NOT a path field — must not be extracted.
    expect(paths).not.toContain("47185_f_fl.jpg");
  });
  it("ARTWORK_SOURCE_TABLES are shop_owner-keyed", () => {
    expect(ARTWORK_SOURCE_TABLES.every((t) => t.column === "shop_owner")).toBe(true);
  });
});

describe("SHOP_PURGE_TABLES", () => {
  it("covers the known tenant tables and is frozen", () => {
    const names = SHOP_PURGE_TABLES.map((t) => t.table);
    for (const t of ["customers", "quotes", "orders", "invoices", "tax_records", "messages", "shops"]) {
      expect(names).toContain(t);
    }
    expect(Object.isFrozen(SHOP_PURGE_TABLES)).toBe(true);
  });
  it("uses owner_email for shops, shop_owner for everything else", () => {
    expect(SHOP_PURGE_TABLES.find((t) => t.table === "shops").column).toBe("owner_email");
    expect(SHOP_PURGE_TABLES.filter((t) => t.table !== "shops").every((t) => t.column === "shop_owner")).toBe(true);
  });
  it("has no duplicate tables", () => {
    const names = SHOP_PURGE_TABLES.map((t) => t.table);
    expect(new Set(names).size).toBe(names.length);
  });
  it("purges broker-side PII tables keyed by shop_owner (NEW-04 — orphaned otherwise)", () => {
    const names = SHOP_PURGE_TABLES.map((t) => t.table);
    for (const t of ["broker_notifications", "broker_performance", "broker_documents", "broker_files"]) {
      expect(names).toContain(t);
      expect(SHOP_PURGE_TABLES.find((x) => x.table === t).column).toBe("shop_owner");
    }
  });
  it("scans broker doc/file tables for artwork too (NEW-04)", () => {
    const names = ARTWORK_SOURCE_TABLES.map((t) => t.table);
    expect(names).toContain("broker_documents");
    expect(names).toContain("broker_files");
  });
  it("clears the private tax-certificate bucket", () => {
    expect(SHOP_PURGE_BUCKETS).toContain("tax-certificates");
  });
});

describe("authorizeShopPurge", () => {
  it("lets a platform admin purge any shop", () => {
    expect(authorizeShopPurge({ callerRole: "admin", callerShop: "me@x.co", targetEmail: "other@y.co", confirm: "other@y.co" }))
      .toEqual({ ok: true });
  });
  it("lets a shop owner purge ONLY their own shop", () => {
    expect(authorizeShopPurge({ callerRole: "shop", callerShop: "me@x.co", targetEmail: "me@x.co", confirm: "me@x.co" }))
      .toEqual({ ok: true });
  });
  it("refuses a shop owner purging another shop", () => {
    expect(authorizeShopPurge({ callerRole: "shop", callerShop: "me@x.co", targetEmail: "other@y.co", confirm: "other@y.co" }))
      .toEqual({ ok: false, reason: "forbidden" });
  });
  it("requires confirm to equal the target email (case/space-insensitive)", () => {
    expect(authorizeShopPurge({ callerRole: "admin", targetEmail: "me@x.co", confirm: "" }).reason).toBe("confirm_mismatch");
    expect(authorizeShopPurge({ callerRole: "admin", targetEmail: "me@x.co", confirm: "wrong@x.co" }).reason).toBe("confirm_mismatch");
    expect(authorizeShopPurge({ callerRole: "admin", targetEmail: "Me@X.co", confirm: " me@x.co " })).toEqual({ ok: true });
  });
  it("refuses with no target", () => {
    expect(authorizeShopPurge({ callerRole: "admin", targetEmail: "", confirm: "" }).reason).toBe("no_target");
  });
});
