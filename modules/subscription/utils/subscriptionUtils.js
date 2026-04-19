// Calculate subscription end date
exports.calculateEndDate = (startDate, durationMonths, trialPeriodDays) => {
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + durationMonths);
    if (trialPeriodDays > 0) endDate.setDate(endDate.getDate() + trialPeriodDays);
    return endDate;
  };
  