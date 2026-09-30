-- Per-broker billing timing (shop-controlled). When a shop bills brokers
-- (pricing_config.brokerBillingEnabled), each broker can be billed the wholesale
-- amount UP FRONT (when the order is created, before production) instead of at
-- completion — the "prepay before we print" protection a shop wants for newer or
-- unproven brokers. Stored as a dedicated column on broker_pricing (the per-shop,
-- per-broker settings table) rather than inside its `overrides` JSONB, so the
-- billing toggle and the pricing overrides save independently and never clobber
-- each other. Default false = bill at completion (the existing behavior).
alter table public.broker_pricing
  add column if not exists bill_up_front boolean not null default false;

comment on column public.broker_pricing.bill_up_front is
  'When true (and the shop has broker billing enabled), the shop bills this broker the wholesale amount at ORDER CREATION instead of at completion. Default false = bill at completion.';
