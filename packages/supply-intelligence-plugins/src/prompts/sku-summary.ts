// Prompt template for SKU+warehouse level risk summaries.
// All financial numbers are pre-computed and template-injected.

import type { RiskRow } from '../lib/risk-computations.js';
import { formatEur } from '../lib/format-utils.js';

export function buildSkuSummaryPrompt(row: RiskRow): {
  system: string;
  user: string;
} {
  const system = `You are a supply chain risk analyst. Write concise, actionable summaries.
Use the exact financial figures provided — never recalculate or round them.
Write 2-3 sentences covering: risk explanation (why this risk level) and suggested action (what to do).
Tone: operational, direct, tells the reader what to do next.`;

  const user = `Summarize the risk situation for:
SKU: ${row.skuName} at ${row.warehouseName} (${row.country})
Risk Level: ${row.riskLevel.toUpperCase()}
Expiry Risk: ${formatEur(row.expiryRiskCents)} (${row.nearestExpiryDays} days to nearest expiry, ${row.batchCount} batches)
Stockout Risk: ${formatEur(row.stockoutRiskCents)} (coverage: ${row.coverageWeeks} weeks, first stockout: week ${row.firstStockoutWeek ?? 'none'})
On Hand: ${row.onHand.toLocaleString()} units, Monthly Demand: ${row.monthlyDemand.toLocaleString()} units
Category: ${row.category}`;

  return { system, user };
}
