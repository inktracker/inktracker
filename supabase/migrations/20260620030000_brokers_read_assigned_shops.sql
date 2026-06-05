-- Extend the shops SELECT policy so brokers can read the shop they're
-- assigned to (via profiles.assigned_shops JSONB array).
--
-- Before this migration: brokers could only see shops where they were
-- the owner (none, since brokers don't own shops). The result was that
-- BrokerDashboard's Shop.filter({owner_email: assignedShop}) returned
-- an empty array — shop.pricing_config was never delivered, the
-- technique dropdown defaulted to "Screen Print" only, and any other
-- shop-config-driven UI on the broker side rendered with platform
-- defaults instead of the host shop's actual setup.
--
-- The fix: also allow SELECT when the requesting user's profile lists
-- the shop's owner_email in assigned_shops. Uses the JSONB containment
-- operator (@>) for an indexable, type-safe membership check.
--
-- Tenant-scope rationale: a broker can read ONLY shops listed on their
-- own profile. They cannot see shops belonging to other brokers' shops.
-- The cross-tenant guard is implicit in the WHERE clause (`profiles.email
-- = auth.jwt()->>'email'`) — a malicious user can't fake their assigned
-- shops list because they can't write to another user's profile row.

DROP POLICY IF EXISTS "shops_select" ON public.shops;

CREATE POLICY "shops_select" ON public.shops FOR SELECT TO authenticated
  USING (
    owner_email = auth.jwt() ->> 'email'
    OR EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.email = auth.jwt() ->> 'email'
        AND profiles.assigned_shops @> to_jsonb(shops.owner_email)
    )
  );
