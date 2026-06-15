// Manager permissions enforcement: an owner restricts a section, and the
// invited manager can neither see it in the nav nor reach it by URL —
// while a permitted section stays accessible. Guards the per-manager
// permission model end-to-end (nav filter + route guard + shopScope).
import { test, expect } from "@playwright/test";
import { createTestShop, addTestManager, deleteTestShop, deleteTestUserById } from "./_helpers/testShop.js";
import { signIn } from "./_helpers/signIn.js";

let shop, manager;
test.beforeAll(async () => {
  shop = await createTestShop();
  // Manager with Invoices denied, everything else allowed.
  manager = await addTestManager(shop.email, { Invoices: false });
});
test.afterAll(async () => {
  await deleteTestUserById(manager?.authId);
  await deleteTestShop(shop);
});

test("denied section is hidden from nav and blocked by URL; allowed section works", async ({ page }) => {
  await signIn(page, manager.email, manager.password);

  // Denied: Invoices is gone from the sidebar.
  await expect(page.getByRole("link", { name: /^invoices$/i })).toHaveCount(0);

  // Allowed: Quotes is present and reachable.
  await expect(page.getByRole("link", { name: /^quotes$/i }).first()).toBeVisible();

  // Denied by URL: navigating directly to /Invoices redirects away.
  await page.goto("/Invoices");
  await page.waitForTimeout(1500); // let the route guard redirect
  await expect(page).not.toHaveURL(/\/Invoices/);

  // And the manager sees the OWNER's shop data (shopScope), not a blank shop.
  await page.goto("/Customers");
  await expect(page.getByText("E2E Customer Co").first()).toBeVisible({ timeout: 15000 });
});
