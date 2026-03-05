// Prompt template for category-level risk summaries.
// Aggregated risk data and top-3 riskiest pairs are template-injected.

import type {
  RiskRow,
  CategoryAggregation,
} from '../lib/risk-computations.js';
import { formatEur } from '../lib/format-utils.js';

export function buildCategorySummaryPrompt(
  cat: CategoryAggregation,
  categoryRows: RiskRow[],
): { system: string; user: string } {
  const system = `You are a supply chain risk analyst. Write concise, actionable summaries.
Use the exact financial figures provided — never recalculate or round them.
Write 3-4 sentences covering: category risk overview and suggested priorities.
Tone: operational, direct, tells the reader what to do next.`;

  // Risk level breakdown
  const redCount = categoryRows.filter((r) => r.riskLevel === 'red').length;
  const orangeCount = categoryRows.filter(
    (r) => r.riskLevel === 'orange',
  ).length;
  const greenCount = categoryRows.filter(
    (r) => r.riskLevel === 'green',
  ).length;

  // Top 3 riskiest pairs by total risk (expiry + stockout)
  const top3 = [...categoryRows]
    .sort(
      (a, b) =>
        b.expiryRiskCents +
        b.stockoutRiskCents -
        (a.expiryRiskCents + a.stockoutRiskCents),
    )
    .slice(0, 3)
    .map(
      (r) =>
        `${r.skuName} at ${r.warehouseName}: expiry ${formatEur(r.expiryRiskCents)}, stockout ${formatEur(r.stockoutRiskCents)}`,
    )
    .join('\n  ');

  const user = `Summarize the risk situation for category: ${cat.category}
Total Expiry Risk: ${formatEur(cat.totalExpiryRiskCents)}
Total Stockout Risk: ${formatEur(cat.totalStockoutRiskCents)}
SKU+Warehouse Pairs: ${cat.pairCount}
Risk Breakdown: ${redCount} red, ${orangeCount} orange, ${greenCount} green
Top 3 Riskiest Pairs:
  ${top3}`;

  return { system, user };
}
