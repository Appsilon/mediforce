// Prompt template for generating issue titles, summaries, and suggested actions.
// All financial numbers are pre-computed and template-injected.

import type { RiskRow } from '../lib/risk-computations.js';
import { formatEur } from '../lib/format-utils.js';

export function buildIssueTitleAndSummary(row: RiskRow): {
  system: string;
  user: string;
} {
  const system = `You are a supply chain risk analyst creating issue reports. For the given SKU risk data, provide a JSON response with three fields:
- "title": concise issue title, max 80 chars (e.g., "Critical expiry risk: Herceptin 150mg at Basel")
- "riskSummary": 2-3 sentences describing the risk situation
- "suggestedActions": 2-3 bullet points of recommended actions as a single string

Use the exact financial figures provided. Respond with valid JSON only, no markdown.`;

  const user = `Create an issue report for:
SKU: ${row.skuName} at ${row.warehouseName} (${row.country})
Risk Level: ${row.riskLevel.toUpperCase()}
Expiry Risk: ${formatEur(row.expiryRiskCents)} (${row.nearestExpiryDays} days to nearest expiry)
Stockout Risk: ${formatEur(row.stockoutRiskCents)} (coverage: ${row.coverageWeeks} weeks, first stockout: week ${row.firstStockoutWeek ?? 'none'})
On Hand: ${row.onHand.toLocaleString()} units, Monthly Demand: ${row.monthlyDemand.toLocaleString()} units
Category: ${row.category}`;

  return { system, user };
}
