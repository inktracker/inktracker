// SanMar TEST-environment purchase-order runner (onboarding step, Sept 2026).
//
// SanMar requires a multi-line test PO on their TEST environment, shipped to
// the address we'll use in production, before they enable integrated POs on
// the production account. This script drives the SAME shared code the
// smPlaceOrder edge function uses (_shared/sanmar.ts: resolveSmPoLines →
// getPreSubmitInfo → submitPO), so a green run here validates the real path.
//
// It never touches production: the endpoint is hard-wired to
// test-ws.sanmar.com and the credentials come ONLY from SANMAR_TEST_* env
// vars (SanMar issues separate test creds — retrieve them from their
// one-time Bitwarden link yourself; never paste them into chat or files).
//
// Usage (run from the repo root; creds are read from the environment):
//
//   SANMAR_TEST_CUSTOMER_NUMBER=198063 \
//   SANMAR_TEST_USERNAME=... SANMAR_TEST_PASSWORD=... \
//   ~/.deno/bin/deno run --allow-net --allow-env scripts/sanmar-test-po.ts --po BIOTA-TEST-1
//
// Flags:
//   --po <num>            PO number (≤28 chars, no commas). REQUIRED.
//   --submit              Actually call submitPO. Without it: resolve + stock
//                         check only (dry run).
//   --ship-method <m>     Default "UPS" (ground). Run once per ship-via you
//                         plan to support (SanMar wants each validated).
//   --email <addr>        Ship-to / notification email (default: joe@biotamfg.co).
//   --residence           Flag the ship-to as residential (default N).
//   --skip-stock-check    Submit even if getPreSubmitInfo says short (test env
//                         inventory "may not match production").
//   --no-resolve          Send style/color/size instead of inventoryKey+sizeIndex
//                         (schema allows either; use if the test env's Product
//                         Info service can't resolve the test styles).
//   --line STYLE|COLOR|SIZE|QTY   Add a line (repeatable). Default = the
//                         guide's recommended test products (p.13), 4 lines.
//   --ship-to "Company|Address1|Address2|City|ST|ZIP"  Override the ship-to
//                         (default = Biota Mfg's production address).
//
// Output is plain text; nothing secret is printed.

import {
  SM_TEST_BASE,
  SM_PO_SPEC,
  buildPreSubmitInfoEnvelope,
  buildSubmitPoEnvelope,
  parsePreSubmitInfoResponse,
  parseSubmitPoResponse,
  resolveSmPoLines,
  normalizeSmShipMethod,
  normalizeSmZip,
  smSoapCall,
  type SmCreds,
  type SmPoLine,
  type SmPoRequest,
} from "../supabase/functions/_shared/sanmar.ts";

function arg(name: string): string | undefined {
  const i = Deno.args.indexOf(name);
  return i >= 0 ? Deno.args[i + 1] : undefined;
}
function flag(name: string): boolean {
  return Deno.args.includes(name);
}
function args(name: string): string[] {
  const out: string[] = [];
  Deno.args.forEach((a, i) => { if (a === name && Deno.args[i + 1]) out.push(Deno.args[i + 1]); });
  return out;
}

const creds: SmCreds = {
  customerNumber: Deno.env.get("SANMAR_TEST_CUSTOMER_NUMBER") || "",
  username: Deno.env.get("SANMAR_TEST_USERNAME") || "",
  password: Deno.env.get("SANMAR_TEST_PASSWORD") || "",
};
if (!creds.customerNumber || !creds.username || !creds.password) {
  console.error("Missing SANMAR_TEST_CUSTOMER_NUMBER / SANMAR_TEST_USERNAME / SANMAR_TEST_PASSWORD in env.");
  Deno.exit(2);
}

const poNumber = arg("--po") || "";
if (!poNumber) {
  console.error("--po <number> is required (≤28 chars, no commas).");
  Deno.exit(2);
}

// Ship-to: SanMar requires the address we'll use in PRODUCTION.
const shipToRaw = arg("--ship-to") || "Biota Mfg|790 South Virginia St||Reno|NV|89501-2326";
const [company, address1, address2, city, state, zip] = shipToRaw.split("|").map((s) => s.trim());
const shipTo = {
  name: company,
  address1,
  address2,
  city,
  state,
  zip,
  email: arg("--email") || "joe@biotamfg.co",
  attention: poNumber,
  residence: flag("--residence"),
};
if (!normalizeSmZip(shipTo.zip)) {
  console.error(`Bad ZIP "${shipTo.zip}"`);
  Deno.exit(2);
}

