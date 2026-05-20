#!/usr/bin/env node
/**
 * One-shot Stripe Connect status reconciliation.
 *
 * Why this exists: the `account.updated` webhook only fires when a connected
 * account's state CHANGES at Stripe. If any shops completed Connect onboarding
 * while the platform webhook was misconfigured ("Listen to events on Connected
 * accounts" toggled off), their `shops.stripe_account_status` is stuck on
 * "pending" even though Stripe considers them active. Run this script ONCE
 * after enabling the toggle to backfill those rows from the live Stripe state.
 *
 * Required env vars (read from process.env):
 *   STRIPE_SECRET_KEY                — the LIVE platform key (sk_live_...)
 *   SUPABASE_URL                     — https://<project-ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY        — service_role key (bypasses RLS)
 *
 * Usage:
 *   # Dry run — prints what WOULD change, makes no writes (default):
 *   node scripts/reconcile-stripe-connect.mjs
 *
 *   # Apply — actually updates shops.stripe_account_status:
 *   node scripts/reconcile-stripe-connect.mjs --apply
 *
 * Status mapping mirrors supabase/functions/stripeWebhook/index.ts:
 *   charges_enabled               → "active"
 *   details_submitted (no charges)→ "restricted"
 *   else                          → "pending"
 *
 * Cost: one Stripe API call per shop with a stripe_account_id. At small
 * scale this is free; at hundreds of shops it's still negligible.
 */

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const APPLY = process.argv.includes("--apply");

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (!STRIPE_KEY) fail("STRIPE_SECRET_KEY env var is required");
if (!SUPABASE_URL) fail("SUPABASE_URL env var is required");
if (!SUPABASE_SERVICE_KEY) fail("SUPABASE_SERVICE_ROLE_KEY env var is required");

if (STRIPE_KEY.startsWith("sk_test_")) {
  console.warn("⚠ Using TEST Stripe key. Run against the LIVE key to reconcile prod shops.");
}

const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2024-06-20" });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function mapStatus(account) {
  if (account.charges_enabled) return "active";
  if (account.details_submitted) return "restricted";
  return "pending";
}

const MODE_LABEL = APPLY ? "APPLY" : "DRY RUN";
console.log(`\n=== Stripe Connect reconciliation — ${MODE_LABEL} ===\n`);

const { data: shops, error: shopsErr } = await supabase
  .from("shops")
  .select("id, owner_email, shop_name, stripe_account_id, stripe_account_status")
  .not("stripe_account_id", "is", null);

if (shopsErr) fail(`Failed to load shops: ${shopsErr.message}`);

if (!shops?.length) {
  console.log("No shops with a stripe_account_id. Nothing to reconcile.");
  process.exit(0);
}

console.log(`Found ${shops.length} shop(s) with a Stripe Connect account.\n`);

let unchanged = 0;
let updated = 0;
let errors = 0;
const changes = [];

for (const shop of shops) {
  const label = `${shop.shop_name || "(no name)"} <${shop.owner_email}>`;
  try {
    const account = await stripe.accounts.retrieve(shop.stripe_account_id);
    const liveStatus = mapStatus(account);

    if (liveStatus === shop.stripe_account_status) {
      unchanged++;
      console.log(`✓ ${label} — already ${liveStatus}`);
      continue;
    }

    changes.push({
      shopId: shop.id,
      label,
      stripeAccountId: shop.stripe_account_id,
      from: shop.stripe_account_status ?? "(null)",
      to: liveStatus,
      chargesEnabled: account.charges_enabled,
      detailsSubmitted: account.details_submitted,
    });

    console.log(`→ ${label}: ${shop.stripe_account_status ?? "(null)"} → ${liveStatus}` +
      `   [charges_enabled=${account.charges_enabled}, details_submitted=${account.details_submitted}]`);

    if (APPLY) {
      const { error: updErr } = await supabase
        .from("shops")
        .update({ stripe_account_status: liveStatus })
        .eq("id", shop.id);
      if (updErr) {
        errors++;
        console.error(`  ✗ update failed: ${updErr.message}`);
      } else {
        updated++;
      }
    }
  } catch (err) {
    errors++;
    console.error(`✗ ${label} — Stripe lookup failed: ${err.message}`);
  }
}

console.log("\n--- Summary ---");
console.log(`Total shops checked: ${shops.length}`);
console.log(`Already in sync:     ${unchanged}`);
console.log(`Would change:        ${changes.length}`);
if (APPLY) {
  console.log(`Actually updated:    ${updated}`);
}
console.log(`Errors:              ${errors}`);

if (!APPLY && changes.length > 0) {
  console.log("\n→ This was a DRY RUN. To actually apply these changes, re-run with --apply");
}

process.exit(errors > 0 ? 1 : 0);
