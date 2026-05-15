// Public-wizard quote submission. Wraps the `submit_wizard_quote`
// SECURITY DEFINER RPC defined in 20260531_quotes_anon_lockdown.sql.
//
// Before the lockdown, the wizard called `base44.entities.Quote.create()`
// which did a plain `INSERT ... RETURNING ...` against the quotes table
// from an anonymous client. That worked only because the RLS policy
// `quotes_anon_select USING (true)` was wide open — which also let
// anyone with the (publicly-embedded) anon key scrape every quote in
// the database via raw REST. Migration 20260531 dropped that policy.
//
// Now anon can only submit through this RPC, which forces:
//   status = 'Pending'   (no anon-elevation to Approved)
//   source = 'wizard'    (audit trail)
// and strips broker_id / broker_email / broker_name / public_token /
// sent_to / sent_date so a hostile payload can't claim broker
// commissions or pre-set the security gate.

/**
 * Build the jsonb payload to send to `submit_wizard_quote`. Strips or
 * overrides any fields the public wizard isn't allowed to set.
 *
 * The actual SQL function also strips/overrides these defensively —
 * the JS-side scrub is for clarity at the call site and to make the
 * contract testable without standing up a database.
 *
 * @param {object} quote     The wizard's quote object (see OrderWizard.jsx)
 * @param {string} shopOwner The owner email taken from the wizard URL,
 *                           not the payload. Authoritative.
 * @returns {object}         Payload safe to hand to supabase.rpc(...).
 */
export function buildWizardQuotePayload(quote, shopOwner) {
  if (!shopOwner || typeof shopOwner !== "string" || !shopOwner.trim()) {
    throw new Error("shopOwner is required");
  }

  // Spread the quote first, then override. Caller-supplied versions
  // of protected fields get clobbered, not merged.
  const {
    // Strip — anon can't set these (server function ignores them too,
    // but be explicit so the wire payload doesn't even carry them).
    broker_id: _bid,
    broker_email: _bem,
    broker_name: _bnm,
    public_token: _ptk,
    sent_to: _sto,
    sent_date: _sdt,
    status: _sts,    // forced to Pending below
    source: _src,    // forced to wizard below
    ...safe
  } = quote || {};
  // Suppress unused-var lint by referencing once.
  void _bid; void _bem; void _bnm; void _ptk; void _sto; void _sdt; void _sts; void _src;

  return {
    ...safe,
    shop_owner: shopOwner.trim(),
    status: "Pending",
    source: "wizard",
  };
}

/**
 * Submit a wizard quote via the locked-down RPC. Returns the inserted
 * quote's UUID on success.
 *
 * @param {object} supabaseClient — pass the project's supabase client
 * @param {object} quote          — the wizard's quote object
 * @param {string} shopOwner      — owner email from the wizard URL
 * @returns {Promise<string>}     — inserted quote's UUID
 */
export async function submitWizardQuote(supabaseClient, quote, shopOwner) {
  const payload = buildWizardQuotePayload(quote, shopOwner);
  const { data, error } = await supabaseClient.rpc("submit_wizard_quote", { payload });
  if (error) throw error;
  return data;
}
