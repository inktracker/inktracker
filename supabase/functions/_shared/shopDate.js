// The calendar date of a moment in the SHOP's timezone — what QuickBooks
// should record as TxnDate. UTC dates put an evening payment on the next day.
//
// Timezone: shops.timezone, else by the shop's state (primary zone), else
// Pacific (every current shop is US West; revisit if that changes).

const STATE_TZ = {
  AK: "America/Anchorage", AL: "America/Chicago", AR: "America/Chicago", AZ: "America/Phoenix",
  CA: "America/Los_Angeles", CO: "America/Denver", CT: "America/New_York", DC: "America/New_York",
  DE: "America/New_York", FL: "America/New_York", GA: "America/New_York", HI: "Pacific/Honolulu",
  IA: "America/Chicago", ID: "America/Boise", IL: "America/Chicago", IN: "America/Indiana/Indianapolis",
  KS: "America/Chicago", KY: "America/New_York", LA: "America/Chicago", MA: "America/New_York",
  MD: "America/New_York", ME: "America/New_York", MI: "America/Detroit", MN: "America/Chicago",
  MO: "America/Chicago", MS: "America/Chicago", MT: "America/Denver", NC: "America/New_York",
  ND: "America/Chicago", NE: "America/Chicago", NH: "America/New_York", NJ: "America/New_York",
  NM: "America/Denver", NV: "America/Los_Angeles", NY: "America/New_York", OH: "America/New_York",
  OK: "America/Chicago", OR: "America/Los_Angeles", PA: "America/New_York", RI: "America/New_York",
  SC: "America/New_York", SD: "America/Chicago", TN: "America/Chicago", TX: "America/Chicago",
  UT: "America/Denver", VA: "America/New_York", VT: "America/New_York", WA: "America/Los_Angeles",
  WI: "America/Chicago", WV: "America/New_York", WY: "America/Denver",
};

export const DEFAULT_SHOP_TZ = "America/Los_Angeles";

function validTz(tz) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** @param {{ timezone?: string|null, state?: string|null }} shop */
export function shopTimezone(shop) {
  const tz = String(shop?.timezone ?? "").trim();
  if (tz && validTz(tz)) return tz;
  return STATE_TZ[String(shop?.state ?? "").trim().toUpperCase()] ?? DEFAULT_SHOP_TZ;
}

/** YYYY-MM-DD of `iso` in `tz`. Falls back to the UTC date on bad input. */
export function localDate(iso, tz) {
  const d = new Date(iso ?? Date.now());
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}
