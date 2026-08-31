-- Assignable tasks with due dates (team communication, phase 2).
--
-- A task is a unit of delegation: optionally anchored to an order,
-- optionally assigned to a teammate, optionally dated. Created/updated
-- ONLY through the teamTasks edge function (service role) so assignment
-- notifications ride the same can't-be-forged rails as order comments.
-- Reads are direct under RLS.
--
-- Additive migration: new table + indexes + policies only; nothing
-- existing is touched.

create table if not exists shop_tasks (
  id uuid primary key default gen_random_uuid(),
  shop_owner text not null,
  order_id text,                     -- public ORD- id; null = shop-level task
  title text not null check (char_length(title) between 1 and 300),
  details text not null default '',
  assignee_email text,               -- roster-validated by the edge fn; null = unassigned
  assignee_name text,
  due_date date,
  status text not null default 'open' check (status in ('open', 'done')),
  created_by text not null,
  created_by_name text,
  done_at timestamptz,
  done_by text,
  created_at timestamptz not null default now()
);

create index if not exists shop_tasks_shop_status_due_idx
  on shop_tasks (shop_owner, status, due_date);
create index if not exists shop_tasks_assignee_idx
  on shop_tasks (assignee_email, status);
create index if not exists shop_tasks_order_idx
  on shop_tasks (shop_owner, order_id);

alter table shop_tasks enable row level security;

-- Read: owner + employees/managers of the shop (same containment shape as
-- order_comments / time_entries). The whole team sees the shop's tasks —
-- delegation only works when everyone can see who owns what.
create policy shop_tasks_owner_select on shop_tasks for select to authenticated
using (
  shop_owner = (select p.email from profiles p where p.auth_id = auth.uid())
);

create policy shop_tasks_member_select on shop_tasks for select to authenticated
using (
  exists (
    select 1 from profiles p
    where p.auth_id = auth.uid()
      and p.role in ('employee', 'manager')
      and (
        shop_tasks.shop_owner = p.shop_owner
        or (p.assigned_shops is not null
            and p.assigned_shops @> to_jsonb(shop_tasks.shop_owner))
      )
  )
);
-- No INSERT/UPDATE/DELETE policies: writes go through the teamTasks edge
-- function (service role) only.
