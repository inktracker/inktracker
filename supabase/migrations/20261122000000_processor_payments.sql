-- InkTracker payments through Stripe Connect (2026-10-01; first designed
-- for Rainforest, switched to Stripe after Rainforest quoted a $20k
-- onboarding fee).
--
-- Customers of an opted-in shop pay on Stripe Checkout instead of a
-- QuickBooks link. Each shop has its OWN Stripe account (Connect Standard:
-- the shop is merchant of record and owns its disputes); InkTracker takes an
-- application fee so the shop's all-in cost matches QuickBooks (2.99% card,
-- 1% bank — supabase/functions/_shared/paymentsPricing.js). Opt-in per shop;
-- QuickBooks stays the default and nothing changes for a shop until it both
-- finishes Stripe onboarding AND turns this on.
--
-- NAMING: `payment_accounts` already exists — it's the Expenses feature's
-- list of accounts a shop pays bills from (8 rows in prod). These tables are
-- deliberately named processor_* so they can never be confused with it.
--
-- SECURITY: none of this lives on `shops`. Shop owners can update their own
-- shops row from the browser, and a merchant id there could be pointed at a
-- different merchant. These tables are SELECT-only for the shop's owner and
-- managers; every write goes through the service-role edge functions
-- (stripePayments, stripeConnectWebhook), which verify ownership first.
--
-- DEPLOY ORDER: this migration first, then the edge functions, then the
-- frontend. Everything is inert until the STRIPE_PAYMENTS_ENABLED secret is set
-- and a shop is enabled.

