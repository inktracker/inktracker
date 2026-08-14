// Regression guard: the partner_trade_sheets RLS must stay owner-write /
// active-partner-read only. A sheet is a shop's rate card; a bad policy edit
// that opened writes to partners, or reads to non-partners, would let a shop
// rewrite a competitor's prices or scrape rate cards. Static like
// managerWriteGate.test.js — asserts the migration text, no live DB.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const sql = readFileSync(
  fileURLToPath(new URL("../../../migrations/20261005000000_partner_trade_sheets.sql", import.meta.url)), "utf8");

describe("partner_trade_sheets RLS", () => {
  it("RLS is enabled on the table", () => {
    expect(sql).toMatch(/alter table partner_trade_sheets enable row level security/i);
  });

  it("only the owner can WRITE (the for-all policy is acts_for_shop-gated both ways)", () => {
    expect(sql).toMatch(/create policy partner_trade_sheets_owner[\s\S]*?for all to authenticated[\s\S]*?using \(acts_for_shop\(shop_owner\)\)[\s\S]*?with check \(acts_for_shop\(shop_owner\)\)/i);
  });

  it("partner reads are SELECT-only and require an ACTIVE partnership", () => {
    const m = sql.match(/create policy partner_trade_sheets_partner_read[\s\S]*?using \(([\s\S]*?)\)\);/i);
    expect(m).toBeTruthy();
    const clause = m[1];
    // Must be a SELECT policy (never for all / for update).
    expect(sql).toMatch(/create policy partner_trade_sheets_partner_read on partner_trade_sheets\s+for select to authenticated/i);
    // Gated on an active shop_partners link to the sheet's owner.
    expect(clause).toMatch(/shop_partners sp/);
    expect(clause).toMatch(/sp\.status = 'active'/);
    expect(clause).toMatch(/acts_for_shop\(sp\.shop_a\)/);
    expect(clause).toMatch(/acts_for_shop\(sp\.shop_b\)/);
  });
});
