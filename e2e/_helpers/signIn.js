// Drive the LoginModal email+password sign-in. Takes a Playwright page.
// Post-auth the app may stay at "/" while Layout flips to authenticated
// mode, so callers assert on visible content rather than a URL change.
import { expect } from "@playwright/test";

export async function signIn(page, email, password) {
  await page.goto("/");
  await page.getByRole("button", { name: /sign in/i }).first().click();
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.locator('form button[type="submit"]').click();
  // Sidebar nav (Dashboard link) only renders once authenticated.
  await expect(page.getByRole("link", { name: /dashboard/i }).first()).toBeVisible({ timeout: 20000 });
}
