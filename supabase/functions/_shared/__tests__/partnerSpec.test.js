import { describe, it, expect } from "vitest";
import {
  buildPartnerSpec,
  buildReceiverOrderInsert,
  specLeaks,
  mirrorStatusFor,
  partnerCustomerLabel,
  LINE_KEEP,
  IMPRINT_KEEP,
} from "../partnerSpec.js";

// Fixture uses the REAL production imprint/line shape (LineItemEditor,
// wizardLineItem, QuoteEditorModal stamps) — NOT the phantom `artworkPath`
// key the first version of these tests invented. artwork_url/_id/_name,
// mockup_url, extras, and the broker dual-layer price stamps all appear.
const order = {
  order_id: "ORD-1",
  shop_owner: "joe@biotamfg.co",
  customer_name: "Tahoe Gift Co.",
  customer_email: "buyer@tahoegift.com",
  job_title: "50 caps for Tahoe Gift Co.", // system-populated summaries name the customer
  due_date: "2026-08-28",
  total: 700, subtotal: 650, tax: 50, tax_rate: 8.265,
  notes: "internal: customer is picky, margin thin",
  line_items: [
    {
      id: "li1", brand: "Richardson", style: "112", garmentColor: "Navy",
      description: "Richardson 112 Trucker",
      sizes: { OS: 50 }, garmentCost: 4.1, garmentCostManual: true,
      _ppp: 14, _lineTotal: 700, clientPpp: 15,
      _client_ppp: 16, _client_lineTotal: 800, _rushFee: 12, markup: 1.4,
      imprints: [{
        id: "imp1", location: "Front", technique: "Embroidery", colors: 2,
        pantones: "PMS 186C, White", width: 3.5, height: 2,
        details: "8k stitches", print_order: 1,
        artwork_id: "aw-9", artwork_name: "tahoe-gift-co-logo.png",
        artwork_url: "https://x.supabase.co/storage/v1/object/public/artwork/1738-abc.png",
        artwork_note: "match thread to Tahoe Gift Co. brand teal",
        mockup_url: "https://x.supabase.co/storage/v1/object/public/artwork/mock-tahoe.png",
        extras: [{ label: "puff", price: 0.5 }],
        _addon_labels: ["priced thing"],
      }],
    },
    {
      id: "li2", brand: "Comfort Colors", style: "1717", sizes: { M: 100 },
      _ppp: 9, imprints: [{ id: "imp2", location: "Back", technique: "Screen Print", colors: 1 }],
    },
  ],
};

describe("buildPartnerSpec — the blind-mode trust boundary", () => {
  it("carries everything needed to PRODUCE: garments, sizes, imprint detail, art ref, due date", () => {
    const spec = buildPartnerSpec(order, { lineIds: ["li1"], blind: true });
    expect(spec.lines).toHaveLength(1);
    const [l] = spec.lines;
    expect(l.style).toBe("112");
    expect(l.sizes).toEqual({ OS: 50 });
    expect(l.imprints[0].pantones).toBe("PMS 186C, White");
    expect(l.imprints[0].details).toBe("8k stitches");
    // The sender's art ref crosses so the edge fn can copy it on accept.
    expect(l.imprints[0].artwork_url).toContain("/artwork/1738-abc.png");
    expect(spec.due_date).toBe("2026-08-28");
  });

  it("NEVER carries sender pricing, costs, or internal stamps", () => {
    const spec = buildPartnerSpec(order, { blind: true });
    const flat = JSON.stringify(spec);
    for (const banned of [
      "garmentCost", "_ppp", "_lineTotal", "clientPpp",
      "_client_ppp", "_client_lineTotal", "_rushFee", "markup",
      '"total"', '"tax_rate"',
    ]) {
      expect(flat).not.toContain(banned);
    }
    expect(specLeaks(spec)).toEqual([]);
  });

  it("strips artwork_name / artwork_note / mockup_url / extras — the imprint leak channels", () => {
    // These would have shipped a customer filename ("tahoe-gift-co-logo.png")
    // and a note naming the customer straight to the partner. Regression guard
    // for the production-key-shape gap.
    const spec = buildPartnerSpec(order, { lineIds: ["li1"], blind: true });
    const flat = JSON.stringify(spec);
    expect(flat).not.toContain("tahoe-gift-co-logo.png");
    expect(flat).not.toContain("artwork_note");
    expect(flat).not.toContain("mockup_url");
    expect(flat).not.toContain("mock-tahoe.png");
    expect(flat).not.toContain("artwork_id");
    expect(flat).not.toContain("extras");
    expect(flat).not.toContain("Tahoe"); // the note's customer name is gone too
  });

  it("every emitted line/imprint key is in the allowlist (no ...spread regression)", () => {
    const spec = buildPartnerSpec(order, { blind: true });
    for (const l of spec.lines) {
      for (const k of Object.keys(l)) {
        expect(LINE_KEEP.includes(k) || k === "imprints").toBe(true);
      }
      for (const imp of l.imprints) {
        for (const k of Object.keys(imp)) {
          expect(IMPRINT_KEEP.includes(k)).toBe(true);
        }
      }
    }
  });

  it("blind: sender's customer identity, internal notes, and job_title never cross", () => {
    const spec = buildPartnerSpec(order, { blind: true, note: "run these hot" });
    const flat = JSON.stringify(spec);
    expect(spec.customer).toBeNull();
    expect(spec.job_title).toBe(""); // job_title can name the customer → stripped under blind
    expect(flat).not.toContain("Tahoe");
    expect(flat).not.toContain("buyer@tahoegift.com");
    expect(flat).not.toContain("margin thin"); // order.notes never crosses; only the typed hand-off note
    expect(spec.note).toBe("run these hot");
  });

  it("non-blind shares the customer display NAME + job_title — never email", () => {
    const spec = buildPartnerSpec(order, { blind: false });
    expect(spec.customer).toEqual({ name: "Tahoe Gift Co." });
    expect(spec.job_title).toBe("50 caps for Tahoe Gift Co.");
    expect(JSON.stringify(spec)).not.toContain("buyer@tahoegift.com");
  });

  it("lineIds=null takes all lines; unknown ids take none", () => {
    expect(buildPartnerSpec(order, {}).lines).toHaveLength(2);
    expect(buildPartnerSpec(order, { lineIds: ["nope"] }).lines).toHaveLength(0);
  });
});

