// Playwright config — Phase 6 of the MFA rollout.
//
// Default: spin up the local Vite dev server on port 5173 and run
// tests against it. Override the base URL with PLAYWRIGHT_BASE_URL if
// you want to smoke-test against the preview deploy or prod.
//
// Tests live in `e2e/`. We deliberately keep the runner Chromium-only
// for v1 — adding Firefox/WebKit triples the install + run time and
// the MFA flow is browser-engine-agnostic anyway. If we ever surface
// a layout regression that only repros on Safari we add WebKit then.

import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config(); // fall back to .env

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:5173";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // MFA tests touch shared auth state — keep them serial
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Only auto-start the dev server when targeting localhost. Hitting
  // a preview deploy or prod doesn't need it.
  webServer: BASE_URL.startsWith("http://localhost")
    ? {
        command: "npm run dev",
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
      }
    : undefined,
});
