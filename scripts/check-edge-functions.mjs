// Syntax/parse gate for Supabase edge functions.
//
// Why: CI runs `npm test` + `npm run build`, but neither touches
// supabase/functions/ — vitest only imports the pure _shared helpers,
// and Vite's build ignores the Deno tree entirely. So a parse error in
// an edge function passes all 3,218 tests and only surfaces when the
// Supabase bundler rejects it at deploy time. That exact thing happened
// 2026-06-11: a double comma in qbSync's import list shipped green and
// broke the deploy.
//
// This parses every .ts/.js under supabase/functions/ with esbuild
// (transform mode — syntax only, no type-checking, no import
// resolution, so it never false-fails on Deno globals or pre-existing
// type noise). Catches the class of error that bit us; nothing more.

import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { transformSync } from "esbuild";

const ROOT = "supabase/functions";

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if ([".ts", ".js", ".mjs"].includes(extname(p))) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
const failures = [];
for (const f of files) {
  try {
    transformSync(readFileSync(f, "utf8"), {
      loader: extname(f) === ".ts" ? "ts" : "js",
      // No bundle, no resolve — pure parse. We only want syntax errors.
    });
  } catch (e) {
    const err = e.errors?.[0];
    const loc = err?.location ? `:${err.location.line}:${err.location.column}` : "";
    failures.push(`${f}${loc} — ${err?.text || e.message}`);
  }
}

if (failures.length) {
  console.error(`\n✗ Edge function syntax check FAILED (${failures.length}):\n`);
  for (const m of failures) console.error("  " + m);
  console.error("\nThese pass vitest but break the Supabase deploy bundler. Fix before merge.\n");
  process.exit(1);
}
console.log(`✓ Edge function syntax check passed (${files.length} files)`);
