-- Sync shops.shop_name from the owner's canonical profiles.shop_name.
--
-- The Account page edits profiles.shop_name (and the app displays it
-- everywhere), but shops.shop_name was only ever written at shop-create. A
-- later rename left the shops mirror stale, and the quote email read it —
-- so a shop that renamed kept emailing under its OLD brand name (Justin
-- Brooke: profile "Proper Stitch" but emails showed "Truman Embroidery Co.").
--
-- Going forward Account.handleSave keeps shops.shop_name in sync and the email
-- prefers profiles.shop_name; this backfills existing drift. Safe + owner-
-- scoped: only updates shops whose owner profile has a non-empty name that
-- differs from the mirror.

update shops s
set shop_name = p.shop_name
from profiles p
where p.email = s.owner_email
  and nullif(btrim(p.shop_name), '') is not null
  and btrim(coalesce(s.shop_name, '')) is distinct from btrim(p.shop_name);
