import { describe, it, expect } from "vitest";
import {
  buildPartnerSpec,
  buildReceiverOrderInsert,
  specLeaks,
  mirrorStatusFor,
  partnerCustomerLabel,
} from "../partnerSpec.js";

const order = {
  order_id: "ORD-1",
  shop_owner: "joe@biotamfg.co",
  customer_name: "Tahoe Gift Co.",
  customer_email: "buyer@tahoegift.com",
  job_title: "Event caps",
  due_date: "2026-08-28",
  total: 700, subtotal: 650, tax: 50, tax_rate: 8.265,
  notes: "internal: customer is picky, margin thin",
  line_items: [
    {
      id: "li1", brand: "Richardson", style: "112", garmentColor: "Navy",
      sizes: { OS: 50 }, garmentCost: 4.1, garmentCostManual: true,
      _ppp: 14, _lineTotal: 700, clientPpp: 15,
      imprints: [{
        id: "imp1", location: "Front", technique: "Embroidery", colors: 2,
        pantones: "PMS 186C, White", width: 3.5, height: 2,
        details: "8k stitches", artworkPath: "art/logo.png",
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
  it("carries everything needed to PRODUCE: garments, sizes, imprint detail, art refs, due date", () => {
    const spec = buildPartnerSpec(order, { lineIds: ["li1"], blind: true });
    expect(spec.lines).toHaveLength(1);
    const [l] = spec.lines;
    expect(l.style).toBe("112");
    expect(l.sizes).toEqual({ OS: 50 });
    expect(l.imprints[0].pantones).toBe("PMS 186C, White");
    expect(l.imprints[0].details).toBe("8k stitches");
    expect(l.imprints[0].artworkPath).toBe("art/logo.png");
    expect(spec.due_date).toBe("2026-08-28");
  });

  it("NEVER carries sender pricing, costs, or internal stamps", () => {
    const spec = buildPartnerSpec(order, { blind: true });
    const flat = JSON.stringify(spec);
    for (const banned of ["garmentCost", "_ppp", "_lineTotal", "clientPpp", '"total"', '"tax_rate"']) {
      expect(flat).not.toContain(banned);
    }
    expect(specLeaks(spec)).toEqual([]);
  });

  it("blind: sender's customer identity and internal notes never cross", () => {
    const spec = buildPartnerSpec(order, { blind: true, note: "run these hot" });
    const flat = JSON.stringify(spec);
    expect(spec.customer).toBeNull();
    expect(flat).not.toContain("Tahoe");
    expect(flat).not.toContain("buyer@tahoegift.com");
    expect(flat).not.toContain("margin thin"); // order.notes never crosses; only the typed hand-off note
    expect(spec.note).toBe("run these hot");
  });

  it("non-blind shares the customer display NAME only — never email", () => {
    const spec = buildPartnerSpec(order, { blind: false });
    expect(spec.customer).toEqual({ name: "Tahoe Gift Co." });
    expect(JSON.stringify(spec)).not.toContain("buyer@tahoegift.com");
  });

  it("lineIds=null takes all lines; unknown ids take none", () => {
    expect(buildPartnerSpec(order, {}).lines).toHaveLength(2);
    expect(buildPartnerSpec(order, { lineIds: ["nope"] }).lines).toHaveLength(0);
  });
});

describe("buildReceiverOrderInsert", () => {
  const handoff = {
    id: "h1", sending_shop: "joe@biotamfg.co", sending_shop_name: "Biota MFG",
    receiving_shop: "stullpeter5@gmail.com",
    due_date: "2026-08-28", counter_due_date: null,
    agreed_trade_total: 450,
    spec: buildPartnerSpec(order, { lineIds: ["li1"], blind: true, note: "left chest" }),
  };

  it("the sending SHOP is the receiver's customer; trade total is the order total", () => {
    const ins = buildReceiverOrderInsert(handoff, "ORD-P1", "2026-08-14");
    expect(ins.customer_name).toBe("Biota MFG");
    expect(ins.shop_owner).toBe("stullpeter5@gmail.com");
    expect(ins.total).toBe(450);
    expect(ins.tax_rate).toBe(0);
    expect(ins.partner_handoff_id).toBe("h1");
    expect(ins.line_items).toHaveLength(1);
    expect(ins.due_date).toBe("2026-08-28");
    expect(ins.paid).toBe(false);
  });

  it("counter date wins when present", () => {
    const ins = buildReceiverOrderInsert({ ...handoff, counter_due_date: "2026-09-02" }, "ORD-P1", "2026-08-14");
    expect(ins.due_date).toBe("2026-09-02");
  });

  it("no trade total agreed → totals stay null (never fabricate money)", () => {
    const ins = buildReceiverOrderInsert({ ...handoff, agreed_trade_total: null }, "ORD-P1", "2026-08-14");
    expect(ins.total).toBeNull();
    expect(ins.subtotal).toBeNull();
  });
});

describe("status mirroring + labels", () => {
  it("maps the receiver's pipeline onto sender-facing chips", () => {
    expect(mirrorStatusFor("Art Approval")).toBe("accepted");
    expect(mirrorStatusFor("Printing")).toBe("in_production");
    expect(mirrorStatusFor("Completed")).toBe("completed");
    expect(mirrorStatusFor("Something Custom")).toBe("in_production");
  });
  it("partnerCustomerLabel prefers the display name", () => {
    expect(partnerCustomerLabel({ sending_shop_name: "Biota MFG", sending_shop: "joe@x.co" })).toBe("Biota MFG");
    expect(partnerCustomerLabel({ sending_shop: "joe@x.co" })).toBe("joe@x.co");
  });
});
