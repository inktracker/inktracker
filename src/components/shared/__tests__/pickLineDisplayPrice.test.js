import { describe, it, expect } from "vitest";
import { pickLineDisplayPrice } from "../pdfExport";

// Real line from quote Q-2026-29YR7 (broker test, 2026-10-01): the client PDF
// showed the line at WHOLESALE ($13.95/ea → $139.50) while Subtotal/Total used
// the CLIENT price ($17.51/ea → $175.10) — they didn't reconcile and the
// client saw the broker's cost. Root cause: the renderer's client-price branch
// (isBroker && isClientMode) was unreachable because the caller passed
// isBroker=false in client mode. These lock the mode→price mapping.
const line = {
  _ppp: 13.95, _lineTotal: 139.5,          // broker-side (wholesale)
  _client_ppp: 17.51, _client_lineTotal: 175.1, // client-side
};

describe("pickLineDisplayPrice — PDF per-line price by render mode", () => {
  it("broker CLIENT form shows the CLIENT price (the regressed case)", () => {
    expect(pickLineDisplayPrice(line, { isBroker: true, isClientMode: true, qty: 10 }))
      .toEqual({ ppp: 17.51, lineTotal: 175.1 });
  });

  it("broker SHOP form shows the WHOLESALE price", () => {
    expect(pickLineDisplayPrice(line, { isBroker: true, isClientMode: false, qty: 10 }))
      .toEqual({ ppp: 13.95, lineTotal: 139.5 });
  });

  it("non-broker quote shows its standard _ppp", () => {
    expect(pickLineDisplayPrice(line, { isBroker: false, isClientMode: false, qty: 10 }))
      .toEqual({ ppp: 13.95, lineTotal: 139.5 });
  });

  it("client form without a client stamp falls back to clientPpp override, then live calc", () => {
    expect(pickLineDisplayPrice({ clientPpp: 20 }, { isBroker: true, isClientMode: true, qty: 5 }))
      .toEqual({ ppp: 20, lineTotal: 100 });
    expect(pickLineDisplayPrice({}, { isBroker: true, isClientMode: true, qty: 5, fallbackPpp: 18 }))
      .toEqual({ ppp: 18, lineTotal: 90 });
  });

  it("derives lineTotal from ppp*qty when the lineTotal stamp is absent", () => {
    // Raw product (fmtMoney rounds for the actual render), so compare closely.
    const a = pickLineDisplayPrice({ _client_ppp: 17.51 }, { isBroker: true, isClientMode: true, qty: 10 });
    expect(a.ppp).toBe(17.51);
    expect(a.lineTotal).toBeCloseTo(175.1, 5);
    const b = pickLineDisplayPrice({ _ppp: 13.95 }, { isBroker: true, isClientMode: false, qty: 10 });
    expect(b.ppp).toBe(13.95);
    expect(b.lineTotal).toBeCloseTo(139.5, 5);
  });

  it("never throws on empty/junk line input", () => {
    expect(() => pickLineDisplayPrice(null, {})).not.toThrow();
    expect(pickLineDisplayPrice(null, { qty: 3, fallbackPpp: 4 })).toEqual({ ppp: 4, lineTotal: 12 });
  });
});
