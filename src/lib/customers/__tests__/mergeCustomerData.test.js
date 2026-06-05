// Customer-merge contract tests. The "beloved's" merge dropped a whole
// customer record once before — the user's feedback explicitly said
// nothing should ever silently disappear. Every assertion below pins
// one rule of the additive-merge contract.

import { describe, it, expect } from "vitest";
import { buildAdditiveMergePatch, describeMergeFor } from "../mergeCustomerData";

describe("buildAdditiveMergePatch — empty-fill simple fields", () => {
  it("fills email from dup when primary's is blank", () => {
    const patch = buildAdditiveMergePatch(
      { name: "Tyler Colton", email: "" },
      { name: "The Selden", email: "selden@example.com" },
    );
    expect(patch).toEqual({ email: "selden@example.com" });
  });

  it("does NOT overwrite an existing primary value", () => {
    const patch = buildAdditiveMergePatch(
      { name: "P", email: "primary@example.com" },
      { name: "D", email: "dup@example.com" },
    );
    expect(patch).toBeNull();
  });

  it("treats whitespace-only strings on primary as blank", () => {
    const patch = buildAdditiveMergePatch(
      { phone: "   " },
      { phone: "555-0100" },
    );
    expect(patch).toEqual({ phone: "555-0100" });
  });

  it("ignores blank dup fields (nothing to contribute)", () => {
    const patch = buildAdditiveMergePatch(
      { email: "" },
      { email: "   " },
    );
    expect(patch).toBeNull();
  });

  it("fills qb_customer_id when primary lacks one", () => {
    const patch = buildAdditiveMergePatch(
      { qb_customer_id: null },
      { qb_customer_id: "QB-42" },
    );
    expect(patch).toEqual({ qb_customer_id: "QB-42" });
  });

  it("does not move qb_customer_id when primary already has one (avoids QB-cross-link)", () => {
    const patch = buildAdditiveMergePatch(
      { qb_customer_id: "QB-1" },
      { qb_customer_id: "QB-2" },
    );
    expect(patch).toBeNull();
  });
});

describe("buildAdditiveMergePatch — boolean tax_exempt", () => {
  it("carries dup's tax_exempt when primary is unset", () => {
    expect(buildAdditiveMergePatch({}, { tax_exempt: true })).toEqual({ tax_exempt: true });
    expect(buildAdditiveMergePatch({}, { tax_exempt: false })).toEqual({ tax_exempt: false });
  });

  it("preserves an explicit primary false (does NOT flip to true from dup)", () => {
    const patch = buildAdditiveMergePatch(
      { tax_exempt: false },
      { tax_exempt: true },
    );
    expect(patch).toBeNull();
  });

  it("ignores undefined dup values", () => {
    expect(buildAdditiveMergePatch({}, {})).toBeNull();
  });
});

describe("buildAdditiveMergePatch — default_deposit_pct (numeric, 0 is valid)", () => {
  it("carries dup's value when primary is null", () => {
    expect(buildAdditiveMergePatch({}, { default_deposit_pct: 0.25 }))
      .toEqual({ default_deposit_pct: 0.25 });
  });

  it("preserves primary's explicit 0 (means 'no deposit', not 'unset')", () => {
    expect(buildAdditiveMergePatch(
      { default_deposit_pct: 0 },
      { default_deposit_pct: 0.5 },
    )).toBeNull();
  });

  it("ignores NaN dup values", () => {
    expect(buildAdditiveMergePatch({}, { default_deposit_pct: NaN })).toBeNull();
  });
});

describe("buildAdditiveMergePatch — notes (append, never overwrite)", () => {
  it("carries dup notes verbatim when primary has none", () => {
    expect(buildAdditiveMergePatch({}, { notes: "Likes red.", name: "D" }))
      .toEqual({ notes: "Likes red." });
  });

  it("appends dup notes to primary's existing notes with an attribution tag", () => {
    const patch = buildAdditiveMergePatch(
      { notes: "Net 30." },
      { notes: "Likes red.", name: "Selden" },
    );
    expect(patch.notes).toContain("Net 30.");
    expect(patch.notes).toContain("Likes red.");
    expect(patch.notes).toContain("Selden");
  });

  it("is idempotent — re-merging the same dup doesn't double-append", () => {
    const first = buildAdditiveMergePatch(
      { notes: "Net 30." },
      { notes: "Likes red.", name: "S" },
    );
    const second = buildAdditiveMergePatch(
      { notes: first.notes },
      { notes: "Likes red.", name: "S" },
    );
    expect(second).toBeNull();
  });

  it("ignores blank dup notes", () => {
    expect(buildAdditiveMergePatch({ notes: "x" }, { notes: "   " })).toBeNull();
  });
});

