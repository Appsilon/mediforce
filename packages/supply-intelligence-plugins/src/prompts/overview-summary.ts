// Prompt template for the overall overview risk summary.
// KPI totals, category breakdown, and top-5 riskiest pairs are template-injected.

import type {
  RiskRow,
  OverviewKpis,
  CategoryAggregation,
} from '../lib/risk-computations.js';
import { formatEur } from '../lib/format-utils.js';

export function buildOverviewSummaryPrompt(
  kpis: OverviewKpis,
  categories: CategoryAggregation[],
  riskRows: RiskRow[],
): { system: string; user: string } {
  const system = `You are a supply chain risk analyst. Write concise, actionable summaries.
Use the exact financial figures provided — never recalculate or round them.
Write one paragraph (4-6 sentences) summarizing the overall supply chain risk situation.
Cover the biggest risks and recommended immediate actions.
Tone: operational, direct, tells the reader what to do next.`;

  // Category breakdown
  const categoryLines = categories
    .map(
      (c) =>
        `${c.category}: expiry ${formatEur(c.totalExpiryRiskCents)}, stockout ${formatEur(c.totalStockoutRiskCents)} (${c.pairCount} pairs)`,
    )
    .join('\n  ');

  // Top 5 riskiest SKU+WH pairs
  const top5 = [...riskRows]
    .sort(
      (a, b) =>
        b.expiryRiskCents +
        b.stockoutRiskCents -
        (a.expiryRiskCents + a.stockoutRiskCents),
    )
    .slice(0, 5)
    .map(
      (r) =>
        `${r.skuName} at ${r.warehouseName} (${r.riskLevel.toUpperCase()}): expiry ${formatEur(r.expiryRiskCents)}, stockout ${formatEur(r.stockoutRiskCents)}`,
    )
    .join('\n  ');

  const user = `Summarize the overall supply chain risk situation:
Total Expiry Risk: ${formatEur(kpis.totalExpiryRiskCents)}
Total Stockout Risk: ${formatEur(kpis.totalStockoutRiskCents)}
Total SKU+Warehouse Pairs: ${kpis.totalPairs}
Risk Distribution: ${kpis.redCount} red (${kpis.redPercentage}%), ${kpis.orangeCount} orange, ${kpis.greenCount} green
Batches Expiring Within 90 Days: ${kpis.batchesUnder90Days}
Category Breakdown:
  ${categoryLines}
Top 5 Riskiest SKU+Warehouse Pairs:
  ${top5}`;

  return { system, user };
}
