// Regression guards for audit findings F2 and F4 (2026-08-31).
//
// F4 — ss/ac/smLookupStyle resolved a client-supplied `shopOwner` BEFORE the
// authenticated session, so a logged-in caller could name another shop's
// shopOwner and borrow that shop's supplier credentials / negotiated pricing.
// The invariant: the authenticated-user branch must appear before the
// shopOwner-email branch in each resolver.
//
// F2 — sendQuoteEmail's anonymous branch forced shopName/logo but left the
// email subject/body caller-controlled, so a quote recipient could send a
// shop-branded email with arbitrary text. The invariant: the anon branch
// nulls subject and body.
//
// These are source-scan guards on purpose: the bugs were "a handler doesn't
// enforce X", which a behavioral unit test on a helper can't see — the same
// gap that let F1 silently regress.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("F4 — supplier lookups resolve the session before client shopOwner", () => {
  const RESOLVERS = [
    ["acLookupStyle", "../../acLookupStyle/index.ts", "resolveAcCredentials"],
    ["smLookupStyle", "../../smLookupStyle/index.ts", "resolveSmCredentials"],
    ["ssLookupStyle", "../../ssLookupStyle/index.ts", "resolveSSAuth"],
  ];

  for (const [name, path, fn] of RESOLVERS) {
    it(`${name}: authenticated-user branch precedes the shopOwner branch`, () => {
      const src = read(path);
      const start = src.indexOf(`function ${fn}`);
      expect(start).toBeGreaterThan(-1);
      const body = src.slice(start, src.indexOf("\n}", start) + 2);
      const authIdx = body.indexOf("getUser(");
      // All three resolvers do the anon lookup as `email: shopOwner`.
      const shopOwnerIdx = body.search(/email:\s*shopOwner/);
      expect(authIdx).toBeGreaterThan(-1);
      expect(shopOwnerIdx).toBeGreaterThan(-1);
      // getUser (session) must come before the shopOwner-email lookup.
      expect(authIdx).toBeLessThan(shopOwnerIdx);
    });
  }
});

describe("F2 — sendQuoteEmail anon branch forces subject/body from the template", () => {
  const src = read("../../sendQuoteEmail/index.ts");
  const anon = src.slice(src.indexOf("if (!isAuthed)"), src.indexOf("Authenticated-caller authorization"));

  it("nulls subject on the anonymous path", () => {
    expect(/\bsubject\s*=\s*undefined\b/.test(anon)).toBe(true);
  });
  it("nulls body on the anonymous path", () => {
    expect(/\bbody\s*=\s*undefined\b/.test(anon)).toBe(true);
  });
});
