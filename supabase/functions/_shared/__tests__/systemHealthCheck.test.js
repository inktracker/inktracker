import { describe, it, expect } from "vitest";
import {
  summarizeHealth,
  buildHealthSubject,
  buildHealthText,
  buildHealthHtml,
  OK,
  DOWN,
} from "../systemHealthCheck.js";

const okProbe = (name, tier = "critical") => ({ name, tier, ok: true, status: OK, detail: "ok", latencyMs: 42 });
const downProbe = (name, tier = "critical") => ({ name, tier, ok: false, status: DOWN, detail: "no response", latencyMs: null });

describe("summarizeHealth", () => {
  it("all green → overall ok, zero critical/warnings", () => {
    const s = summarizeHealth([okProbe("Site"), okProbe("S&S", "secondary")]);
    expect(s.overall).toBe("ok");
    expect(s.critical).toHaveLength(0);
    expect(s.warnings).toHaveLength(0);
    expect(s.okCount).toBe(2);
    expect(s.total).toBe(2);
  });

  it("a failed CRITICAL probe → overall down", () => {
    const s = summarizeHealth([downProbe("QuickBooks"), okProbe("Site")]);
    expect(s.overall).toBe(DOWN);
    expect(s.critical.map((p) => p.name)).toEqual(["QuickBooks"]);
    expect(s.warnings).toHaveLength(0);
  });

  it("a failed SECONDARY probe → overall degraded, not down", () => {
    const s = summarizeHealth([okProbe("Site"), downProbe("SanMar", "secondary")]);
    expect(s.overall).toBe("degraded");
    expect(s.critical).toHaveLength(0);
    expect(s.warnings.map((p) => p.name)).toEqual(["SanMar"]);
  });

  it("critical failure outranks secondary failure → down", () => {
    const s = summarizeHealth([downProbe("Stripe"), downProbe("AS Colour", "secondary")]);
    expect(s.overall).toBe(DOWN);
  });

  it("carries auto-fixes and flags failed ones", () => {
    const s = summarizeHealth(
      [okProbe("Site")],
      [
        { action: "re-fire qb-reconcile", result: "200", ok: true },
        { action: "refresh QB token", result: "refresh failed", ok: false },
      ],
    );
    expect(s.autofixes).toHaveLength(2);
    expect(s.autofixFailed).toHaveLength(1);
    expect(s.autofixFailed[0].action).toBe("refresh QB token");
  });

  it("tolerates junk input", () => {
    const s = summarizeHealth(null, null);
    expect(s.overall).toBe("ok");
    expect(s.total).toBe(0);
  });
});

describe("buildHealthSubject", () => {
  it("green subject reads all clear", () => {
    const s = summarizeHealth([okProbe("Site")]);
    expect(buildHealthSubject(s, "2026-09-03")).toBe("✅ InkTracker health: all clear (2026-09-03)");
  });
  it("down subject names the failing critical systems", () => {
    const s = summarizeHealth([downProbe("QuickBooks"), downProbe("Resend")]);
    const subj = buildHealthSubject(s, "2026-09-03");
    expect(subj).toContain("DOWN");
    expect(subj).toContain("QuickBooks");
    expect(subj).toContain("Resend");
  });
  it("degraded subject names the secondary systems", () => {
    const s = summarizeHealth([downProbe("S&S", "secondary")]);
    expect(buildHealthSubject(s, "2026-09-03")).toContain("degraded");
  });
});

describe("buildHealthText / Html", () => {
  it("text lists every check and surfaces the critical section", () => {
    const probes = [downProbe("QuickBooks"), okProbe("Site"), downProbe("SanMar", "secondary")];
    const s = summarizeHealth(probes);
    const txt = buildHealthText(s, probes, "2026-09-03");
    expect(txt).toContain("NEEDS YOU NOW");
    expect(txt).toContain("QuickBooks");
    expect(txt).toContain("WORTH A LOOK");
    expect(txt).toContain("SanMar");
    expect(txt).toContain("All 3 checks");
  });
  it("html escapes probe detail", () => {
    const probes = [{ name: "X", tier: "critical", ok: false, status: DOWN, detail: "<script>", latencyMs: null }];
    const s = summarizeHealth(probes);
    const html = buildHealthHtml(s, probes, "2026-09-03");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
  it("green text says all clear and still renders", () => {
    const probes = [okProbe("Site"), okProbe("Stripe")];
    const s = summarizeHealth(probes);
    expect(buildHealthText(s, probes, "2026-09-03")).toContain("ALL CLEAR");
  });
});
