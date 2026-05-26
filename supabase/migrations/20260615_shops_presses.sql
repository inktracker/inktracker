-- Per-shop list of presses, for the Order Detail "Assigned Press"
-- dropdown.
--
-- Before this, "Assigned Press" was a free-text input — operators had
-- to retype names every time and there was no canonical list. Now the
-- shop owner configures the list once in Account → Production Setup
-- and operators pick from a dropdown on each order.
--
-- Stored as a plain text[] (e.g. ["Auto 1", "Auto 2", "Manual 1"]).
-- Empty array = no presses configured; the order modal falls back to
-- a free-text input so legacy values keep working.

alter table shops
  add column if not exists presses text[] not null default '{}';

comment on column shops.presses is
  'Shop-configured press names shown as the Assigned Press dropdown options on the order detail modal. Empty array = no presses configured (UI falls back to a free-text input).';
