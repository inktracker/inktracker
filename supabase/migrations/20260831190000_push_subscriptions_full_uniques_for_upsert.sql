-- PostgREST's on_conflict upsert cannot infer a PARTIAL unique index as
-- its arbiter (42P10), so BOTH device-save paths — webPush.js
-- (onConflict: endpoint) and nativePush.js (onConflict: device_token) —
-- failed with "couldn't save this device" on every platform since the
-- feature shipped (the table never held a single row). Plain unique
-- indexes behave identically for real rows (each column is NULL for the
-- other platform, and NULLs never collide) and are inferable. Same fix
-- class as expenses_shop_owner_qb_expense_id (2026-08-28).
drop index if exists push_subscriptions_endpoint_key;
create unique index push_subscriptions_endpoint_key
  on push_subscriptions (endpoint);

drop index if exists push_subscriptions_device_token_key;
create unique index push_subscriptions_device_token_key
  on push_subscriptions (device_token);
