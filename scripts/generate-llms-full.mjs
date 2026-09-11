// Generates public/llms-full.txt — the "full content" companion to llms.txt.
// llms.txt is a curated LINK index; llms-full.txt inlines the actual plain
// text of every guide and feature page so an AI crawler that wants the real
// content can grab it in one fetch instead of crawling each URL. Built from the
// same content modules the marketing pages render from, so it can't drift.
//
// Part of `npm run build:content`. Pure Node, writes one file.

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SITE, POSTS } from "./content/blog-posts.mjs";
import { FEATURES } from "./content/features.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, "..", "public");

// Strip HTML tags and decode the handful of entities the content uses, so the
// output is clean plain text (not markup).
function toPlain(html) {
  return String(html ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Turn a post's structured body blocks into readable plain text.
function postBodyToText(body) {
  const out = [];
  for (const block of body || []) {
    switch (block.type) {
      case "p":
        out.push(toPlain(block.html));
        break;
      case "h2":
        out.push(`## ${toPlain(block.text)}`);
        break;
      case "ul":
        for (const item of block.items || []) out.push(`- ${toPlain(item)}`);
        break;
      case "callout":
        out.push(`${toPlain(block.title)}: ${toPlain(block.html)}`);
        break;
      // calculator / image / other interactive blocks have no prose — skip.
      default:
        if (block.text) out.push(toPlain(block.text));
        else if (block.html) out.push(toPlain(block.html));
    }
  }
  return out.filter(Boolean).join("\n\n");
}

const lines = [];
lines.push("# InkTracker — Full Content for LLMs");
lines.push("");
lines.push(
  "> InkTracker is shop management software for screen printing and embroidery shops: quoting with live garment costs from S&S Activewear, SanMar, and AS Colour, customer art approval and payment links, production tracking with a shop-floor mode, QuickBooks Online two-way sync, and broker/wholesale pricing. Built by Biota MFG, a working screen printing shop in Reno, Nevada. One plan at $99/month with a free trial (no credit card); iOS app available.",
);
lines.push("");
lines.push(
  "This file inlines the full plain text of every InkTracker guide and feature page. It is the companion to /llms.txt, which is the curated link index.",
);
lines.push("");

// Guides (newest content first isn't important for ingestion — publish order).
lines.push("---");
lines.push("");
lines.push("# Guides");
lines.push("");
for (const post of POSTS) {
  lines.push(`## ${post.title}`);
  lines.push(`Source: ${SITE.baseUrl}/blog/${post.slug}`);
  lines.push("");
  if (post.description) {
    lines.push(post.description);
    lines.push("");
  }
  lines.push(postBodyToText(post.body));
  lines.push("");
}

// Feature pages — lede is the concise value statement for each.
lines.push("---");
lines.push("");
lines.push("# Features");
lines.push("");
for (const f of FEATURES) {
  lines.push(`## ${f.h1}`);
  lines.push(`Source: ${SITE.baseUrl}/features/${f.slug}`);
  lines.push("");
  lines.push(toPlain(f.lede));
  lines.push("");
}

const out = lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
writeFileSync(join(PUBLIC, "llms-full.txt"), out);
console.log(`✓ Generated public/llms-full.txt (${POSTS.length} guides + ${FEATURES.length} feature pages, ${out.length} bytes)`);
