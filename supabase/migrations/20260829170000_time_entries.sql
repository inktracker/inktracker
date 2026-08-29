-- Timesheets: employees clock in/out on ShopFloor; the owner reviews and
-- approves in AdminPanel; approved entries push to QuickBooks Online as
-- TimeActivity records via qbSync (action pushTimeEntries), where QBO
-- Payroll can use them for hourly pay runs.
--
-- Books-safety: the QB push is append-only (TimeActivity create). A row
-- records its qb_time_activity_id after a successful push and is never
-- pushed again (idempotency re-checked server-side before each create).

create table if not exists time_entries (
  id uuid primary key default gen_random_uuid(),
  shop_owner text not null,
  member_email text not null,
  member_name text,
  work_date date not null,
  clock_in timestamptz,
  clock_out timestamptz,
  -- Authoritative duration for review + QB push. Derived from the clocks
  -- at clock-out but editable by the owner before approval.
  minutes integer check (minutes is null or (minutes >= 0 and minutes <= 1440)),
  notes text,
  -- open (clocked in) → submitted (clocked out) → approved (owner).
  status text not null default 'open' check (status in ('open','submitted','approved')),
  qb_time_activity_id text,
  qb_employee_id text,
  qb_synced_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists time_entries_shop_date
  on time_entries (shop_owner, work_date desc);

-- One running clock per person per shop.
create unique index if not exists time_entries_one_open
  on time_entries (shop_owner, member_email) where status = 'open';

alter table time_entries enable row level security;

-- Owner: full access to their shop's entries.
create policy time_entries_owner on time_entries for all to authenticated
using (
  shop_owner = (select p.email from profiles p where p.auth_id = auth.uid())
)
with check (
  shop_owner = (select p.email from profiles p where p.auth_id = auth.uid())
);

-- Team members (employee/manager — never brokers): their OWN rows in an
-- assigned shop only, and they can never set status='approved' — approval
-- is the owner's act, enforced here rather than in the frontend.
create policy time_entries_member on time_entries for all to authenticated
using (
  exists (
    select 1 from profiles p
    where p.auth_id = auth.uid()
      and p.role in ('employee', 'manager')
      and p.email = time_entries.member_email
      and (
        time_entries.shop_owner = p.shop_owner
        or (p.assigned_shops is not null
            and p.assigned_shops @> to_jsonb(time_entries.shop_owner))
      )
  )
)
with check (
  status in ('open', 'submitted')
  and exists (
    select 1 from profiles p
    where p.auth_id = auth.uid()
      and p.role in ('employee', 'manager')
      and p.email = time_entries.member_email
      and (
        time_entries.shop_owner = p.shop_owner
        or (p.assigned_shops is not null
            and p.assigned_shops @> to_jsonb(time_entries.shop_owner))
      )
  )
);
