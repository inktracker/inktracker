// Minimal smoke that confirms Playwright is wired up and can reach
// the running Vite dev server. Doesn't touch auth; just renders the
// landing page and asserts something on it.
//
// Lives next to the MFA spec so the test runner has at least one
// passing test while the MFA selectors are being tuned (see
// mfa.spec.js header comment).

import { test, expect } from "@playwright/test";

test("landing page renders the brand name", async ({ page }) => {
  await page.goto("/");
  // The header / title contains "InkTracker" verbatim — both the
  // <title> tag and on-page copy. Asserting the title is the most
  // stable signal: it survives layout changes.
  await expect(page).toHaveTitle(/InkTracker/i);
});
