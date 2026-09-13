export function cycleSummary(params: {
  daysSinceHalving?: number | null;
  priceVs200d?: number | null;
  supplyInProfit?: number | null;
}) {
  const { daysSinceHalving, priceVs200d, supplyInProfit } = params;
  const phase =
    daysSinceHalving == null
      ? "Unknown"
      : daysSinceHalving < 180
        ? "Early cycle"
        : daysSinceHalving < 540
          ? "Mid cycle"
          : "Late cycle";
  return {
    phase,
    daysSinceHalving,
    priceVs200d,
    supplyInProfit,
  };
}
