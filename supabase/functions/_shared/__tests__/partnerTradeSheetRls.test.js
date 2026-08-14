// Regression guard: partner_trade_sheets RLS must stay owner-write /
// active-partner-read, per-partner (default '*' or the caller's own row only),
// and never expose scale_pct to partners. Static like managerWriteGate.test.js.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const sql = readFileSync(
  fileURLToPath(new URL("../../../migrations/20261006000000_partner_trade_sheets_per_partner.sql", import.meta.url)), "utf8");

describe("partner_trade_sheets RLS (per-partner)", () => {
  it("RLS is enabled on both tables", () => {
    expect(sql).toMatch(/alter table partner_trade_sheets\s+enable row level security/i);
    expect(sql).toMatch(/alter table partner_trade_sheet_meta enable row level security/i);
  });

  it("is keyed per (shop_owner, partner_email) with a '*' default", () => {
    expect(sql).toMatch(/partner_email\s+text not null default '\*'/i);
    expect(sql).toMatch(/primary key \(shop_owner, partner_email\)/i);
  });

  it("only the owner can WRITE (for-all, acts_for_shop both ways)", () => {
    expect(sql).toMatch(/create policy partner_trade_sheets_owner on partner_trade_sheets\s+for all to authenticated\s+using \(acts_for_shop\(shop_owner\)\)\s+with check \(acts_for_shop\(shop_owner\)\)/i);
  });

  it("partner reads are SELECT-only, gated on an active link AND their own row or the default", () => {
    // Capture the whole policy statement (no ';' appears until it ends).
    const m = sql.match(/create policy partner_trade_sheets_partner_read on partner_trade_sheets([\s\S]*?);/i);
    expect(m).toBeTruthy();
    const clause = m[1];
    expect(clause).toMatch(/for select to authenticated/i);
    // Row must apply to the caller: the '*' default OR their own email.
    expect(clause).toMatch(/partner_email = '\*' or acts_for_shop\(partner_email\)/i);
    // And an active partnership must link them to the sheet's owner.
    expect(clause).toMatch(/shop_partners sp/);
    expect(clause).toMatch(/sp\.status = 'active'/);
    expect(clause).toMatch(/acts_for_shop\(sp\.shop_a\)/);
    expect(clause).toMatch(/acts_for_shop\(sp\.shop_b\)/);
  });

  it("scale_pct is NOT on the partner-readable table (would invert to retail rates)", () => {
    const createSheets = sql.match(/create table partner_trade_sheets \(([\s\S]*?)\);/i);
    expect(createSheets).toBeTruthy();
    expect(createSheets[1]).not.toMatch(/scale_pct/);
    // Lives in the owner-only meta table; no SELECT (partner-read) policy on it.
    expect(sql).toMatch(/create policy partner_trade_sheet_meta_owner on partner_trade_sheet_meta\s+for all to authenticated/i);
    expect(sql).not.toMatch(/on partner_trade_sheet_meta\s+for select/i);
  });
});
