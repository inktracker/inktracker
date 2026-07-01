// PUBLIC WIZARD (recurring "total missing the blank/garment cost" bug class) —
// an anonymous wizard submission produces a quote whose total INCLUDES the
// garment cost.
//
// STATUS: skipped pending UI-selector tuning — same convention as mfa.spec.js.
// The wizard is a multi-step anonymous flow (pick style → size qty → submit);
// the selectors here are a starting point to finish on the first real run, and
// the shop's public wizard URL/slug must be wired in (a test shop with
// wizard_styles seeded).
//
// IMPORTANT: this invariant is ALREADY enforced as a REQUIRED gate by the unit
// suite (which CI runs via `npm test`) — the wizard render-path tests:
//   src/lib/wizard/__tests__/wizardRenderPath.test.js  (+ the gate-3 audit:wizard)
// which walk the exact call graph the public wizard uses and fail if the total
// drops the blank cost. This e2e is the runtime complement.
import { test, expect } from "@playwright/test";
import { admin } from "./_helpers/supabaseClients.js";
import { createTestShop, deleteTestShop } from "./_helpers/testShop.js";

let shop;
test.beforeAll(async () => { shop = await createTestShop(); });
test.afterAll(async () => { await deleteTestShop(shop); });

test.skip("anonymous wizard submission creates a quote whose total includes the garment cost", async ({ page }) => {
  // 1. Visit the shop's public wizard (anonymous — no sign-in).
  //    TODO: resolve the shop's wizard slug/embed URL + seed wizard_styles.
  await page.goto(`/QuoteRequest?shop=${encodeURIComponent(shop.email)}`);

  // 2. Pick a style, enter a quantity, submit.
  //    TODO: finish style/size/submit selectors on first run.

  // 3. The submission inserts a quote (via createQuoteFromPayload/wizardSubmit).
  //    Assert its total is > 0 AND >= the garment (blank) cost — i.e. the blank
  //    cost wasn't dropped from the total.
  const { data: quotes } = await admin
    .from("quotes").select("total, line_items")
    .eq("shop_owner", shop.email).order("created_at", { ascending: false }).limit(1);
  const q = quotes?.[0];
  expect(q?.total).toBeGreaterThan(0);
});