const shipMethod = normalizeSmShipMethod(arg("--ship-method") || "UPS");
if (!shipMethod) {
  console.error(`"${arg("--ship-method")}" is not a SanMar ship method.`);
  Deno.exit(2);
}

// Default lines = SanMar's recommended test products (PO guide v24.3, p.13).
// Multi-line on purpose: SanMar validates formatting on multi-line orders.
const lineSpecs = args("--line").length
  ? args("--line")
  : ["PC61|Charcoal|S|12", "PC61|Brown|S|6", "PC55|Aquatic Blue|S|6", "S508|Maui Blue|M|3"];
const inputs = lineSpecs.map((spec) => {
  const [style, color, size, qty] = spec.split("|").map((s) => s.trim());
  return { style, color, size, quantity: Number(qty) || 0 };
});

const base = SM_TEST_BASE;
console.log(`SanMar TEST env: ${base}`);
console.log(`PO ${poNumber} → ${shipTo.name}, ${shipTo.address1}, ${shipTo.city} ${shipTo.state} ${normalizeSmZip(shipTo.zip)} via ${shipMethod}`);

// ── 1. Resolve lines to inventoryKey + sizeIndex (unless --no-resolve) ─────
let lines: SmPoLine[];
if (flag("--no-resolve")) {
  lines = inputs.map((l) => ({ style: l.style, catalogColor: l.color, size: l.size, quantity: l.quantity }));
  console.log("Sending style/color/size lines (no key resolution).");
} else {
  const { resolved, unresolved } = await resolveSmPoLines(creds, base, inputs, smSoapCall, "test-po:resolve");
  if (unresolved.length) {
    console.error(`Could not resolve ${unresolved.length} line(s) in the TEST env: ${unresolved.join(", ")}`);
    console.error("Re-run with --no-resolve to send style/color/size instead (allowed by the schema).");
    Deno.exit(1);
  }
  lines = resolved;
}
for (const l of lines) {
  console.log(`  line: ${l.style} ${l.catalogColor || ""} ${l.size || ""} × ${l.quantity}` +
    (l.inventoryKey ? `  [inventoryKey ${l.inventoryKey}, sizeIndex ${l.sizeIndex}]` : ""));
}

const po: SmPoRequest = { poNumber, shipTo, shipMethod, lines };

// ── 2. Stock check (getPreSubmitInfo) — never places an order ──────────────
const pre = await smSoapCall(`${base}/${SM_PO_SPEC.servicePort}`, buildPreSubmitInfoEnvelope(creds, po), "test-po:presubmit");
const preParsed = pre.ok ? parsePreSubmitInfoResponse(pre.xml) : null;
if (!pre.ok) {
  console.log(`getPreSubmitInfo: NOT OK — ${pre.error}`);
} else {
  console.log(`getPreSubmitInfo: ${preParsed!.ok ? "all lines in stock" : "SHORT"} — ${preParsed!.message}`);
  for (const l of preParsed!.lines) {
    console.log(`  ${l.ok ? "✓" : "✗"} ${l.style} ${l.color} ${l.size} × ${l.quantity}  whse ${l.whseNo || "?"}  ${l.message}`);
  }
}
if (!pre.ok || !preParsed?.ok) {
  if (!flag("--skip-stock-check")) {
    console.log("Stopping before submit (stock check failed). Use --skip-stock-check to submit anyway in the TEST env.");
    Deno.exit(flag("--submit") ? 1 : 0);
  }
  console.log("--skip-stock-check set — continuing.");
}

// ── 3. Submit (only with --submit) ────────────────────────────────────────
if (!flag("--submit")) {
  console.log("Dry run complete. Add --submit to place the TEST order.");
  Deno.exit(0);
}
const res = await smSoapCall(`${base}/${SM_PO_SPEC.servicePort}`, buildSubmitPoEnvelope(creds, po), "test-po:submit");
if (!res.ok) {
  console.error(`submitPO FAILED: ${res.error}`);
  console.error(res.xml.slice(0, 600));
  Deno.exit(1);
}
const parsed = parseSubmitPoResponse(res.xml);
console.log(`submitPO: ${parsed.success ? "SUCCESS" : "REJECTED"} — ${parsed.message}`);
if (!parsed.success) Deno.exit(1);
console.log(`\nNext: email sanmarintegrations@sanmar.com with PO number "${poNumber}" so they can validate the order files.`);
