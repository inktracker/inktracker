// Precompile the landing demo iframes (public/landing/*-demo/).
//
// The demos were authored as raw .jsx transpiled IN THE VISITOR'S BROWSER by
// @babel/standalone, on top of React DEVELOPMENT builds — ~4 MB of unpkg
// third-party JS on the critical path of every demo open, plus an unpkg
// dependency the CSP can never lock down. This script bakes all of that out:
//
//   *.jsx                    → *.js        (esbuild, minified, es2018)
//   inline <script type="text/babel">      → app.js per demo
//   index.html               → local /landing/vendor/react*.production.min.js
//                              + the compiled .js files, no Babel
//
// The .jsx files stay in the repo as the SOURCE OF TRUTH. Edit a demo →
// `npm run build:demos` → commit both the .jsx and the regenerated .js/html.
// (Prettier/CI don't touch public/landing.)
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, basename } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const LANDING = join(ROOT, "public/landing");
const ESBUILD = join(ROOT, "node_modules/.bin/esbuild");

const VENDOR_BLOCK = [
  '  <script src="/landing/vendor/react.production.min.js"></script>',
  '  <script src="/landing/vendor/react-dom.production.min.js"></script>',
].join("\n");

function transpile(source, label) {
  return execFileSync(
    ESBUILD,
    ["--loader=jsx", "--jsx=transform", "--target=es2018", "--minify"],
    { input: source, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
}

const demoDirs = readdirSync(LANDING).filter((d) => d.endsWith("-demo") && existsSync(join(LANDING, d, "index.html")));
if (demoDirs.length === 0) throw new Error("no demo dirs found");

for (const dir of demoDirs) {
  const demoPath = join(LANDING, dir);
  let html = readFileSync(join(demoPath, "index.html"), "utf8");

  // 1. Compile every .jsx next to the html.
  const jsxFiles = readdirSync(demoPath).filter((f) => f.endsWith(".jsx"));
  for (const f of jsxFiles) {
    const out = transpile(readFileSync(join(demoPath, f), "utf8"), `${dir}/${f}`);
    writeFileSync(join(demoPath, basename(f, ".jsx") + ".js"), out);
  }

  // 2. Compile the inline text/babel App block (if any) to app.js.
  const inline = html.match(/<script type="text\/babel">([\s\S]*?)<\/script>/);
  if (inline) {
    writeFileSync(join(demoPath, "app.js"), transpile(inline[1], `${dir}/inline`));
    html = html.replace(inline[0], '<script src="app.js"></script>');
  }

  // 3. Swap unpkg dev-React + Babel for local production vendor files.
  html = html
    .replace(/ *<script src="https:\/\/unpkg\.com\/react@[^"]+"[^>]*><\/script>\n?/, VENDOR_BLOCK + "\n")
    .replace(/ *<script src="https:\/\/unpkg\.com\/react-dom@[^"]+"[^>]*><\/script>\n?/, "")
    .replace(/ *<script src="https:\/\/unpkg\.com\/@babel\/standalone[^"]*"[^>]*><\/script>\n?/, "");

  // 4. External text/babel tags → their compiled .js.
  html = html.replace(/<script type="text\/babel" src="([^"]+)\.jsx"><\/script>/g, '<script src="$1.js"></script>');

  writeFileSync(join(demoPath, "index.html"), html);
  console.log(`✓ ${dir}: ${jsxFiles.length} jsx compiled${inline ? " + inline app" : ""}`);
}
console.log(`Done — ${demoDirs.length} demos on local production React, no Babel.`);
