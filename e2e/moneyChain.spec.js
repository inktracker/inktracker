// MONEY-CHAIN INTEGRITY (NEW-09 / PRICE-01) — quote → order → invoice keep the
// same subtotal/tax/total, and the QB invoice payload includes the
// "Setup & Screen Fees" line (setup_total carried the whole way).
//
// STATUS: skipped pending UI-selector tuning — same convention as mfa.spec.js.
// The convert→complete→create-invoice flow is multi-step UI; the selectors here
// are a starting point to finish on the first real run.
//
// IMPORTANT: this invariant is ALREADY enforced as a REQUIRED gate by the unit
// suite (which CI runs via `npm test`):
//   src/lib/orders/__tests__/orderInvoiceQbReconcile.test.js
// That walks the real quote→order→invoice→buildQBInvoicePayload chain and
// asserts the QB payload carries garment+setup+fees, a flat discount stays
// flat, and the deposit is credited — and includes a regression assertion that
// goes RED if any component is dropped. This e2e is the runtime complement; the
// logic guard does not depend on it.
import { test, expect } from "@playwright/test";
import { admin } from "./_helpers/supabaseClients.js";
import { createTestShop, deleteTestShop } from "./_helpers/testShop.js";
import { signIn } from "./_helpers/signIn.js";

let shop;
let quoteRowId;

test.beforeAll(async () => {
  shop = await createTestShop();
  // A saved quote WITH a setup fee and a real total, ready to convert.
  const { data } = await admin.from("quotes").insert({
    shop_owner: shop.email,
    quote_id: `Q-MONEY-${Math.random().toString(36).slice(2, 6)}`,
    customer_name: "Money Chain", status: "Draft",
    line_items: [{ id: "li-1", style: "1717", brand: "CC", garmentColor: "Black",
      sizes: { M: "10" }, imprints: [{ id: "imp-1", location: "Front", colors: 1, technique: "Screen Print" }],
      _ppp: 10, _lineTotal: 100, _rushFee: 0 }],
    setup_total: 45,
    subtotal: 100, tax: 0, total: 145, // 100 garment + 45 setup
  }).select("id").single();
  quoteRowId = data?.id;
});
test.afterAll(async () => { await deleteTestShop(shop); });

test.skip("quote → order → invoice preserve totals + carry the setup fee to QB", async ({ page }) => {
  await signIn(page, shop.email, shop.password);

  // 1. Convert the quote to an order (Quotes → open quote → Convert to Order).
  await page.goto("/Quotes");
  await page.getByText("Money Chain").first().click();
  await page.getByRole("button", { name: /convert to order/i }).click();

  // 2. Walk the order to Completed, then Create Invoice.
  //    (Production → open order → advance to Completed → Create Invoice.)
  //    TODO: finish stage-advance selectors on first run.

  // 3. Assert the persisted rows foot: quote.total === order.total === invoice.total,
  //    and the order + invoice both carry setup_total = 45.
  const { data: q } = await admin.from("quotes").select("total,setup_total").eq("id", quoteRowId).single();
  const { data: o } = await admin.from("orders").select("total,setup_total").eq("shop_owner", shop.email).order("created_at", { ascending: false }).limit(1).single();
  const { data: inv } = await admin.from("invoices").select("total,setup_total").eq("shop_owner", shop.email).order("created_at", { ascending: false }).limit(1).single();
  expect(o.total).toBeCloseTo(q.total, 2);
  expect(inv.total).toBeCloseTo(q.total, 2);
  expect(Number(o.setup_total)).toBe(45);
  expect(Number(inv.setup_total)).toBe(45);
});
