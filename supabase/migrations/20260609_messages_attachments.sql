-- Add file-attachment fields to the messages table.
--
-- Before this, broker ↔ shop file sharing happened in two separate places:
--   - Paperwork tab (broker-uploaded W-9s, resale certs)
--   - Job Files tab (shop-produced order PDFs)
--
-- Both have been folded into the Messages tab — every shared file now
-- rides along on a message, so there's one inbox both sides watch instead
-- of three siloed lists. The Message row stores a public URL + the
-- original filename for display.
--
-- Files are stored in the same Supabase bucket used elsewhere
-- (uploadFile helper); only the URL + name live on the row. NOT NULL
-- isn't set so a message can still be body-only.

alter table messages
  add column if not exists attachment_url  text,
  add column if not exists attachment_name text;

comment on column messages.attachment_url is
  'Public URL of an optional file attached to this message. Null when the message is body-only.';
comment on column messages.attachment_name is
  'Original filename of the attached file, shown to the recipient. Null when there is no attachment.';
