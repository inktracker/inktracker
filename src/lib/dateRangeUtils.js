// Serialize a Date's LOCAL calendar date as YYYY-MM-DD. Never use
// toISOString() for this: it converts to UTC first, so for any shop east
// of UTC (Berlin/Sydney/Tokyo are all offered in SHOP_TIMEZONE_OPTIONS)
// a local midnight serializes as the PREVIOUS day — "This Month" started
// on the last day of last month and excluded today's rows. West-of-UTC
// browsers hit the mirror image after ~5pm.
export const localDateStr = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const getDateRangeValues = (range) => {
  const today = new Date();
  const currentDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  
  switch (range) {
    case "today":
      return { dateFrom: localDateStr(currentDate), dateTo: localDateStr(currentDate) };
    case "yesterday": {
      const yesterday = new Date(currentDate);
      yesterday.setDate(yesterday.getDate() - 1);
      return { dateFrom: localDateStr(yesterday), dateTo: localDateStr(yesterday) };
    }
    case "thisWeek": {
      const startOfWeek = new Date(currentDate);
      startOfWeek.setDate(currentDate.getDate() - currentDate.getDay());
      return { dateFrom: localDateStr(startOfWeek), dateTo: localDateStr(currentDate) };
    }
    case "lastWeek": {
      const startOfLastWeek = new Date(currentDate);
      startOfLastWeek.setDate(currentDate.getDate() - currentDate.getDay() - 7);
      const endOfLastWeek = new Date(startOfLastWeek);
      endOfLastWeek.setDate(startOfLastWeek.getDate() + 6);
      return { dateFrom: localDateStr(startOfLastWeek), dateTo: localDateStr(endOfLastWeek) };
    }
    case "thisMonth": {
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      return { dateFrom: localDateStr(startOfMonth), dateTo: localDateStr(currentDate) };
    }
    case "lastMonth": {
      const startOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const endOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);
      return { dateFrom: localDateStr(startOfLastMonth), dateTo: localDateStr(endOfLastMonth) };
    }
    case "last3Months": {
      const threeMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 3, today.getDate());
      return { dateFrom: localDateStr(threeMonthsAgo), dateTo: localDateStr(currentDate) };
    }
    case "last6Months": {
      const sixMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 6, today.getDate());
      return { dateFrom: localDateStr(sixMonthsAgo), dateTo: localDateStr(currentDate) };
    }
    case "last12Months":
    case "lastYear": {
      const lastYearDate = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
      return { dateFrom: localDateStr(lastYearDate), dateTo: localDateStr(currentDate) };
    }
    case "thisYear": {
      const startOfYear = new Date(today.getFullYear(), 0, 1);
      return { dateFrom: localDateStr(startOfYear), dateTo: localDateStr(currentDate) };
    }
    default:
      return { dateFrom: "", dateTo: "" };
  }
};