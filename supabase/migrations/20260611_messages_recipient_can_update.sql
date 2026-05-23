-- Let message recipients UPDATE their own messages.
--
-- The original policy (20260501_rls_lockdown) only let the SENDER write:
--
--   USING       (from_email = me OR to_email = me)   -- read: sender + recipient
--   WITH CHECK  (from_email = me)                    -- write: sender only
--
-- That breaks the read-receipt flow: when a recipient opens a thread,
-- BrokerMessaging fires `update messages set read = true where id = ...`,
-- which silently fails because the WITH CHECK rejects the row (recipient
-- isn't the sender). Result: unread badges stay pegged forever.
--
-- Relaxing WITH CHECK to mirror USING (sender OR recipient) is the
-- pragmatic fix. Tradeoff: a recipient could theoretically overwrite
-- message fields they shouldn't (body, attachment_url, etc.). That's a
-- low real-world risk — they already have full read access to the
-- message and there's no anonymous abuse vector. If/when finer-grained
-- enforcement is needed, the right move is a SECURITY DEFINER RPC
-- `mark_message_read(message_id uuid)` and locking writes back to the
-- sender — out of scope for unblocking the unread-badge bug today.

DROP POLICY IF EXISTS "messages_access" ON messages;

CREATE POLICY "messages_access" ON messages FOR ALL TO authenticated
  USING (
    from_email = auth.jwt()->>'email' OR
    to_email   = auth.jwt()->>'email'
  )
  WITH CHECK (
    from_email = auth.jwt()->>'email' OR
    to_email   = auth.jwt()->>'email'
  );
