-- Job comments + @mentions (team communication, phase 1).
--
-- order_comments: an order-anchored team thread. Rendered in
-- OrderDetailModal and ShopFloor; posted via the orderComments edge
-- function (INSERT is service-role-only so mention notifications can't
-- be forged or skipped — same posture as notifications itself).
--
-- notifications.recipient_email: per-PERSON addressing on the existing
-- notifications table. NULL keeps today's behavior (shop-level row:
-- owner + managers). A non-null recipient_email addresses one teammate —
-- including employees, who until now had no bell at all. sendPush
-- narrows delivery to that person's devices (push_subscriptions.auth_id).

create table if not exists order_comments (
  id uuid primary key default gen_random_uuid(),
  shop_owner text not null,
  order_id text not null,          -- public ORD- id (matches orders.order_id)
  author_email text not null,
  author_name text,
  body text not null check (char_length(body) between 1 and 4000),
  mentions jsonb not null default '[]'::jsonb,  -- validated member emails
  created_at timestamptz not null default now()
);

create index if not exists order_comments_shop_order_idx
  on order_comments (shop_owner, order_id, created_at);

alter table order_comments enable row level security;

-- Read: the owner and their employees/managers (same containment shape as
-- time_entries). Brokers and anon never see the internal thread.
create policy order_comments_owner_select on order_comments for select to authenticated
using (
  shop_owner = (select p.email from profiles p where p.auth_id = auth.uid())
);

create policy order_comments_member_select on order_comments for select to authenticated
using (
  exists (
    select 1 from profiles p
    where p.auth_id = auth.uid()
      and p.role in ('employee', 'manager')
      and (
        order_comments.shop_owner = p.shop_owner
        or (p.assigned_shops is not null
            and p.assigned_shops @> to_jsonb(order_comments.shop_owner))
      )
  )
);
-- No INSERT/UPDATE/DELETE policies: writes go through the orderComments
-- edge function (service role) only.

-- ── notifications: per-person addressing ────────────────────────────────────

alter table notifications
  add column if not exists recipient_email text;

comment on column notifications.recipient_email is
  'NULL = shop-level notification (owner + managers, existing behavior). Set = addressed to one team member; that person reads/marks it regardless of role, and push delivery narrows to their devices.';

create index if not exists notifications_recipient_unread_idx
  on notifications (recipient_email, read_at, created_at desc)
  where recipient_email is not null;

-- Any authenticated team member can read + mark-read rows addressed to
-- them. INSERT stays service-role-only (unchanged).
create policy notifications_select_recipient on notifications for select to authenticated
using (recipient_email = (auth.jwt() ->> 'email'));

create policy notifications_update_recipient on notifications for update to authenticated
using (recipient_email = (auth.jwt() ->> 'email'))
with check (recipient_email = (auth.jwt() ->> 'email'));
