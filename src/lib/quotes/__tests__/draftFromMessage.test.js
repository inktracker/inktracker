// Client-side mapping of an AI quote draft onto editor state.
//
// Two fixture scenarios, mirroring the two product cases:
//  - REORDER: known customer, concrete styles from history (the Orea case)
//  - COLD:    new customer, vague garment → catalog candidates
//
// Contract pinned here: the mapper sets NO prices (engine does that via
// the editor's own autoLookup), panel data never lands on the quote
// object (it would persist into the saved row), and an unknown garment
// is NOT silently defaulted to the top candidate.

import { describe, it, expect } from "vitest";
import { applyDraftToQuote, applyCandidateToLine } from "../draftFromMessage";

let uid = 0;
const newLineItem = () => ({
  id: `li-${++uid}`, style: "", brand: "", category: "", garmentCost: "",
  garmentColor: "", sizes: {}, imprints: [],
});

const blankQuote = () => ({
  customer_id: null, customer_name: "", customer_email: "", job_title: "",
  notes: "", line_items: [newLineItem()],
});

const REORDER_RESP = {
  ok: true,
  customer: { id: "cust-1", name: "Dayana Avendano", company: "Orea Roofing", email: "camilag218@yahoo.com" },
  extraction: { customer_name: "Dayana", company: "Orea Roofing", customer_email: "camilag218@yahoo.com" },
  draft: {
    job_title: "Crew Gear Reorder",
    due_date: "2026-09-10",
    line_items: [{
      style_number: "TT41", brand: "Team 365", style_name: "Zone Hooded T",
      garment_color: "Sport Silver", sizes: { M: 15, L: 15, XL: 10 }, total_qty: 0,
      catalog_search: "",
      imprints: [
        { location: "Left Chest", title: "Orea Roofing", colors: 1, ink: "Black Ink", width_in: "4.5" },
        { location: "Back", title: "Orea Roofing (No License)", colors: 1, ink: "Black Ink", width_in: "12" },
      ],
    }],
    assumptions: ["Dry-Fit = TT41 from ORD-2026-JWN39"],
    blanks: [],
    customer_note_suggestion: "Back print updated to remove the license number.",
  },
};

const COLD_RESP = {
  ok: true,
  customer: null,
  extraction: { customer_name: "Sam", company: "Riverbend Coffee", customer_email: "sam@riverbend.example" },
  draft: {
    job_title: "Riverbend Hoodies",
    due_date: "",
    line_items: [{
      style_number: "", brand: "", style_name: "", garment_color: "",
      sizes: { S: 5, M: 13, L: 16, XL: 10, "2XL": 6 }, total_qty: 50,
      catalog_search: "pullover hoodie",
      imprints: [{ location: "Front", title: "Riverbend logo", colors: 1, ink: "", width_in: "" }],
      candidates: [
        { style_number: "18500", brand: "Gildan", style_name: "Heavy Blend Hoodie", from_price: 8.9, example_color: "Black", colors_available: 30 },
        { style_number: "SS4500", brand: "Independent", style_name: "Midweight Hoodie", from_price: 13.2, example_color: "Black", colors_available: 12 },
      ],
    }],
    assumptions: ["Spread 50 pcs across a standard adult size curve"],
    blanks: ["How many ink colors is the Riverbend logo?", "Which hoodie? (2 catalog options attached)"],
    customer_note_suggestion: "",
  },
};

describe("reorder mapping", () => {
  it("fills lines, customer, imprints — and never a price", () => {
    const { quote, panel } = applyDraftToQuote(blankQuote(), REORDER_RESP, newLineItem);
    expect(quote.line_items).toHaveLength(1); // replaced the blank line
    const li = quote.line_items[0];
    expect(li.style).toBe("TT41");
    expect(li.sizes).toEqual({ M: 15, L: 15, XL: 10 });
    expect(li.imprints).toHaveLength(2);
    expect(li.imprints[1].title).toBe("Orea Roofing (No License)");
    // pricing contract: no cost fields asserted by the mapper
    expect(li.garmentCost).toBe("");
    expect(li._ppp).toBeUndefined();
    // matched customer wins
    expect(quote.customer_id).toBe("cust-1");
    expect(quote.customer_email).toBe("camilag218@yahoo.com");
    expect(quote.due_date).toBe("2026-09-10");
    expect(panel.assumptions).toHaveLength(1);
  });

  it("notes get ONLY the customer-facing suggestion — never assumptions (notes hit QB CustomerMemo)", () => {
    const { quote } = applyDraftToQuote(blankQuote(), REORDER_RESP, newLineItem);
    expect(quote.notes).toContain("license number");
    expect(quote.notes).not.toContain("TT41"); // internal reasoning stays in the panel
  });

  it("appends instead of replacing when the editor already has real lines", () => {
    const prev = blankQuote();
    prev.line_items = [{ ...newLineItem(), style: "5000", brand: "Gildan", sizes: { M: 10 } }];
    const { quote } = applyDraftToQuote(prev, REORDER_RESP, newLineItem);
    expect(quote.line_items).toHaveLength(2);
    expect(quote.line_items[0].style).toBe("5000");
  });

  it("panel state is NOT on the quote object", () => {
    const { quote } = applyDraftToQuote(blankQuote(), REORDER_RESP, newLineItem);
    const json = JSON.stringify(quote);
    expect(json).not.toContain("assumptions");
    expect(json).not.toContain("candidates");
  });
});

describe("cold-request mapping", () => {
  it("leaves the garment UNPICKED and exposes candidates for the shop to choose", () => {
    const { quote, panel } = applyDraftToQuote(blankQuote(), COLD_RESP, newLineItem);
    const li = quote.line_items[0];
    expect(li.style).toBe(""); // no silent default — the shop decides
    const cands = Object.values(panel.candidatesByLine)[0];
    expect(cands).toHaveLength(2);
    expect(panel.blanks.length).toBeGreaterThan(0);
  });

  it("keys candidates by the actual new line id so the picker can find its line", () => {
    const { quote, panel } = applyDraftToQuote(blankQuote(), COLD_RESP, newLineItem);
    const [lineId] = Object.keys(panel.candidatesByLine);
    expect(quote.line_items.some((l) => String(l.id) === lineId)).toBe(true);
  });

  it("unmatched customer seeds name/email from extraction for the new-client flow", () => {
    const { quote } = applyDraftToQuote(blankQuote(), COLD_RESP, newLineItem);
    expect(quote.customer_id).toBeNull();
    expect(quote.customer_name).toBe("Sam");
    expect(quote.customer_email).toBe("sam@riverbend.example");
  });

  it("applyCandidateToLine sets identity only — autoLookup does the rest", () => {
    const line = { ...newLineItem(), sizes: { M: 10 } };
    const next = applyCandidateToLine(line, COLD_RESP.draft.line_items[0].candidates[0]);
    expect(next.style).toBe("18500");
    expect(next.brand).toBe("Gildan");
    expect(next.sizes).toEqual({ M: 10 }); // untouched
    expect(next.garmentCost).toBe("");     // engine fills this, not us
  });
});

describe("failure modes", () => {
  it("throws on an empty draft instead of quietly wiping the editor", () => {
    expect(() => applyDraftToQuote(blankQuote(), { draft: { line_items: [] } }, newLineItem)).toThrow();
    expect(() => applyDraftToQuote(blankQuote(), {}, newLineItem)).toThrow();
  });
});
