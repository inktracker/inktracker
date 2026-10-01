-- Artwork approval: proof versions + current state on the order (2026-09-30).
--
-- Joe: "clients sign off and have it reflected in floor mode and the order
-- process". Each "Send proof" is a numbered version with a snapshot of the
-- files + print locations the customer was shown; the customer approves the
-- whole proof or requests changes; production can't leave Art Approval
-- without approved art (owner/manager can override with a note).
--
-- Logic: supabase/functions/_shared/artApproval.js (shared with the app).
-- Writes come only from edge functions (service role): artProof (send,
-- override, reminders) and createCheckoutSession (customer approve /
-- request changes). Additive and safe before the code ships — nothing reads
-- the new columns until then; existing art_approved* columns keep working.

-- ── Current state on the order (cheap for badges on every list) ─────────
alter table public.orders
  add column if not exists art_status text
    check (art_status is null or art_status in ('none', 'sent', 'changes_requested', 'approved')),
  -- Version number of the proof the status refers to.
  add column if not exists art_proof_version integer,
  -- Fingerprint of the art at approval; approval only counts while the
  -- current art still matches it (artApproval.artFingerprint).
  add column if not exists art_approved_fingerprint text;

-- ── Proof versions (history + audit trail) ──────────────────────────────
create table if not exists public.art_proofs (
  id                 uuid primary key default gen_random_uuid(),
  shop_owner         text not null,
  order_id           uuid not null references public.orders(id) on delete cascade,
  version            integer not null check (version > 0),
  status             text not null default 'sent'
                       check (status in ('sent', 'approved', 'changes_requested', 'superseded', 'approved_override')),
  -- What the customer was shown: { files:[{key,name,url}], imprints:[…], fingerprint }
  snapshot           jsonb not null default '{}'::jsonb,
  source             text not null default 'sent' check (source in ('sent', 'quote', 'link', 'override')),
  sent_at            timestamptz,
  sent_by            text,
  sent_to            text,
  message            text,
  responded_at       timestamptz,
  approved_by_name   text,
  response_comment   text,
  response_location  text,
  client_ip          text,
  client_user_agent  text,
  override_by        text,
  override_note      text,
  reminder_sent_at   timestamptz,
  created_at         timestamptz not null default now(),
  unique (order_id, version)
);
create index if not exists art_proofs_shop_idx on public.art_proofs (shop_owner, created_at desc);
create index if not exists art_proofs_waiting_idx on public.art_proofs (sent_at) where status = 'sent';

alter table public.art_proofs enable row level security;

-- Same read scope as orders: the owner, and team members (managers +
-- employees) assigned to the shop with Production access. No write
-- policies — service role only.
create policy art_proofs_owner_select on public.art_proofs for select to authenticated
  using (shop_owner = ((select auth.jwt()) ->> 'email'));
create policy art_proofs_team_select on public.art_proofs for select to authenticated
  using (
    shop_owner in (
      select jsonb_array_elements_text(p.assigned_shops)
      from public.profiles p
      where p.auth_id = (select auth.uid())
        and p.assigned_shops is not null
        and p.role = any (array['manager', 'employee'])
    )
    and public.manager_section_allowed('Production')
  );

comment on table public.art_proofs is
  'Artwork proof versions sent to customers and their responses (approve / request changes / shop override). Service-role writes only (edge fns artProof + createCheckoutSession).';
