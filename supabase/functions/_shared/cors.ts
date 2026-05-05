// Shared CORS headers for edge functions.
// Locked to inktracker.app by default. Use CORS_PUBLIC for functions
// that must be callable from external sites (embedded wizard, webhooks).

export const CORS = {
  "Access-Control-Allow-Origin": "https://www.inktracker.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// For functions called from embedded iframes on customer websites,
// or inbound webhooks from Stripe/QB.
export const CORS_PUBLIC = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};
