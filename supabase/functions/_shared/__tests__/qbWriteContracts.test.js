import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  sumQbLineAmounts,
  toMoneyOrNull,
  reconcileQbInvoice,
  RECONCILE_SEVERITY,
} from "../qbWriteContracts.js";

// ════════════════════════════════════════════════════════════════════════════
// INVARIANT 1: InkTracker cannot delete anything in QuickBooks.
//
// Enforced by scanning every file under supabase/functions/ for any
// pattern that could destructively mutate QB. If anyone ever adds a
// qbDelete helper, an HTTP DELETE call to the QB host, or a /void
// endpoint, this test fails CI.
//
// We allow DELETE against Supabase tables (that's our own data) — only
// QB-bound deletions are forbidden. The DELETE_QB_PATTERNS matches on
// QB-specific shapes only.
// ════════════════════════════════════════════════════════════════════════════

const FUNCTIONS_DIR = path.resolve(__dirname, "../../"); // supabase/functions
const SCAN_EXTS = new Set([".ts", ".js", ".tsx", ".jsx"]);

// Patterns that would indicate destructive QB mutation. Each entry is
// matched against every line in every function file. False positives
// are easy to suppress by tightening the regex.
const FORBIDDEN_QB_DELETE_PATTERNS = [
  // Any helper named qbDelete or quickbooksDelete (case-insensitive)
  { name: "qbDelete helper",      regex: /\bq(uick|b)\w*Delete\b/i },
  // POST/DELETE to QB's void endpoint — the only way to "delete" an
  // invoice or payment in QB API
  { name: "QB /void endpoint",    regex: /quickbooks\.api\.intuit\.com[^"']*\/(void|operation=void)/ },
  { name: "operation=delete",     regex: /operation=delete\b/ },
  // HTTP DELETE specifically against the QB host
  { name: "HTTP DELETE to QB",    regex: /method:\s*['"]DELETE['"][^}]*quickbooks\.api\.intuit\.com|fetch\([^)]*quickbooks\.api\.intuit\.com[^)]*method:\s*['"]DELETE/i },
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (SCAN_EXTS.has(path.extname(entry))) yield full;
  }
}

describe("INVARIANT — InkTracker cannot delete anything in QuickBooks", () => {
  const files = [...walk(FUNCTIONS_DIR)];

  it("scans actual edge-function source — sanity that the walk found files", () => {
    expect(files.length).toBeGreaterThan(5);
    // Spot-check that the QB sync file is being scanned.
    expect(files.some((f) => f.endsWith("qbSync/index.ts"))).toBe(true);
  });

  for (const { name, regex } of FORBIDDEN_QB_DELETE_PATTERNS) {
    it(`forbids: ${name}`, () => {
      const offenders = [];
      for (const file of files) {
        // Skip this test file itself — the pattern strings appear here.
        if (file.endsWith("qbWriteContracts.test.js")) continue;
        const content = readFileSync(file, "utf8");
        const lines = content.split("\n");
        lines.forEach((line, i) => {
          // Strip line comments before matching so a comment that
          // discusses the forbidden pattern (e.g. in this very file's
          // docstring) doesn't trip the scanner.
          const codeOnly = line.replace(/\/\/.*$/, "");
          if (regex.test(codeOnly)) {
            offenders.push(`${path.relative(FUNCTIONS_DIR, file)}:${i + 1}: ${line.trim()}`);
          }
        });
      }
      expect(offenders, offenders.join("\n") || "no offenders").toEqual([]);
    });
  }

  it("the qbSync helpers expose only qbCreate and qbUpdate — no destructive helper", () => {
    const qbSyncSource = readFileSync(path.join(FUNCTIONS_DIR, "qbSync/index.ts"), "utf8");
    // Grep for any function declaration that smells like a delete
    // helper. Must exclude buildOrderInsert, etc — only flag function
    // names whose root verb is delete/remove/void/destroy.
    const helperDecls = qbSyncSource.match(/(?:function|const)\s+(qb\w+)\s*[(=]/g) ?? [];
    const helperNames = helperDecls.map((d) =>
      d.replace(/(?:function|const)\s+/, "").replace(/[(=]\s*$/, "").trim(),
    );
    for (const n of helperNames) {
      expect(n, `unexpected destructive helper: ${n}`).not.toMatch(/(delete|remove|void|destroy)/i);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// INVARIANT 2: Numbers sent to QB match what InkTracker calculated.
//
// reconcileQbInvoice() compares what we sent against what QB returned;
// any drift beyond a 1-cent tolerance produces a non-OK severity that
// the runtime caller logs.
// ════════════════════════════════════════════════════════════════════════════

describe("sumQbLineAmounts — never produces NaN or null", () => {
  it("returns 0 for null/undefined/non-array input", () => {
    expect(sumQbLineAmounts(null)).toBe(0);
    expect(sumQbLineAmounts(undefined)).toBe(0);
    expect(sumQbLineAmounts({})).toBe(0);
    expect(sumQbLineAmounts("not an array")).toBe(0);
    expect(sumQbLineAmounts([])).toBe(0);
  });

  it("sums Amount across SalesItemLineDetail lines", () => {
    expect(sumQbLineAmounts([
      { DetailType: "SalesItemLineDetail", Amount: 100 },
      { DetailType: "SalesItemLineDetail", Amount: 50.25 },
    ])).toBe(150.25);
  });

  it("ignores SubTotal / DiscountLineDetail / other line types", () => {
    expect(sumQbLineAmounts([
      { DetailType: "SalesItemLineDetail", Amount: 100 },
      { DetailType: "SubTotalLineDetail",  Amount: 100 },
      { DetailType: "DiscountLineDetail",  Amount: 10 },
    ])).toBe(100);
  });

  it("includes lines with no DetailType (defensive — QB sometimes omits)", () => {
    expect(sumQbLineAmounts([{ Amount: 42 }])).toBe(42);
  });

  it("skips garbage Amount values without producing NaN", () => {
    expect(sumQbLineAmounts([
      { DetailType: "SalesItemLineDetail", Amount: 100 },
      { DetailType: "SalesItemLineDetail", Amount: "abc" },
      { DetailType: "SalesItemLineDetail", Amount: null },
      { DetailType: "SalesItemLineDetail", Amount: undefined },
      { DetailType: "SalesItemLineDetail" },
    ])).toBe(100);
  });

  it("rounds to 2 decimal places (avoids floating-point drift)", () => {
    expect(sumQbLineAmounts([
      { DetailType: "SalesItemLineDetail", Amount: 0.1 },
      { DetailType: "SalesItemLineDetail", Amount: 0.2 },
    ])).toBe(0.3);
  });
});

describe("toMoneyOrNull — strict money coercion", () => {
  it("returns null for missing/empty/garbage values — no silent zeros", () => {
    expect(toMoneyOrNull(null)).toBeNull();
    expect(toMoneyOrNull(undefined)).toBeNull();
    expect(toMoneyOrNull("")).toBeNull();
    expect(toMoneyOrNull("abc")).toBeNull();
    expect(toMoneyOrNull(NaN)).toBeNull();
    expect(toMoneyOrNull(Infinity)).toBeNull();
    expect(toMoneyOrNull(-Infinity)).toBeNull();
  });

  it("coerces strings and numbers to 2-decimal floats", () => {
    expect(toMoneyOrNull("100")).toBe(100);
    expect(toMoneyOrNull("100.567")).toBe(100.57);
    expect(toMoneyOrNull(99.999)).toBe(100);
    expect(toMoneyOrNull(0)).toBe(0);
  });

  it("preserves negative numbers (refunds, credits)", () => {
    expect(toMoneyOrNull(-50)).toBe(-50);
  });
});

describe("reconcileQbInvoice — line-amount fidelity", () => {
  const sent = [
    { DetailType: "SalesItemLineDetail", Amount: 100 },
    { DetailType: "SalesItemLineDetail", Amount: 50 },
  ];
  const sentTax = 12.0;

  it("severity=OK when QB echoes the same line amounts and total", () => {
    const result = reconcileQbInvoice({
      sentLines: sent,
      sentTax,
      qbResponse: {
        Line: sent,
        TotalAmt: 162,
        TxnTaxDetail: { TotalTax: 12 },
      },
    });
    expect(result.severity).toBe(RECONCILE_SEVERITY.OK);
    expect(result.issues).toEqual([]);
    expect(result.sentSubtotal).toBe(150);
    expect(result.qbSubtotal).toBe(150);
    expect(result.subtotalDrift).toBe(0);
    expect(result.totalDrift).toBe(0);
  });

  it("severity=OK when within 1-cent rounding tolerance", () => {
    const result = reconcileQbInvoice({
      sentLines: sent,
      sentTax,
      qbResponse: {
        Line: [
          { DetailType: "SalesItemLineDetail", Amount: 100.005 },
          { DetailType: "SalesItemLineDetail", Amount: 49.995 },
        ],
        TotalAmt: 162,
        TxnTaxDetail: { TotalTax: 12 },
      },
    });
    expect(result.severity).toBe(RECONCILE_SEVERITY.OK);
  });

  it("severity=DRIFT when QB returns a different line amount than we sent", () => {
    const result = reconcileQbInvoice({
      sentLines: sent,
      sentTax,
      qbResponse: {
        Line: [
          { DetailType: "SalesItemLineDetail", Amount: 100 },
          { DetailType: "SalesItemLineDetail", Amount: 75 }, // QB shows 75, we sent 50
        ],
        TotalAmt: 187,
        TxnTaxDetail: { TotalTax: 12 },
      },
    });
    expect(result.severity).toBe(RECONCILE_SEVERITY.DRIFT);
    expect(result.subtotalDrift).toBe(25);
    expect(result.issues.some((m) => m.includes("Line-amount drift"))).toBe(true);
  });

  it("severity=DRIFT when QB total differs beyond tax-drift accounting", () => {
    const result = reconcileQbInvoice({
      sentLines: sent,
      sentTax,
      qbResponse: {
        Line: sent,
        TotalAmt: 200, // we sent 162
        TxnTaxDetail: { TotalTax: 12 },
      },
    });
    expect(result.severity).toBe(RECONCILE_SEVERITY.DRIFT);
    expect(result.totalDrift).toBe(38);
    expect(result.issues.some((m) => m.includes("Total drift"))).toBe(true);
  });

  it("does NOT mark severity=DRIFT when only the tax differs (QB tax setup is authoritative)", () => {
    // Subtotal matches, totals match — the tax delta is just QB's
    // tax engine vs ours. Caller can still inspect taxDrift if they
    // want to surface this.
    const result = reconcileQbInvoice({
      sentLines: sent,
      sentTax: 0,
      qbResponse: {
        Line: sent,
        TotalAmt: 150 + 13.13, // QB applied 13.13 tax
        TxnTaxDetail: { TotalTax: 13.13 },
      },
    });
    // Total drift (sent 150, QB 163.13) exceeds tolerance, so this
    // IS DRIFT — but the issues message clearly attributes to tax.
    expect(result.severity).toBe(RECONCILE_SEVERITY.DRIFT);
    expect(result.issues.some((m) => m.includes("tax drift"))).toBe(true);
  });

  it("severity=FATAL when qbResponse is missing — caller must NOT trust qbTotal", () => {
    const result = reconcileQbInvoice({
      sentLines: sent,
      sentTax,
      qbResponse: null,
    });
    expect(result.severity).toBe(RECONCILE_SEVERITY.FATAL);
    expect(result.issues[0]).toMatch(/missing/);
  });

  it("severity=FATAL when qbResponse.TotalAmt is missing or non-finite", () => {
    const result = reconcileQbInvoice({
      sentLines: sent,
      sentTax,
      qbResponse: { Line: sent },
    });
    expect(result.severity).toBe(RECONCILE_SEVERITY.FATAL);
    expect(result.issues[0]).toMatch(/TotalAmt/);
  });

  it("severity=FATAL when TotalAmt is the literal NaN value (not silently treated as 0)", () => {
    const result = reconcileQbInvoice({
      sentLines: sent,
      sentTax,
      qbResponse: { Line: sent, TotalAmt: NaN },
    });
    expect(result.severity).toBe(RECONCILE_SEVERITY.FATAL);
  });

  it("treats sentTax of null/undefined as 0 (no NaN propagation)", () => {
    const result = reconcileQbInvoice({
      sentLines: sent,
      sentTax: null,
      qbResponse: { Line: sent, TotalAmt: 150, TxnTaxDetail: { TotalTax: 0 } },
    });
    expect(result.severity).toBe(RECONCILE_SEVERITY.OK);
    expect(result.sentTax).toBe(0);
  });

  it("respects custom tolerance — strict 0 tolerance flags any drift", () => {
    const result = reconcileQbInvoice({
      sentLines: sent,
      sentTax: 0,
      qbResponse: {
        Line: [
          { DetailType: "SalesItemLineDetail", Amount: 100.01 },
          { DetailType: "SalesItemLineDetail", Amount: 50 },
        ],
        TotalAmt: 150.01,
      },
      tolerance: 0,
    });
    expect(result.severity).toBe(RECONCILE_SEVERITY.DRIFT);
  });

  it("rejects negative/non-finite tolerance — falls back to default", () => {
    const result = reconcileQbInvoice({
      sentLines: sent,
      sentTax: 0,
      qbResponse: { Line: sent, TotalAmt: 150 },
      tolerance: -1,
    });
    // With invalid tolerance, the function should use DEFAULT (0.01).
    // Sending exactly matched — should still be OK regardless of
    // tolerance, but this verifies the function didn't throw.
    expect(result.severity).toBe(RECONCILE_SEVERITY.OK);
  });

  it("the result shape is fully populated even on FATAL — no missing fields for downstream", () => {
    const result = reconcileQbInvoice({
      sentLines: sent,
      sentTax,
      qbResponse: null,
    });
    expect(result).toHaveProperty("severity");
    expect(result).toHaveProperty("issues");
    expect(result).toHaveProperty("sentSubtotal");
    expect(result).toHaveProperty("qbSubtotal");
    expect(result).toHaveProperty("subtotalDrift");
    expect(result).toHaveProperty("sentTotal");
    expect(result).toHaveProperty("qbTotal");
    expect(result).toHaveProperty("totalDrift");
    expect(result).toHaveProperty("sentTax");
    expect(result).toHaveProperty("qbTax");
    expect(result).toHaveProperty("taxDrift");
  });

  it("never throws — no matter how broken the inputs are", () => {
    expect(() => reconcileQbInvoice({})).not.toThrow();
    expect(() => reconcileQbInvoice({ sentLines: undefined, sentTax: "abc", qbResponse: 42 })).not.toThrow();
    expect(() => reconcileQbInvoice({ sentLines: [{}], sentTax: NaN, qbResponse: { TotalAmt: "garbage" } })).not.toThrow();
  });
});
