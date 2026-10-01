import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  RAIL,
  resolvePaymentRail,
  applyRailToInvoiceBody,
  loadPaymentRail,
  loadPaymentRailState,
  restoreQbOnlinePayFields,
  flagOn,
  paymentsPauseDate,
  planGraceOver,
  PLAN_GRACE_DAYS,
  stripeKeyMode,
  isTestDocument,
} from "../paymentRail.js";

const ready = { shop_owner: "joe@biotamfg.co", merchant_id: "mid_1", merchant_status: "active", enabled: true };

describe("resolvePaymentRail — processor only when everything lines up", () => {
  it("fully set up + switched on + platform on → processor", () => {
    expect(resolvePaymentRail({ envEnabled: true, account: ready })).toBe(RAIL.PROCESSOR);
    expect(resolvePaymentRail({ envEnabled: true, account: { ...ready, merchant_status: "ACTIVE" } })).toBe(RAIL.PROCESSOR);
  });

  it("anything missing → QuickBooks, like today", () => {
    expect(resolvePaymentRail({ envEnabled: false, account: ready })).toBe(RAIL.QB);
    expect(resolvePaymentRail({ envEnabled: true, account: null })).toBe(RAIL.QB);
    expect(resolvePaymentRail({ envEnabled: true, account: { ...ready, enabled: false } })).toBe(RAIL.QB);
    expect(resolvePaymentRail({ envEnabled: true, account: { ...ready, enabled: "true" } })).toBe(RAIL.QB);
    expect(resolvePaymentRail({ envEnabled: true, account: { ...ready, merchant_id: null } })).toBe(RAIL.QB);
    expect(resolvePaymentRail({ envEnabled: true, account: { ...ready, merchant_status: "pending" } })).toBe(RAIL.QB);
    expect(resolvePaymentRail({ envEnabled: true, account: { ...ready, merchant_status: null } })).toBe(RAIL.QB);
  });

  it("broker invoices always stay on QuickBooks", () => {
    expect(resolvePaymentRail({ envEnabled: true, account: ready, broker: true })).toBe(RAIL.QB);
  });
});

describe("applyRailToInvoiceBody", () => {
  it("QuickBooks rail: body untouched — InkTracker never sets the shop's QB payment flags", () => {
    const body = { Line: [] };
    expect(applyRailToInvoiceBody(body, RAIL.QB)).toBe(body);
    expect(applyRailToInvoiceBody({}, RAIL.QB)).toEqual({});
    expect("AllowOnlineCreditCardPayment" in applyRailToInvoiceBody(body, RAIL.QB)).toBe(false);
  });

  it("processor rail: both QB online-payment flags explicitly OFF", () => {
    expect(applyRailToInvoiceBody({ Line: [] }, RAIL.PROCESSOR)).toEqual({
      Line: [], AllowOnlineCreditCardPayment: false, AllowOnlineACHPayment: false,
    });
  });
});

describe("flagOn", () => {
  it("reads env switches strictly", () => {
    for (const v of ["1", "true", "TRUE", " yes "]) expect(flagOn(v)).toBe(true);
    for (const v of ["", "0", "false", "on", undefined, null]) expect(flagOn(v)).toBe(false);
  });
});

describe("loadPaymentRail — fails to QuickBooks", () => {
  const client = (result) => ({
    from: (table) => {
      expect(table).toBe("processor_accounts");
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => {
          if (result instanceof Error) throw result;
          return result;
        } }) }),
      };
    },
  });

  it("reads the shop's row", async () => {
    expect(await loadPaymentRail(client({ data: ready, error: null }), "joe@biotamfg.co", { envEnabled: true })).toBe(RAIL.PROCESSOR);
  });
  it("platform off → never even reads", async () => {
    const boom = { from: () => { throw new Error("should not read"); } };
    expect(await loadPaymentRail(boom, "joe@biotamfg.co", { envEnabled: false })).toBe(RAIL.QB);
  });
  it("read error or throw → QuickBooks", async () => {
    expect(await loadPaymentRail(client({ data: null, error: { message: "relation does not exist" } }), "a@b.co", { envEnabled: true })).toBe(RAIL.QB);
    expect(await loadPaymentRail(client(new Error("network")), "a@b.co", { envEnabled: true })).toBe(RAIL.QB);
  });
  it("no shop / broker → QuickBooks", async () => {
    expect(await loadPaymentRail(client({ data: ready, error: null }), "", { envEnabled: true })).toBe(RAIL.QB);
    expect(await loadPaymentRail(client({ data: ready, error: null }), "a@b.co", { envEnabled: true, broker: true })).toBe(RAIL.QB);
  });
});

