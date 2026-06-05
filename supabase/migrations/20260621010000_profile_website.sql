-- Add a `website` column to profiles. Surfaced as an editable field in
-- both the shop's Account page and the broker's Profile panel, and
-- used by the Art Proof PDF footer so a shop's proofs link back to
-- their own URL instead of the platform's biotamfg.com.
--
-- BrokerProfile.jsx has been reading/writing `user.website` for some
-- time already; until now that field was silently dropped on save
-- because the column didn't exist. This migration unblocks the broker
-- save AND wires the shop side to the same column.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS website TEXT;
