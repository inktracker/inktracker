-- The client-priced total that was pushed to the broker's QuickBooks when the
-- broker→client invoice was minted. Stored so a customer-facing surface can tell
-- when the quote has been edited since (client_total now differs) and the pay
-- link therefore points at a stale invoice amount — the broker analogue of the
-- shop-side qb_total / isQbStale guard, which the broker client pay link lacked.
-- Null on pre-existing broker invoices (treated as "can't tell → not stale").
alter table quotes add column if not exists qb_broker_client_invoice_total numeric;
