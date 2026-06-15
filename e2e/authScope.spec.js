// Auth + tenant data-scoping: an owner signs in and sees THEIR shop's
// data. Guards the shopScope/RLS path — the class of bug where a query
// returns nothing (or the wrong tenant's rows) after a refactor.
import { test, expect } from "@playwright/test";
import { createTestShop, deleteTestShop } from "./_helpers/testShop.js";
import { signIn } from "./_helpers/signIn.js";

let shop;
test.beforeAll(async () => { shop = await createTestShop(); });
test.afterAll(async () => { await deleteTestShop(shop); });

test("owner signs in and sees their own shop's customer + quote", async ({ page }) => {
  await signIn(page, shop.email, shop.password);

  // Customers list shows the shop's customer (data scoped to this owner).
  await page.goto("/Customers");
  await expect(page.getByText("E2E Customer Co").first()).toBeVisible({ timeout: 15000 });

  // Quotes list shows the shop's quote (rendered by company name).
  await page.goto("/Quotes");
  await expect(page.getByText("E2E Customer Co").first()).toBeVisible({ timeout: 15000 });
});
