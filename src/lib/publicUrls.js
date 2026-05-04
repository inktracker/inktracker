// Source of truth for the customer-facing origin. Used wherever we generate
// a URL that a CUSTOMER will open (payment links, art approval, etc.) so
// those URLs don't end up pointing at whatever vercel preview the shop
// owner happens to be on when they send the email.
//
// Override locally for staging by setting VITE_PUBLIC_URL; production keeps
// the canonical inktracker.app domain.

const CUSTOMER_PUBLIC_URL_DEFAULT = "https://www.inktracker.app";

export const CUSTOMER_PUBLIC_URL =
  (import.meta.env.VITE_PUBLIC_URL || CUSTOMER_PUBLIC_URL_DEFAULT).replace(/\/$/, "");

// Builders so call sites stay short and consistent.
export function quotePaymentUrl(quoteId, token) {
  const params = new URLSearchParams({ id: quoteId });
  if (token) params.set("token", token);
  return `${CUSTOMER_PUBLIC_URL}/quotepayment?${params}`;
}

export function artApprovalUrl(orderId, token) {
  const params = new URLSearchParams({ id: orderId });
  if (token) params.set("token", token);
  return `${CUSTOMER_PUBLIC_URL}/ArtApproval?${params}`;
}

export function orderStatusUrl(orderId, token) {
  const params = new URLSearchParams({ id: orderId });
  if (token) params.set("token", token);
  return `${CUSTOMER_PUBLIC_URL}/OrderStatus?${params}`;
}
