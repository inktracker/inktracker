-- Team-scale fixes (larger-shop work, part 1):
--
-- 1. TEAM NOTIFICATIONS. The bell's RLS matched shop_owner = the
--    caller's own email, so every manager saw an empty bell — QB drift,
--    payment notices, "modified in QuickBooks" all reached ONLY the
--    owner, who became the shop's message bus. Managers now read and
--    mark-read their shop's notifications via the same assigned_shops
--    containment the other manager policies use.
--
--    Scope decisions: managers only (full-partnership default —
--    employees are ShopFloor-only and the floor stays money-free);
--    read + mark-read only (INSERT stays service-role-only, so the
--    forge-a-notification surface doesn't widen).
--
-- 2. profiles.hide_money — per-teammate "hide financials" flag for the
--    role-template work (Art/Floor-flavored managers shouldn't have
--    margins on screen at the press). Display-level gate, set by the
--    owner via adminAction.

-- ── 1. notifications: manager read + mark-read ─────────────────────────────

DROP POLICY IF EXISTS notifications_select_manager ON public.notifications;
CREATE POLICY notifications_select_manager ON public.notifications
  FOR SELECT
  TO authenticated
  USING (shop_owner IN (
    SELECT jsonb_array_elements_text(p.assigned_shops)
    FROM profiles p
    WHERE p.auth_id = (SELECT auth.uid())
      AND p.assigned_shops IS NOT NULL
      AND p.role = 'manager'
  ));

DROP POLICY IF EXISTS notifications_update_manager ON public.notifications;
CREATE POLICY notifications_update_manager ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (shop_owner IN (
    SELECT jsonb_array_elements_text(p.assigned_shops)
    FROM profiles p
    WHERE p.auth_id = (SELECT auth.uid())
      AND p.assigned_shops IS NOT NULL
      AND p.role = 'manager'
  ))
  WITH CHECK (shop_owner IN (
    SELECT jsonb_array_elements_text(p.assigned_shops)
    FROM profiles p
    WHERE p.auth_id = (SELECT auth.uid())
      AND p.assigned_shops IS NOT NULL
      AND p.role = 'manager'
  ));

-- ── 2. hide_money flag ──────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS hide_money boolean;

COMMENT ON COLUMN public.profiles.hide_money IS
  'Owner-set display flag: hide prices/costs/margins on production surfaces for this teammate. Display-level courtesy gate, not a security boundary — section permissions (manager_permissions + RLS) are the enforcement layer for data access.';
