#!/usr/bin/env node
// Seed throwaway customers pre-configured for the multi-state tax test matrix
// (docs/deploy-runbook-tax-stack.md). Saves editing one customer's ship-to /
// exemption between every scenario — each test customer is ready to quote.
//
// Run AFTER the tax stack is deployed (the migrations add the columns this
// writes). All customers are prefixed "ZZ Tax Test —" so cleanup is trivial.
//
// Usage:
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service-role key> \
//   SHOP_OWNER=joe@biotamfg.co \
//   node scripts/seed-tax-test-customers.mjs
//
// Optional (defaults shown) — set states to match YOUR QuickBooks nexus:
//   HOME_STATE=NV HOME_CITY=Reno      HOME_ZIP=89501      (a state you collect in)
//   NEXUS_STATE=CA NEXUS_CITY="Los Angeles" NEXUS_ZIP=90001 (another you collect in)
//   NONEXUS_STATE=NY NONEXUS_CITY="New York" NONEXUS_ZIP=10001 (one you do NOT collect in)
//   TEST_EMAIL=<where QB sends test invoices>   (defaults to SHOP_OWNER)
//
// Cleanup (removes the ZZ Tax Test customers):
//   ... SHOP_OWNER=... node scripts/seed-tax-test-customers.mjs --cleanup

const URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SHOP_OWNER = process.env.SHOP_OWNER;
const CLEANUP = process.argv.includes("--cleanup");

const HOME_STATE = process.env.HOME_STATE || "NV";
const HOME_CITY = process.env.HOME_CITY || "Reno";
const HOME_ZIP = process.env.HOME_ZIP || "89501";
const NEXUS_STATE = process.env.NEXUS_STATE || "CA";
const NEXUS_CITY = process.env.NEXUS_CITY || "Los Angeles";
const NEXUS_ZIP = process.env.NEXUS_ZIP || "90001";
const NONEXUS_STATE = process.env.NONEXUS_STATE || "NY";
const NONEXUS_CITY = process.env.NONEXUS_CITY || "New York";
const NONEXUS_ZIP = process.env.NONEXUS_ZIP || "10001";
const TEST_EMAIL = process.env.TEST_EMAIL || SHOP_OWNER;

function fail(msg) {
  console.error(`\n  ${msg}\n  Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SHOP_OWNER\n`);
  process.exit(1);
}
if (!URL) fail("SUPABASE_URL is required.");
if (!KEY) fail("SUPABASE_SERVICE_ROLE_KEY is required.");
if (!SHOP_OWNER) fail("SHOP_OWNER is required (which shop to seed).");

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const PREFIX = "ZZ Tax Test —";
const future = new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10);
const ship = (street, city, state, zip) => ({ street, city, state, zip, country: "US" });

// scenario → expected result (printed for the tester)
const CUSTOMERS = [
  { n: "In-State Taxable", expect: `tax at ${HOME_STATE} rate; no hold`,
    ship: ship("1 Test St", HOME_CITY, HOME_STATE, HOME_ZIP), tax_exempt: false },
  { n: `Out-of-State (${NEXUS_STATE})`, expect: `tax at ${NEXUS_STATE} rate (destination) — the Kato fix`,
    ship: ship("2 Test Ave", NEXUS_CITY, NEXUS_STATE, NEXUS_ZIP), tax_exempt: false },
  { n: `No-Nexus (${NONEXUS_STATE})`, expect: `$0 tax (no nexus in ${NONEXUS_STATE})`,
    ship: ship("3 Test Blvd", NONEXUS_CITY, NONEXUS_STATE, NONEXUS_ZIP), tax_exempt: false },
  { n: "No Ship-To", expect: "AST falls back to home; if tax ≠ quote → HELD",
    ship: null, tax_exempt: false },
  { n: "Exempt (valid cert)", expect: "$0 tax (exempt)",
    ship: ship("5 Test St", HOME_CITY, HOME_STATE, HOME_ZIP), tax_exempt: true,
    exemption_type: "resale", exemption_certificate_number: "TEST-RESALE-VALID", exemption_expires_at: future },
  { n: "Exempt (EXPIRED cert)", expect: "COLLECTS tax (cert lapsed) + 'cert expired' badge",
    ship: ship("6 Test St", HOME_CITY, HOME_STATE, HOME_ZIP), tax_exempt: true,
    exemption_type: "resale", exemption_certificate_number: "TEST-RESALE-EXPIRED", exemption_expires_at: "2020-01-01" },
  { n: `Exempt (${NEXUS_STATE} only) shipped to ${HOME_STATE}`, expect: `COLLECTS tax (out of cert scope)`,
    ship: ship("7 Test St", HOME_CITY, HOME_STATE, HOME_ZIP), tax_exempt: true,
    exemption_type: "resale", exemption_certificate_number: "TEST-RESALE-SCOPED",
    exemption_states: [NEXUS_STATE], exemption_expires_at: future },
];

