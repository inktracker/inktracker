-- Push delivery: device/browser subscriptions for the notifications table.
--
-- The `notifications` table (20260512_notifications) already collects the
-- events worth telling a shop about, and NotificationBell shows them in
-- the app. That only works while someone has InkTracker open. This table
-- holds the endpoints needed to reach a shop when they DON'T — a lead
-- arriving from the public wizard at 7pm is worth a buzz; a shop owner
-- discovering it the next morning is a lost job.
--
-- One table, two transports:
--   platform='web' → Web Push (RFC 8291). endpoint + p256dh + auth come
--     from PushManager.subscribe(). Works in desktop Chrome/Edge/Firefox
--     and in installed iOS/macOS Safari PWAs. No app review involved.
--   platform='ios' → APNs. device_token comes from the Capacitor push
--     plugin. Requires a native rebuild + App Store resubmission, so it
--     lands with the next binary rather than gating this work.
--
-- SCOPING — deliberately (shop_owner, auth_id), not one or the other:
--   * shop_owner is the SHOP whose notifications this device wants. It's
--     what the send path filters on, matching notifications.shop_owner.
--   * auth_id is the PERSON, so RLS can let someone manage their own
--     devices without being able to see (or delete) a teammate's.
-- A manager with two browsers gets two rows; a shop owner who also
-- brokers for another shop gets one row per shop context. Both correct.

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id            BIGSERIAL PRIMARY KEY,
  shop_owner    TEXT        NOT NULL,        -- which shop's notifications
  auth_id       UUID        NOT NULL,        -- which person owns the device
  platform      TEXT        NOT NULL
                            CHECK (platform IN ('web', 'ios')),

  -- Web Push (platform='web')
  endpoint      TEXT,                        -- push service URL
  p256dh        TEXT,                        -- client public key (base64url)
  auth_secret   TEXT,                        -- client auth secret (base64url)

  -- APNs (platform='ios')
  device_token  TEXT,

  user_agent    TEXT,                        -- for "which device is this?" in settings
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_sent_at  TIMESTAMPTZ,
  -- Set when the push service tells us the endpoint is dead (404/410) or
  -- after repeated hard failures. Kept rather than deleted so the
  -- settings UI can say "this device stopped receiving" instead of the
  -- row silently vanishing.
  disabled_at   TIMESTAMPTZ,
  failure_count INT         NOT NULL DEFAULT 0,

  -- Shape integrity: each transport needs its own fields and must not
  -- carry the other's. Without this a half-populated row looks valid and
  -- fails only at send time, in a background job nobody is watching.
  CONSTRAINT push_subscriptions_transport_shape CHECK (
    (platform = 'web'
      AND endpoint IS NOT NULL AND p256dh IS NOT NULL AND auth_secret IS NOT NULL
      AND device_token IS NULL)
    OR
    (platform = 'ios'
      AND device_token IS NOT NULL
      AND endpoint IS NULL AND p256dh IS NULL AND auth_secret IS NULL)
  )
);

-- Re-subscribing must UPDATE, not duplicate. Browsers hand back the same
-- endpoint for the same profile+origin, and iOS reissues the same device
-- token, so the transport identifier is the natural key. Partial uniques
-- because each column is NULL for the other platform (and NULLs don't
-- collide in a plain unique index).
CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_key
  ON public.push_subscriptions (endpoint)
  WHERE endpoint IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_device_token_key
  ON public.push_subscriptions (device_token)
  WHERE device_token IS NOT NULL;

-- Send path: "every live device for this shop".
CREATE INDEX IF NOT EXISTS push_subscriptions_shop_live_idx
  ON public.push_subscriptions (shop_owner)
  WHERE disabled_at IS NULL;

-- Settings path: "my devices".
CREATE INDEX IF NOT EXISTS push_subscriptions_auth_idx
  ON public.push_subscriptions (auth_id, created_at DESC);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- A person manages their OWN devices. Note this is auth_id-scoped, not
-- shop-scoped: an employee must not be able to enumerate or unsubscribe
-- the owner's phone. The send path runs as service_role and bypasses RLS.
DROP POLICY IF EXISTS push_subscriptions_select_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_select_own ON public.push_subscriptions
  FOR SELECT TO authenticated
  USING (auth_id = auth.uid());

DROP POLICY IF EXISTS push_subscriptions_insert_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_insert_own ON public.push_subscriptions
  FOR INSERT TO authenticated
  -- WITH CHECK on shop_owner too: without it a signed-in user could
  -- register a device against ANOTHER shop's shop_owner and receive that
  -- shop's notification titles (customer names, dollar amounts).
  -- acts_for_shop() is the same helper the rest of the schema uses.
  WITH CHECK (auth_id = auth.uid() AND public.acts_for_shop(shop_owner));

DROP POLICY IF EXISTS push_subscriptions_update_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_update_own ON public.push_subscriptions
  FOR UPDATE TO authenticated
  USING (auth_id = auth.uid())
  WITH CHECK (auth_id = auth.uid() AND public.acts_for_shop(shop_owner));

DROP POLICY IF EXISTS push_subscriptions_delete_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_delete_own ON public.push_subscriptions
  FOR DELETE TO authenticated
  USING (auth_id = auth.uid());

COMMENT ON TABLE public.push_subscriptions IS
  'Web Push / APNs endpoints per (shop, person, device). Send path filters on shop_owner; RLS scopes management to auth_id.';

-- ── Delivery trigger: notifications INSERT → pg_net → sendPush ──────────
--
-- Same shape as notify_signup_webhook (20260905000000): async pg_net POST,
-- wrapped so a push failure can NEVER break the INSERT. The bell is the
-- source of truth; push is a tap on the shoulder, and a tap that fails
-- must not cost the shop the notification itself.
--
-- DEPLOY ORDER: deploy the sendPush edge function BEFORE applying this
-- migration. If the migration lands first, posts 404 harmlessly until the
-- function exists — notifications are unaffected either way.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.notify_push_on_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM net.http_post(
    url     := 'https://skmltfbibaqcjddmeqvi.supabase.co/functions/v1/sendPush',
    body    := jsonb_build_object('record', jsonb_build_object('id', NEW.id)),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_push_on_notification failed (non-fatal): %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS send_push_on_notification_insert ON public.notifications;
CREATE TRIGGER send_push_on_notification_insert
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_push_on_notification();
