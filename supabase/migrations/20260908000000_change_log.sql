-- change_log — shop-facing "who changed what, when, and from where".
--
-- The shop had no way to see modification history. QB-side edits were
-- invisible unless the total moved; InkTracker-side edits left no trace
-- at all. When an invoice total or a garment color turned out wrong,
-- there was nothing to answer "who did this and when".
--
-- Deliberately an AUDIT LOG, not a sync mechanism. Nothing here changes
-- prices, totals, or line items — it records what happened. Adoption of
-- QuickBooks' numbers stays an explicit operator click (the
-- quote-snapshot invariant), and QB line text is never parsed back into
-- the structured local line.
--
-- Distinct from qb_event_log (internal QB plumbing, operator/debug
-- oriented) and notifications (transient, dismissable bell items). This
-- is the durable, shop-readable history of a document.

CREATE TABLE IF NOT EXISTS public.change_log (
  id            BIGSERIAL PRIMARY KEY,
  shop_owner    TEXT        NOT NULL,
  entity_type   TEXT        NOT NULL          -- which document changed
                            CHECK (entity_type IN ('invoice', 'quote', 'order')),
  entity_id     TEXT        NOT NULL,         -- row id in that table
  entity_ref    TEXT,                         -- human ref, e.g. 'INV-2026-F93AM'
  source        TEXT        NOT NULL          -- WHERE the change came from
                            CHECK (source IN ('quickbooks', 'inktracker', 'system')),
  actor         TEXT,                         -- who: user email, or null when
                                              -- the origin system doesn't tell us
  summary       TEXT        NOT NULL,         -- one line for the history list
  changes       JSONB       NOT NULL DEFAULT '[]'::jsonb,  -- ["Line 1 description: X → Y", …]
  metadata      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hot path: the history panel on one document, newest first.
CREATE INDEX IF NOT EXISTS change_log_entity_idx
  ON public.change_log (shop_owner, entity_type, entity_id, created_at DESC);

-- Secondary: a shop-wide activity feed.
CREATE INDEX IF NOT EXISTS change_log_shop_created_idx
  ON public.change_log (shop_owner, created_at DESC);

ALTER TABLE public.change_log ENABLE ROW LEVEL SECURITY;

-- APPEND-ONLY for authenticated users: SELECT + INSERT, deliberately no
-- UPDATE and no DELETE policy. An audit trail the shop can rewrite is
-- not an audit trail. (service_role bypasses RLS for edge-function
-- writes and for shop purge / GDPR deletion.)

DROP POLICY IF EXISTS change_log_select_own ON public.change_log;
CREATE POLICY change_log_select_own ON public.change_log
  FOR SELECT
  TO authenticated
  USING (shop_owner = ((SELECT auth.jwt()) ->> 'email'));

DROP POLICY IF EXISTS change_log_insert_own ON public.change_log;
CREATE POLICY change_log_insert_own ON public.change_log
  FOR INSERT
  TO authenticated
  WITH CHECK (shop_owner = ((SELECT auth.jwt()) ->> 'email'));

-- Team members (managers / employees) work under the owner's
-- shop_owner, so they need the assigned_shops containment path used by
-- the other team-writable tables. Their own email lands in `actor`,
-- which is how the owner sees WHO made the change.
--
-- No manager_section_allowed() / has_active_subscription() gate here on
-- purpose: history is a read-mostly audit surface, and a lapsed or
-- permission-narrowed account must still be able to SEE what happened.
-- (Deliberately NOT naming the production policies here — the NEW-05
-- guard test treats any migration mentioning one of them as the file
-- that last set its WITH CHECK.)

DROP POLICY IF EXISTS change_log_select_team ON public.change_log;
CREATE POLICY change_log_select_team ON public.change_log
  FOR SELECT
  TO authenticated
  USING (shop_owner IN (
    SELECT jsonb_array_elements_text(p.assigned_shops)
    FROM profiles p
    WHERE p.auth_id = (SELECT auth.uid()) AND p.assigned_shops IS NOT NULL
  ));

DROP POLICY IF EXISTS change_log_insert_team ON public.change_log;
CREATE POLICY change_log_insert_team ON public.change_log
  FOR INSERT
  TO authenticated
  WITH CHECK (shop_owner IN (
    SELECT jsonb_array_elements_text(p.assigned_shops)
    FROM profiles p
    WHERE p.auth_id = (SELECT auth.uid()) AND p.assigned_shops IS NOT NULL
  ));

COMMENT ON TABLE public.change_log IS
  'Append-only shop-facing history: who changed which document, when, and from where (quickbooks | inktracker | system). Never mutates the document it describes.';
