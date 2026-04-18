export const getDateRangeValues = (range) => {
  const today = new Date();
  const currentDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  
  switch (range) {
    case "today":
      return { dateFrom: currentDate.toISOString().split('T')[0], dateTo: currentDate.toISOString().split('T')[0] };
    case "yesterday": {
      const yesterday = new Date(currentDate);
      yesterday.setDate(yesterday.getDate() - 1);
      return { dateFrom: yesterday.toISOString().split('T')[0], dateTo: yesterday.toISOString().split('T')[0] };
    }
    case "thisWeek": {
      const startOfWeek = new Date(currentDate);
      startOfWeek.setDate(currentDate.getDate() - currentDate.getDay());
      return { dateFrom: startOfWeek.toISOString().split('T')[0], dateTo: currentDate.toISOString().split('T')[0] };
    }
    case "lastWeek": {
      const startOfLastWeek = new Date(currentDate);
      startOfLastWeek.setDate(currentDate.getDate() - currentDate.getDay() - 7);
      const endOfLastWeek = new Date(startOfLastWeek);
      endOfLastWeek.setDate(startOfLastWeek.getDate() + 6);
      return { dateFrom: startOfLastWeek.toISOString().split('T')[0], dateTo: endOfLastWeek.toISOString().split('T')[0] };
    }
    case "thisMonth": {
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      return { dateFrom: startOfMonth.toISOString().split('T')[0], dateTo: currentDate.toISOString().split('T')[0] };
    }
    case "lastMonth": {
      const startOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const endOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);
      return { dateFrom: startOfLastMonth.toISOString().split('T')[0], dateTo: endOfLastMonth.toISOString().split('T')[0] };
    }
    case "last3Months": {
      const threeMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 3, today.getDate());
      return { dateFrom: threeMonthsAgo.toISOString().split('T')[0], dateTo: currentDate.toISOString().split('T')[0] };
    }
    case "last6Months": {
      const sixMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 6, today.getDate());
      return { dateFrom: sixMonthsAgo.toISOString().split('T')[0], dateTo: currentDate.toISOString().split('T')[0] };
    }
    case "last12Months":
    case "lastYear": {
      const lastYearDate = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
      return { dateFrom: lastYearDate.toISOString().split('T')[0], dateTo: currentDate.toISOString().split('T')[0] };
    }
    case "thisYear": {
      const startOfYear = new Date(today.getFullYear(), 0, 1);
      return { dateFrom: startOfYear.toISOString().split('T')[0], dateTo: currentDate.toISOString().split('T')[0] };
    }
    default:
      return { dateFrom: "", dateTo: "" };
  }
};