-- ── One row per shop that has started Stripe onboarding ─────────────────
create table if not exists public.processor_accounts (
  shop_owner          text primary key,
  processor           text not null default 'stripe' check (processor in ('stripe')),
  -- The shop's connected Stripe account id (acct_…).
  merchant_id         text unique,
  -- Account state derived from the Stripe account (paymentsAccount.js):
  -- pending | onboarding | active | suspended | deactivated | canceled.
  merchant_status     text,
  -- Sign-up progress: in_progress | needs_information | in_review |
  -- completed | declined. (application_id is unused with Stripe.)
  merchant_application_id     text,
  merchant_application_status text,
  -- The shop's choice to collect through InkTracker. Only takes effect
  -- when merchant_status is active (enforced in the edge functions).
  enabled             boolean not null default false,
  -- The shop's QuickBooks accounts for payout bookkeeping:
  -- the bank account Stripe pays out to, and the expense account for fees.
  qb_bank_account_id  text,
  qb_fee_account_id   text,
  onboarded_at        timestamptz,
  enabled_at          timestamptz,
  -- First time the shop ever switched InkTracker payments on; never
  -- cleared. qbSync uses it to turn QuickBooks online payment back ON for
  -- invoices InkTracker turned off, once the shop is back on QuickBooks.
  processor_used_at   timestamptz,
  -- Claim while the Stripe account is being created, so two clicks
  -- can't create two accounts.
  merchant_creating_at timestamptz,
  -- Which Stripe mode the account belongs to (true = live). A test-mode
  -- account doesn't exist once the live key is in; the shop sets up again.
  stripe_livemode     boolean,
  -- "Connect my existing Stripe account" (OAuth): one-time state checked on
  -- the way back from Stripe, and when it was issued (30 min to use it).
  oauth_state         text,
  oauth_state_at      timestamptz,
  -- When the shop's InkTracker plan was found lapsed (nightly sweep);
  -- cleared on renewal. NEW payments move back to QuickBooks 14 days after
  -- (paymentRail.PLAN_GRACE_DAYS); payouts, refunds and disputes never stop.
  plan_lapsed_at       timestamptz,
  plan_paused_notified_at timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ── Ledger: one row per customer payment attempt ───────────────────────
create table if not exists public.processor_payments (
  id                    uuid primary key default gen_random_uuid(),
  shop_owner            text not null,
  processor             text not null default 'stripe',
  -- Stripe PaymentIntent id (pi_…).
  processor_payin_id    text not null unique,
  merchant_id           text not null,
  quote_id              uuid references public.quotes(id) on delete set null,
  invoice_id            uuid references public.invoices(id) on delete set null,
  qb_invoice_id         text,
  pay_kind              text check (pay_kind in ('full', 'balance', 'deposit')),
  method                text check (method in ('card', 'ach')),
  amount_cents          integer not null check (amount_cents > 0),
  -- When the customer paid (PaymentIntent created): the QuickBooks
  -- payment date, even when a bank payment is booked days later on clearing.
  paid_at               timestamptz,
  platform_fee_cents    integer check (platform_fee_cents >= 0),
  status                text not null default 'pending' check (status in (
                          'pending', 'processing', 'succeeded', 'failed', 'canceled',
                          'refunded', 'partially_refunded', 'returned', 'disputed', 'charged_back')),
  -- QuickBooks Payment posted for this payin (gross, linked to the invoice).
  qb_payment_id         text,
  qb_payment_posted_at  timestamptz,
  -- Claim taken before posting the QB Payment, so two concurrent webhooks
  -- (an event and the nightly backstop) can't both post.
  -- A stale claim (> 10 min, e.g. the function died mid-post) may be retaken.
  qb_posting_at         timestamptz,
  qb_post_error         text,
  -- When the shop was told this payment couldn't be booked (once).
  qb_post_notified_at   timestamptz,
  -- Payout that settled it to the shop's bank.
  processor_payout_id   text,
  last_event_type       text,
  last_event_at         timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists processor_payments_shop_idx   on public.processor_payments (shop_owner, created_at desc);
create index if not exists processor_payments_quote_idx  on public.processor_payments (quote_id) where quote_id is not null;
create index if not exists processor_payments_payout_idx on public.processor_payments (processor_payout_id) where processor_payout_id is not null;

-- ── Payouts: money Stripe sent to the shop's bank ──────────────────────
create table if not exists public.processor_payouts (
  id                    uuid primary key default gen_random_uuid(),
  shop_owner            text not null,
  processor             text not null default 'stripe',
  processor_payout_id   text not null unique,
  merchant_id           text not null,
  net_cents             integer not null,
  fee_cents             integer not null default 0 check (fee_cents >= 0),
  payout_date           date,
  status                text,
  -- QuickBooks Deposit that matches this payout 1:1 with the bank.
  qb_deposit_id         text,
  qb_deposit_posted_at  timestamptz,
  -- Same exactly-once claim as processor_payments.qb_posting_at.
  qb_posting_at         timestamptz,
  qb_post_error         text,
  -- When the shop was told this payout needs recording by hand (once).
  review_notified_at    timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists processor_payouts_shop_idx on public.processor_payouts (shop_owner, payout_date desc);

-- ── Recent customer payment sessions (throttle) ─────────────────────────
-- One row per paid document: the last payment session handed out. A repeat
-- request within ~90s reuses it instead of calling QuickBooks + Stripe
-- again, so a looped or hammered pay link can't burn the shop's QuickBooks
-- rate limit. Service role only.
create table if not exists public.processor_pay_sessions (
  doc_id      uuid primary key,
  response    jsonb not null,
  created_at  timestamptz not null default now()
);
alter table public.processor_pay_sessions enable row level security;
-- No policies: service role only.

-- ── Invoice pay page token ─────────────────────────────────────────────
-- Quotes already carry public_token for the customer's pay page. Invoices
-- (the order-then-invoice flow) get the same so a processor-rail shop can
-- send "Pay Invoice" to InkTracker's page instead of a QuickBooks link.
-- Nullable, no default (no table rewrite): minted at send time only for
-- processor-rail shops. Existing invoice RLS already covers it — the shop
-- that owns the invoice can set its own token.
alter table public.invoices add column if not exists public_token text;
create unique index if not exists invoices_public_token_key
  on public.invoices (public_token) where public_token is not null;

-- ── RLS: owner + managers read their own shop; nobody writes from the client
alter table public.processor_accounts     enable row level security;
alter table public.processor_payments enable row level security;
alter table public.processor_payouts      enable row level security;

do $$
declare t text;
begin
  foreach t in array array['processor_accounts', 'processor_payments', 'processor_payouts'] loop
    -- Same shapes as the existing money tables (e.g. the Expenses
    -- payment_accounts policies): owner by JWT email; managers via
    -- assigned_shops AND the Invoices section permission.
    execute format($f$
      create policy %1$s_owner_select on public.%1$s for select to authenticated
      using (shop_owner = ((select auth.jwt()) ->> 'email'))
    $f$, t);
    execute format($f$
      create policy %1$s_manager_select on public.%1$s for select to authenticated
      using (
        shop_owner in (
          select jsonb_array_elements_text(p.assigned_shops)
          from public.profiles p
          where p.auth_id = (select auth.uid())
            and p.assigned_shops is not null
            and p.role = 'manager'
        )
        and public.manager_section_allowed('Invoices')
      )
    $f$, t);
  end loop;
end $$;
-- No INSERT/UPDATE/DELETE policies: service role only.

comment on table public.processor_accounts is
  'Connected Stripe account per shop. Service-role writes only (edge fn stripePayments). enabled=true AND account active → customers pay on Stripe Checkout instead of the QuickBooks link.';
comment on table public.processor_payments is
  'Ledger of customer payments collected through Stripe, with the QuickBooks Payment each one posted. Service-role writes only (stripeConnectWebhook).';
comment on table public.processor_payouts is
  'Stripe payouts to the shop bank, with the QuickBooks Deposit that matches each one. Service-role writes only.';
