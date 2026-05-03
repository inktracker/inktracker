---
name: RLS Lockdown Applied
description: Multi-tenant RLS policies applied 2026-05-01 — profiles table cannot use self-referencing subqueries
type: project
---

RLS lockdown applied to all 18 tables on 2026-05-01. Key finding: profiles table policies CANNOT use subqueries that reference the profiles table itself — causes infinite recursion in RLS evaluation and silently blocks all queries.

**Why:** Postgres evaluates RLS policies on every row access. A subquery like `SELECT ... FROM profiles WHERE auth_id = auth.uid()` inside a profiles RLS policy triggers RLS evaluation on the same table, causing infinite recursion.

**How to apply:** Always use flat conditions for profiles policies (e.g. `auth_id = auth.uid() OR email = auth.jwt()->>'email'`). For other tables, subqueries on profiles are fine since they're different tables.

Migration file: `supabase/migrations/20260501_rls_lockdown.sql`
