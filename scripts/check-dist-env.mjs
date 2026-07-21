#!/usr/bin/env node
// Build gate: fail if any `import.meta` survives into the production bundle.
//
// Vite statically replaces `import.meta.env.X` at build time — but ONLY the
// bare form. Optional chaining (`import.meta?.env?.X`) slips through to the
// browser, where import.meta.env is undefined at runtime, so the env value
// silently becomes "" in production while working fine in dev and vitest.
// That exact gap shipped the customer-facing art-proof 404 (#680): the
// artworkProof proxy URL builder returned null for every customer for three
// weeks. An eslint no-restricted-syntax rule catches the pattern at lint
// time; this is the belt-and-suspenders check on the actual build output,
// which also catches any OTHER path that leaves runtime import.meta access
// in the bundle (new tooling, a dependency, a future refactor).
//
// Wired into `npm run build` (vite build && node scripts/check-dist-env.mjs),
// which is also what Vercel runs — so a violation can never reach production.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const distAssets = join(process.cwd(), "dist", "assets");

let files;
try {
  files = readdirSync(distAssets).filter((f) => f.endsWith(".js"));
} catch {
  console.error(`[check-dist-env] ${distAssets} not found — run vite build first.`);
  process.exit(1);
}

const offenders = [];
for (const f of files) {
  const src = readFileSync(join(distAssets, f), "utf8");
  const idx = src.indexOf("import.meta");
  if (idx !== -1) {
    offenders.push({ file: f, excerpt: src.slice(Math.max(0, idx - 60), idx + 80) });
  }
}

if (offenders.length > 0) {
  console.error(
    "[check-dist-env] FAIL — runtime `import.meta` found in the production bundle.\n" +
    "Vite did not statically replace an env access. Most likely someone wrote\n" +
    "`import.meta?.env?.X` (optional chaining) — use the bare `import.meta.env.X` form.\n"
  );
  for (const o of offenders) {
    console.error(`  ${o.file}\n    …${o.excerpt.replace(/\n/g, " ")}…\n`);
  }
  process.exit(1);
}

console.log(`[check-dist-env] OK — ${files.length} bundle files, no runtime import.meta.`);
