-- Bound quotes.deposit_pct to [0, 100] (audit BILL-07).
--
-- deposit_pct is an unconstrained NUMERIC. The quote editors clamp input to
-- [1, 100], but a direct authenticated write / API client / future code path
-- could persist a nonsense percentage (e.g. 150 or -10), and the deposit-due
-- math (total * deposit_pct / 100) would then bill a wrong amount.
--
-- Clamp any existing out-of-range rows FIRST so the constraint validates
-- regardless of current data (frontend always wrote in range, so this is
-- expected to touch 0 rows — but it makes the migration safe either way),
-- then add the bounded CHECK. CHECK is NULL-safe (NULL = "no deposit"), so
-- quotes without a deposit are unaffected.

UPDATE public.quotes
   SET deposit_pct = LEAST(100, GREATEST(0, deposit_pct))
 WHERE deposit_pct IS NOT NULL
   AND (deposit_pct < 0 OR deposit_pct > 100);

ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_deposit_pct_range;
ALTER TABLE public.quotes
  ADD CONSTRAINT quotes_deposit_pct_range
  CHECK (deposit_pct IS NULL OR (deposit_pct >= 0 AND deposit_pct <= 100));