describe("specLeaks — recursion + documented boundary", () => {
  it("flags a stripped-class key at ANY depth", () => {
    expect(specLeaks({ a: { b: [{ unitPrice: 3 }] } })).toEqual(["spec.a.b[0].unitPrice"]);
    expect(specLeaks({ sizes: { S: { markup: 2 } } })).toEqual(["spec.sizes.S.markup"]);
  });

  it("does NOT catch a value-only leak under a clean key (allowlist is the real guard)", () => {
    // Explicit canary: specLeaks checks key NAMES only. A customer name in a
    // free-text value passes here — which is WHY buildPartnerSpec is
    // allowlist-driven, not deny-driven. Keep this boundary visible.
    expect(specLeaks({ details: "for ACME, $14/pc" })).toEqual([]);
  });
});

describe("buildReceiverOrderInsert", () => {
  const handoff = {
    id: "h1", sending_shop: "joe@biotamfg.co", sending_shop_name: "Biota MFG",
    receiving_shop: "stullpeter5@gmail.com",
    due_date: "2026-08-28",
    agreed_trade_total: 450,
    spec: buildPartnerSpec(order, { lineIds: ["li1"], blind: true, note: "left chest" }),
  };

  it("the sending SHOP is the receiver's customer; trade total is the order total", () => {
    const ins = buildReceiverOrderInsert(handoff, "ORD-P1", "2026-08-14");
    expect(ins.customer_name).toBe("Biota MFG");
    expect(ins.shop_owner).toBe("stullpeter5@gmail.com");
    expect(ins.total).toBe(450);
    expect(ins.subtotal).toBe(450);
    expect(ins.tax_rate).toBe(0);
    expect(ins.partner_handoff_id).toBe("h1");
    expect(ins.line_items).toHaveLength(1);
    expect(ins.due_date).toBe("2026-08-28");
    expect(ins.paid).toBe(false);
  });

  it("due date comes from the offer; counter_due_date is ignored (no counter flow in v1)", () => {
    const ins = buildReceiverOrderInsert({ ...handoff, counter_due_date: "2026-09-02" }, "ORD-P1", "2026-08-14");
    expect(ins.due_date).toBe("2026-08-28");
  });

  it("no trade total agreed → totals stay null (never fabricate money)", () => {
    const ins = buildReceiverOrderInsert({ ...handoff, agreed_trade_total: null }, "ORD-P1", "2026-08-14");
    expect(ins.total).toBeNull();
    expect(ins.subtotal).toBeNull();
  });

  it("blind receiver order carries no customer identity from the sender", () => {
    const ins = buildReceiverOrderInsert(handoff, "ORD-P1", "2026-08-14");
    const flat = JSON.stringify(ins);
    expect(flat).not.toContain("Tahoe");
    expect(flat).not.toContain("buyer@tahoegift.com");
    expect(flat).not.toContain("tahoe-gift-co-logo.png");
  });
});

describe("status mirroring + labels", () => {
  it("maps the receiver's pipeline onto sender-facing chips", () => {
    expect(mirrorStatusFor("Art Approval")).toBe("accepted");
    expect(mirrorStatusFor("Printing")).toBe("in_production");
    expect(mirrorStatusFor("Completed")).toBe("completed");
    expect(mirrorStatusFor("Something Custom")).toBe("in_production");
  });
  it("a cancelled receiver order mirrors as cancelled — never silently 'in production'", () => {
    expect(mirrorStatusFor("Cancelled")).toBe("cancelled");
    expect(mirrorStatusFor("Canceled")).toBe("cancelled");
    expect(mirrorStatusFor("Voided")).toBe("cancelled");
  });
  it("partnerCustomerLabel prefers the display name", () => {
    expect(partnerCustomerLabel({ sending_shop_name: "Biota MFG", sending_shop: "joe@x.co" })).toBe("Biota MFG");
    expect(partnerCustomerLabel({ sending_shop: "joe@x.co" })).toBe("joe@x.co");
  });
});