// ── Source contract: how qbSync uses the rail ─────────────────────────────
// Pinned so a refactor can't quietly (a) read the rail from the request body
// (a caller could switch another shop's invoices off QuickBooks), (b) set the
// QB payment flags for QB-rail shops (Joe's 18 Sept rule), or (c) mint a QB
// link for a processor-rail shop.
describe("qbSync payment-rail contract", () => {
  const src = readFileSync(path.resolve(__dirname, "../../qbSync/index.ts"), "utf8");

  it("the rail comes from the authenticated shop, never params", () => {
    const calls = src.match(/loadPaymentRailState\([^)]*\)/g) ?? [];
    expect(calls.length).toBe(2);
    for (const c of calls) expect(c).toMatch(/loadPaymentRailState\((adminClient|depAdmin), shopOwnerEmail,/);
    expect(src).not.toMatch(/params\??\.\w*[Rr]ail/);
  });

  it("AllowOnline* is only ever set through applyRailToInvoiceBody", () => {
    const setters = src.split("\n").filter((l) => /AllowOnline\w*Payment\s*:/.test(l));
    expect(setters).toEqual([]);
  });

  it("every QB link mint is skipped on the processor rail", () => {
    const mints = src.split("\n").filter((l) => /await mintInvoicePaymentLink\(/.test(l)).length;
    expect(mints).toBe(3); // createInvoice, deposit adopt, deposit fresh
    expect((src.match(/PROCESSOR_LINK_REASON/g) ?? []).length).toBeGreaterThanOrEqual(4); // import + 3 skips
  });
});

describe("back on QuickBooks after InkTracker payments", () => {
  it("turns QB online pay back on ONLY for invoices InkTracker turned off, only for shops that used it", () => {
    const offByUs = { AllowOnlineCreditCardPayment: false, AllowOnlineACHPayment: false };
    expect(restoreQbOnlinePayFields(offByUs, true)).toEqual({ AllowOnlineCreditCardPayment: true, AllowOnlineACHPayment: true });
    expect(restoreQbOnlinePayFields(offByUs, false)).toEqual({}); // never-opted-in shop: untouched
    expect(restoreQbOnlinePayFields({ AllowOnlineCreditCardPayment: false, AllowOnlineACHPayment: true }, true)).toEqual({}); // shop's own ACH-only choice
    expect(restoreQbOnlinePayFields({}, true)).toEqual({});
    expect(restoreQbOnlinePayFields(null, true)).toEqual({});
  });

  it("restore = QB rail AND the shop once used InkTracker payments", async () => {
    const client = (row) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }) });
    const used = { merchant_id: "m", merchant_status: "suspended", enabled: true, processor_used_at: "2026-10-05" };
    expect(await loadPaymentRailState(client(used), "a@b.co", { envEnabled: true })).toEqual({ rail: RAIL.QB, restore: true });
    expect(await loadPaymentRailState(client({ ...used, merchant_status: "active" }), "a@b.co", { envEnabled: true })).toEqual({ rail: RAIL.PROCESSOR, restore: false });
    expect(await loadPaymentRailState(client({ ...used, processor_used_at: null }), "a@b.co", { envEnabled: false })).toEqual({ rail: RAIL.QB, restore: false });
    // kill switch off after use → still restores
    expect(await loadPaymentRailState(client(used), "a@b.co", { envEnabled: false })).toEqual({ rail: RAIL.QB, restore: true });
    expect(await loadPaymentRailState(client(used), "a@b.co", { envEnabled: true, broker: true })).toEqual({ rail: RAIL.QB, restore: false });
  });
});

describe("InkTracker plan lapse", () => {
  const lapsed = { ...ready, plan_lapsed_at: "2026-10-01T12:00:00Z" };
  it("keeps taking payments on InkTracker during the 14-day grace, then QuickBooks", () => {
    expect(PLAN_GRACE_DAYS).toBe(14);
    expect(paymentsPauseDate(lapsed)).toBe("2026-10-15");
    expect(resolvePaymentRail({ envEnabled: true, account: lapsed, now: Date.parse("2026-10-10T00:00:00Z") })).toBe(RAIL.PROCESSOR);
    expect(resolvePaymentRail({ envEnabled: true, account: lapsed, now: Date.parse("2026-10-16T00:00:00Z") })).toBe(RAIL.QB);
    expect(planGraceOver({ plan_lapsed_at: null })).toBe(false);
    expect(paymentsPauseDate({})).toBeNull();
  });
});

describe("Stripe test mode and live switch-over", () => {
  const on = { enabled: true, merchant_id: "acct_1", merchant_status: "active" };
  it("knows the key's mode", () => {
    expect(stripeKeyMode("sk_live_abc")).toBe("live");
    expect(stripeKeyMode("rk_live_abc")).toBe("live");
    expect(stripeKeyMode("sk_test_abc")).toBe("test");
    expect(stripeKeyMode("")).toBeNull();
    expect(stripeKeyMode(undefined)).toBeNull();
  });
  it("TEST / DEMO documents by the shop's naming convention (whole word)", () => {
    expect(isTestDocument({ customer_name: "TEST Tahoe Gift Co" })).toBe(true);
    expect(isTestDocument({ job_title: "Demo order" })).toBe(true);
    expect(isTestDocument({ company: "Tahoe Gift Co" })).toBe(false);
    expect(isTestDocument({ customer_name: "Contest Promotions" })).toBe(false); // not a whole word
    expect(isTestDocument(null)).toBe(false);
  });
  it("test mode: a real document stays on QuickBooks; a TEST one uses Stripe; shop-level status unaffected", () => {
    expect(resolvePaymentRail({ envEnabled: true, account: on, keyMode: "test", doc: { customer_name: "Tahoe Gift Co" } })).toBe(RAIL.QB);
    expect(resolvePaymentRail({ envEnabled: true, account: on, keyMode: "test", doc: { customer_name: "TEST Tahoe" } })).toBe(RAIL.PROCESSOR);
    expect(resolvePaymentRail({ envEnabled: true, account: on, keyMode: "test" })).toBe(RAIL.PROCESSOR);
    expect(resolvePaymentRail({ envEnabled: true, account: on, keyMode: "live", doc: { customer_name: "Tahoe Gift Co" } })).toBe(RAIL.PROCESSOR);
  });
  it("an account from the other mode → QuickBooks", () => {
    expect(resolvePaymentRail({ envEnabled: true, account: { ...on, stripe_livemode: false }, keyMode: "live" })).toBe(RAIL.QB);
    expect(resolvePaymentRail({ envEnabled: true, account: { ...on, stripe_livemode: true }, keyMode: "live" })).toBe(RAIL.PROCESSOR);
    expect(resolvePaymentRail({ envEnabled: true, account: { ...on, stripe_livemode: true }, keyMode: "test" })).toBe(RAIL.QB);
  });
});
