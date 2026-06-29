-- DB-07 completion: backfill + shop_owner NOT NULL on quotes + messages.
--
-- These two tenant tables were skipped in 20260803 because they still had NULL
-- shop_owner rows (RLS-invisible "ghost rows"). Verified against prod:
--   quotes:   6 legacy NULLs, all pre-dating the submit_wizard_quote shop_owner
--             guard. Every one resolves from its customer's shop. Every LIVE
--             insert path now sets shop_owner (RPC raises if missing,
--             createQuoteFromPayload sets it, authenticated creates are RLS-
--             forced to shop_owner = jwt email), so the constraint is safe.
--   messages: 35 NULLs from the now-disabled email scanner (#471). 1 links to a
--             live quote thread (backfilled); 34 are orphaned ghosts whose
--             quote was deleted — unattributable, invisible, stale email-thread
--             records — and are removed (also a PRIV-05 data-minimization win).
--
-- Order matters: backfill quotes first, then messages from their quote/order
-- thread, then delete the orphans, then enforce NOT NULL.

-- quotes ← customer's shop
-- NB: quotes.customer_id is TEXT, customers.id is UUID (the DB-03 mismatch),
-- so compare on the UUID's text form.
UPDATE public.quotes q
   SET shop_owner = c.shop_owner
  FROM public.customers c
 WHERE q.shop_owner IS NULL AND q.customer_id = c.id::text AND c.shop_owner IS NOT NULL;

-- messages ← linked quote/order (thread_id = "quote:<quote_id>" / "order:<order_id>")
UPDATE public.messages m
   SET shop_owner = q.shop_owner
  FROM public.quotes q
 WHERE m.shop_owner IS NULL AND m.thread_id = 'quote:' || q.quote_id AND q.shop_owner IS NOT NULL;

UPDATE public.messages m
   SET shop_owner = o.shop_owner
  FROM public.orders o
 WHERE m.shop_owner IS NULL AND m.thread_id = 'order:' || o.order_id AND o.shop_owner IS NOT NULL;

-- Orphaned ghosts (their quote/order no longer exists) — remove.
DELETE FROM public.messages WHERE shop_owner IS NULL;

-- Enforce the constraint (validates clean now that 0 NULLs remain).
ALTER TABLE public.quotes   ALTER COLUMN shop_owner SET NOT NULL;
ALTER TABLE public.messages ALTER COLUMN shop_owner SET NOT NULL;
