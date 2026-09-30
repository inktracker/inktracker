// Read Rainforest payment-component events defensively. The docs index the
// payload as an array (`event.detail[0]`) but never show the `approved` shape,
// so accept the common nestings. The webhook is the source of truth; this is
// only for what the customer sees next.

function firstObject(detail) {
  const d = Array.isArray(detail) ? detail[0] : detail;
  if (!d || typeof d !== "object") return {};
  return d.data && typeof d.data === "object" ? d.data : d;
}

/** @returns {{ payinId: string|null, method: "card"|"ach"|null }} */
export function readApproved(detail) {
  const d = firstObject(detail);
  const t = String(d.method_type ?? d.payin?.method_type ?? "").toUpperCase();
  return {
    payinId: d.payin_id ?? d.payin?.payin_id ?? null,
    method: ["ACH", "PLAID_ACH"].includes(t) ? "ach" : t ? "card" : null,
  };
}

/**
 * The method the customer has selected in the form, from the component's
 * `method-updated` event (documented values: ACH | CARD).
 * @returns {"card"|"ach"|null}
 */
export function readMethodUpdated(detail) {
  const d = Array.isArray(detail) ? detail[0] : detail;
  const raw = typeof d === "string" ? d : (d?.method ?? d?.method_type ?? d?.data?.method ?? d?.data?.method_type ?? "");
  const t = String(raw).toUpperCase();
  if (t === "ACH" || t === "PLAID_ACH" || t === "VALIDATED_ACH") return "ach";
  if (t === "CARD" || t === "APPLE_PAY" || t === "GOOGLE_PAY") return "card";
  return null;
}