describe("buildAdditiveMergePatch — saved_imprints (union, dedupe by id)", () => {
  it("copies dup's imprints when primary has none", () => {
    const dupImprints = [{ id: "imp-1", title: "Front 3c" }];
    expect(buildAdditiveMergePatch({}, { saved_imprints: dupImprints }))
      .toEqual({ saved_imprints: dupImprints });
  });

  it("unions imprints from both when both have some", () => {
    const patch = buildAdditiveMergePatch(
      { saved_imprints: [{ id: "imp-1", title: "Front" }] },
      { saved_imprints: [{ id: "imp-2", title: "Back" }] },
    );
    expect(patch.saved_imprints).toEqual([
      { id: "imp-1", title: "Front" },
      { id: "imp-2", title: "Back" },
    ]);
  });

  it("dedupes by id — doesn't double a shared imprint", () => {
    const patch = buildAdditiveMergePatch(
      { saved_imprints: [{ id: "imp-1", title: "Front" }] },
      { saved_imprints: [{ id: "imp-1", title: "Front (old name)" }, { id: "imp-2" }] },
    );
    expect(patch.saved_imprints).toHaveLength(2);
    expect(patch.saved_imprints.find(i => i.id === "imp-1").title).toBe("Front"); // primary's wins
  });

  it("returns no-op when dup adds nothing new", () => {
    expect(buildAdditiveMergePatch(
      { saved_imprints: [{ id: "imp-1" }] },
      { saved_imprints: [{ id: "imp-1" }] },
    )).toBeNull();
  });
});

describe("buildAdditiveMergePatch — full record (smoke)", () => {
  it("composes every applicable rule in one shot", () => {
    const primary = {
      name: "Tyler Colton",
      email: "tyler@theemersonreno.com",
      phone: "",
      company: "The Emerson",
      notes: "Net 30.",
      qb_customer_id: "QB-1",
    };
    const dup = {
      name: "The Selden",
      email: "selden@example.com",
      phone: "555-9999",
      company: "The Selden",
      notes: "Always overnights.",
      tax_id: "TX-EXEMPT-001",
      tax_exempt: true,
      saved_imprints: [{ id: "imp-x" }],
      qb_customer_id: "QB-2",
    };
    const patch = buildAdditiveMergePatch(primary, dup);
    expect(patch.phone).toBe("555-9999");
    expect(patch.tax_id).toBe("TX-EXEMPT-001");
    expect(patch.tax_exempt).toBe(true);
    expect(patch.saved_imprints).toEqual([{ id: "imp-x" }]);
    expect(patch.notes).toContain("Net 30.");
    expect(patch.notes).toContain("Always overnights.");
    // Unchanged (primary already had values):
    expect(patch.email).toBeUndefined();
    expect(patch.company).toBeUndefined();
    expect(patch.qb_customer_id).toBeUndefined();
  });
});

describe("describeMergeFor — preview for the confirm dialog", () => {
  it("lists every field that will be touched, with mode metadata", () => {
    const primary = { email: "", notes: "Net 30." };
    const dup = { email: "d@x.com", notes: "Likes red.", name: "D" };
    const items = describeMergeFor(primary, dup);
    const fields = items.map(i => i.field);
    expect(fields).toContain("email");
    expect(fields).toContain("notes");
    const noteItem = items.find(i => i.field === "notes");
    expect(noteItem.mode).toBe("append");
  });

  it("returns [] when nothing would change", () => {
    expect(describeMergeFor({ email: "x" }, { email: "y" })).toEqual([]);
  });
});

describe("defensive — null inputs don't blow up", () => {
  it("returns null patch for missing primary/dup", () => {
    expect(buildAdditiveMergePatch(null, {})).toBeNull();
    expect(buildAdditiveMergePatch({}, null)).toBeNull();
    expect(describeMergeFor(null, null)).toEqual([]);
  });
});
