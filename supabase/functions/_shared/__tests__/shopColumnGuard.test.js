// SHARED regression guard for the "selected a profile-only column FROM shops"
// bug (2026-06-15) — generalized across EVERY edge function that reads shops.
//
// shops is a sparse table: owner_email, shop_name, stripe_account_*, and the
// wizard/pricing jsonb blobs. The brand/contact fields (logo_url, phone, email,
// address, city, state, zip, website, terms_and_conditions, full_name) live on
// PROFILES. PostgREST errors the whole query on a non-existent column (42703);
// when that error is swallowed the entire shop row comes back null — the
// "Shop"/"S" placeholder bug. This bit getPublicShopConfig AND
// createCheckoutSession. This test scans all functions so it can't recur.
//
// Scope: SELECT only (the silent-null read bug). Handles inline string selects,
// `*` (valid — returns all columns), and a variable select resolved from a
// `const NAME = [ ... ]` array literal in the same file.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Columns that ACTUALLY exist on public.shops (verified via information_schema).
const SHOP_COLUMNS = new Set([
  "owner_email", "shop_name", "stripe_account_id", "stripe_account_status",
  "brand_color", "pricing_config", "wizard_styles", "wizard_setups",
  "decoration_types", "addons", "presses", "production_tasks",
  "quote_email_subject", "quote_email_body", "timezone", "id", "created_at",
  "qb_income_account_id", "qb_income_account_name",
  // 20260901150000: per-status customer email opt-in (statusCustomerEmail fn).
  "customer_status_notify",
  // 20260901180000: team-notification category toggles.
  "notification_prefs",
]);

const FUNCTIONS_DIR = fileURLToPath(new URL("../../", import.meta.url));
const SHOPS_SELECT = /\.from\(\s*["']shops["']\s*\)\s*\.select\(\s*([^)]*?)\s*\)/g;

// Resolve a `.select(...)` argument into a column list (or null if we can't).
function resolveColumns(arg, src) {
  const a = arg.trim();
  // String literal: "a, b, c" or "*"
  const lit = a.match(/^["'](.*)["']$/s);
  if (lit) return lit[1].split(",").map((c) => c.trim()).filter(Boolean);
  // Identifier → find `const NAME = [ "...", "..." ]` in the same file.
  if (/^[A-Za-z_$][\w$]*$/.test(a)) {
    const def = src.match(new RegExp(`(?:const|let|var)\\s+${a}\\s*=\\s*\\[([\\s\\S]*?)\\]`));
    if (def) {
      return [...def[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1].trim());
    }
  }
  return null; // unresolved form — surfaced so we never silently skip
}

const fnNames = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("_") && !d.name.startsWith("."))
  .map((d) => d.name)
  .filter((name) => existsSync(`${FUNCTIONS_DIR}/${name}/index.ts`));

// Walk every function, collect each shops-select's resolved columns.
const selects = []; // { fn, arg, cols|null }
for (const fn of fnNames) {
  const src = readFileSync(`${FUNCTIONS_DIR}/${fn}/index.ts`, "utf8");
  for (const m of src.matchAll(SHOPS_SELECT)) {
    selects.push({ fn, arg: m[1], cols: resolveColumns(m[1], src) });
  }
}

describe("shared shops SELECT column guard (all edge functions)", () => {
  it("scans real functions and finds shops selects (guard is wired up)", () => {
    expect(fnNames.length).toBeGreaterThan(5);
    expect(selects.length).toBeGreaterThan(5);
  });

  it("can resolve every shops select's columns (no unparsed forms slip through)", () => {
    const unresolved = selects.filter((s) => s.cols === null).map((s) => `${s.fn}: ${s.arg}`);
    expect(unresolved).toEqual([]);
  });

  it("never selects a column that doesn't exist on the shops table", () => {
    const offenders = [];
    for (const s of selects) {
      for (const col of s.cols || []) {
        if (col === "*") continue; // wildcard returns all columns — valid
        if (!SHOP_COLUMNS.has(col)) offenders.push(`${s.fn}: "${col}"`);
      }
    }
    // If this fails: that column lives on PROFILES. Fetch it via a profiles
    // query/merge, NOT the shops select — else the whole shop row nulls out.
    expect(offenders).toEqual([]);
  });
});
