// Pure logic extracted VERBATIM from OrderWizard.jsx (public wizard) as part of
// the God-component decomposition — zero behavior change. Kept as plain,
// dependency-light functions so the payload build + the fail-closed validation
// are unit-testable on their own.
//
// buildWizardQuote() reads garmentCost straight from getEffectiveCost(g) exactly
// as the inline handler did. That is the line the "wizard drops the blank cost"
// bug class lives on (shipped twice), so making it directly testable is the
// point — not an incidental refactor.

import { getEffectiveCost } from "@/lib/wizard/getEffectiveCost";
import { getWizardRushDisplay, getMinOrderQty, uid } from "@/components/shared/pricing";
import { todayInShopTz } from "@/lib/shopTimezone";

// Build the quote payload the anonymous wizard submits. Returns the quote
// object and the filtered list of valid garments (the caller stamps that into
// submittedGarments for the confirmation screen).
export function buildWizardQuote({
  garments,
  imprints,
  artFiles,
  contact,
  rush,
  shopOwner,
  botHoneypot,
  wizardOpenedAt,
}) {
  const validGarments = garments.filter((g) => g.style && g.color);

  const allArtwork = [];
  // Run-level imprints + artwork apply to every garment in the run.
  // linked:true tells calcLinkedLinePrice to combine quantities across
  // all garments when picking the volume break.
  const sharedImprints = imprints.map((imp, idx) => {
    const art = artFiles?.[idx];
    if (art?.url) {
      allArtwork.push({ id: art.url, name: art.name, url: art.url });
    }
    return {
      ...imp,
      linked: true,
      artwork_url: art?.url || "",
      artwork_name: art?.name || "",
      artwork_id: art?.url || "",
      mockup_url: "",
    };
  });
  const line_items = validGarments.map((g) => ({
    id: uid(),
    style: g.style.name || `${g.style.brand || ""} ${g.style.styleNumber || ""}`.trim(),
    garmentCost: getEffectiveCost(g),
    garmentColor: g.color,
    sizes: g.sizes,
    imprints: sharedImprints.map((imp) => ({ ...imp })),
    category: g.style.garment || "",
  }));
  const quote = {
    shop_owner: shopOwner || "",
    customer_name: contact.name,
    customer_email: contact.email,
    phone: contact.phone,
    company: contact.company,
    // Shop-tz, not UTC. Falls through to the customer's browser tz
    // when no shop tz is loaded (the anonymous wizard path), which
    // is the right behavior for a customer submitting from their
    // own location.
    date: todayInShopTz(),
    due_date: contact.dueDate || null,
    status: "Pending",
    notes: contact.notes,
    rush_rate: rush ? getWizardRushDisplay().rate : 0,
    extras: { colorMatch: false, difficultPrint: false, waterbased: false, tags: false },
    line_items,
    selected_artwork: allArtwork,
    tax_exempt: contact.taxExempt,
    tax_id: contact.taxId,
    discount: 0, tax_rate: 0, deposit_pct: 0, deposit_paid: false,
    // 5 chars of base36 from a millisecond timestamp ≈ 60M combinations
    // per year, matching the rest of the codebase's quote_id generators.
    quote_id: `Q-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase().slice(-5)}`,
    // Anti-bot signals — server enforces. Underscored to mark them
    // as private/internal metadata, not user-set quote fields.
    _bot_honeypot: botHoneypot,
    _bot_dwell_ms: Date.now() - (wizardOpenedAt || Date.now()),
  };
  return { quote, validGarments };
}

// Validation helper — returns the list of issues preventing Continue.
export function getWizardValidationIssues(garments) {
  const issues = [];
  if (!garments.some((gg) => gg.style)) issues.push("Select a garment style");
  else if (!garments.some((gg) => gg.style && gg.color)) issues.push("Choose a garment color");
  else {
    const minQty = getMinOrderQty();
    const hasEnoughQty = garments.some((gg) => {
      const gQ = Object.values(gg.sizes).reduce((a, v) => a + (parseInt(v) || 0), 0);
      return gg.style && gg.color && gQ >= minQty;
    });
    if (!hasEnoughQty) issues.push(`Minimum ${minQty} pieces required per garment`);
  }
  // Fail-closed guard: if any picked style+color has no resolvable
  // wholesale cost, refuse to advance. The bug this prevents — wizard
  // silently shipping print-only pricing when wizard_styles[] is stale
  // — already shipped twice (2026-05-26, 2026-06-07). The shop fixes
  // it by re-syncing in Account → Wizard Setup; the customer sees a
  // clear "contact us" message instead of an undercharged quote.
  for (const gg of garments) {
    if (gg.style && gg.color && getEffectiveCost(gg) === 0) {
      const label = `${gg.style.brand || ""} ${gg.style.styleNumber || gg.style.name || ""}`.trim() || "this style";
      issues.push(`Live pricing isn't available for ${label} right now — please contact us to quote it.`);
      console.warn("[Wizard] blocked submit: no cost data for", label, gg.color);
      break;
    }
  }
  return issues;
}