async function listExisting() {
  const q = `${URL}/rest/v1/customers?shop_owner=eq.${encodeURIComponent(SHOP_OWNER)}&name=like.${encodeURIComponent(PREFIX + "%")}&select=id,name`;
  const res = await fetch(q, { headers: H });
  if (!res.ok) throw new Error(`list failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function deleteExisting() {
  const existing = await listExisting();
  for (const c of existing) {
    const res = await fetch(`${URL}/rest/v1/customers?id=eq.${c.id}`, { method: "DELETE", headers: H });
    if (!res.ok) console.error(`  ✗ delete ${c.name}: ${res.status}`);
  }
  return existing.length;
}

const run = async () => {
  if (CLEANUP) {
    const n = await deleteExisting();
    console.log(`\n✓ Removed ${n} "ZZ Tax Test —" customer(s) for ${SHOP_OWNER}.`);
    console.log("  (Their tax_records, if any, are keyed by qb_invoice_id — ask Claude to purge those.)\n");
    return;
  }

  const removed = await deleteExisting();
  if (removed) console.log(`(replaced ${removed} existing test customer(s))`);

  const rows = CUSTOMERS.map((c, i) => ({
    name: `${PREFIX} ${c.n}`,
    company: `${PREFIX} ${c.n}`,
    email: TEST_EMAIL,
    shop_owner: SHOP_OWNER,
    orders: 0,
    address: c.ship ? `${c.ship.street}, ${c.ship.city}, ${c.ship.state} ${c.ship.zip}` : "",
    ship_to_address: c.ship,
    tax_exempt: !!c.tax_exempt,
    exemption_type: c.exemption_type || null,
    exemption_certificate_number: c.exemption_certificate_number || null,
    exemption_expires_at: c.exemption_expires_at || null,
    exemption_states: c.exemption_states || null,
    _i: i,
  }));
  // strip the helper field before insert
  const payload = rows.map(({ _i, ...r }) => r);

  const res = await fetch(`${URL}/rest/v1/customers`, {
    method: "POST",
    headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`insert failed: ${res.status} ${await res.text()}`);

  console.log(`\n✓ Seeded ${payload.length} test customers for ${SHOP_OWNER}. Test invoices email → ${TEST_EMAIL}\n`);
  console.log("  For each: open it → build a small quote → send/create the QB invoice → check:\n");
  for (const c of CUSTOMERS) {
    console.log(`  • ${PREFIX} ${c.n}`);
    console.log(`      → expect: ${c.expect}`);
  }
  console.log("\n  States default to NV/CA/NY — re-run with HOME_STATE / NEXUS_STATE / NONEXUS_STATE");
  console.log("  set to match YOUR QuickBooks nexus if those aren't right.");
  console.log("\n  Cleanup when done:  ... --cleanup  (then void the QB invoices + ask Claude to purge tax_records)\n");
};

run().catch((e) => { console.error("\n✗", e.message, "\n"); process.exit(1); });
