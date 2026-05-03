# InkTracker — TODO

## Bugs / cleanup

### Broker-quote counter includes converted quotes
**File:** `src/pages/Dashboard.jsx` line 303

```js
// current:
const brokerQuotes = quotes.filter(q => q.broker_id).length;

// fix:
const brokerQuotes = quotes.filter(q => q.broker_id && q.status !== "Converted to Order").length;
```

Also consider filtering `quotes.slice(0, 6)` in the Recent Quotes list (line 402) so converted quotes don't show there either — right now they're clickable but link to `/Quotes?id=...` where the Quotes page filters them out, so the click goes nowhere.

**Context:** A test broker quote (Q-2026-275 "TEST CLIENT") was showing as 1 broker quote on the dashboard even after it converted to an order. Quote row was deleted manually from Supabase on 2026-04-23 as a quick fix. The proper fix above prevents it from happening again with future converted quotes.
