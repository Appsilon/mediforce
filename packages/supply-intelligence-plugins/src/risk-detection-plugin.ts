// RiskDetectionPlugin — scans for red-flagged SKU+warehouse pairs and creates
// draft issues in Firestore for Phase 14's issue management UI.
//
// For each red pair: computes priority score, builds flag reason, calls LLM for
// title/summary/actions, writes draft issue to draftIssues collection.

import type { AgentPlugin, AgentContext, EmitFn } from '@mediforce/agent-runtime';
import type { PluginCapabilityMetadata } from '@mediforce/platform-core';
import { fetchAllSupplyData } from './lib/supply-data-fetcher.js';
import { computeAllRiskRows, type RiskRow } from './lib/risk-computations.js';
import { writeDraftIssue, clearDraftIssues, type DraftIssue } from './lib/issue-writer.js';
import { computePriorityScore, buildFlagReason } from './lib/priority-score.js';
import { buildIssueTitleAndSummary } from './prompts/issue-summary.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Process items in batches of `batchSize` to limit concurrent LLM calls.
 */
async function processBatch<T>(
  items: T[],
  batchSize: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    await Promise.all(chunk.map(fn));
  }
}

interface LlmIssueResponse {
  title: string;
  riskSummary: string;
  suggestedActions: string;
}

/**
 * Parse the LLM response JSON. Falls back to defaults on parse failure.
 */
function parseLlmIssueResponse(
  content: string,
  row: RiskRow,
  reason: string,
): LlmIssueResponse {
  try {
    const parsed = JSON.parse(content);
    return {
      title:
        typeof parsed.title === 'string'
          ? parsed.title.slice(0, 80)
          : `Risk alert: ${row.skuName} at ${row.warehouseName}`,
      riskSummary:
        typeof parsed.riskSummary === 'string' ? parsed.riskSummary : reason,
      suggestedActions:
        typeof parsed.suggestedActions === 'string'
          ? parsed.suggestedActions
          : 'Review risk data and take appropriate action.',
    };
  } catch {
    return {
      title: `Risk alert: ${row.skuName} at ${row.warehouseName}`,
      riskSummary: reason,
      suggestedActions: 'Review risk data and take appropriate action.',
    };
  }
}

// ─── Plugin ─────────────────────────────────────────────────────────────────

export class RiskDetectionPlugin implements AgentPlugin {
  readonly metadata: PluginCapabilityMetadata = {
    name: 'Risk Detection',
    description: 'Detects high-risk SKU-warehouse combinations and creates draft issues',
    inputDescription: 'App context with supply chain data',
    outputDescription: 'Draft issues for red-risk SKU-warehouse pairs',
    roles: ['executor'],
    foundationModel: 'Claude Sonnet 4',
  };

  private context!: AgentContext;

  async initialize(context: AgentContext): Promise<void> {
    this.context = context;
  }

  async run(emit: EmitFn): Promise<void> {
    const startedAt = Date.now();
    let lastModel = 'anthropic/claude-sonnet-4';

    // 1. Fetch supply data
    await emit({
      type: 'status',
      payload: 'Scanning for risk threshold breaches...',
      timestamp: new Date().toISOString(),
    });

    const data = await fetchAllSupplyData();

    // 2. Compute risk rows
    const riskRows = computeAllRiskRows(
      data.skus,
      data.warehouses,
      data.batches,
      data.shipments,
      data.forecasts,
      data.config,
    );

    // 3. Filter to red rows only
    const redRows = riskRows.filter((r) => r.riskLevel === 'red');

    await emit({
      type: 'status',
      payload: `Found ${redRows.length} items exceeding risk thresholds...`,
      timestamp: new Date().toISOString(),
    });

    // 4. Clear stale draft issues before writing new ones
    await clearDraftIssues();

    // 5. Process red rows in batches of 5
    await processBatch(redRows, 5, async (row: RiskRow) => {
      // a. Compute priority score
      const priorityScore = computePriorityScore(row);

      // b. Build flag reason
      const reason = buildFlagReason(row, data.config);

      // c. Build issue prompt and call LLM
      const { system, user } = buildIssueTitleAndSummary(row);
      const llmRes = await this.context.llm.complete([
        { role: 'system', content: system },
        { role: 'user', content: user },
      ]);
      lastModel = llmRes.model;

      // d. Parse LLM response
      const { title, riskSummary, suggestedActions } = parseLlmIssueResponse(
        llmRes.content,
        row,
        reason,
      );

      // e. Write draft issue to Firestore
      const issue: DraftIssue = {
        id: `issue:${row.skuId}|${row.warehouseId}`,
        skuId: row.skuId,
        warehouseId: row.warehouseId,
        skuName: row.skuName,
        warehouseName: row.warehouseName,
        country: row.country,
        category: row.category,
        title,
        riskSummary,
        suggestedActions,
        reason,
        impactEstimateCents: row.expiryRiskCents + row.stockoutRiskCents,
        priorityScore,
        riskLevel: 'red',
        expiryRiskCents: row.expiryRiskCents,
        stockoutRiskCents: row.stockoutRiskCents,
        nearestExpiryDays: row.nearestExpiryDays,
        status: 'suggested',
        createdAt: new Date().toISOString(),
        agentRunId: this.context.processInstanceId,
      };

      await writeDraftIssue(issue);

      // f. Emit annotation for this issue
      await emit({
        type: 'annotation',
        payload: {
          skuId: row.skuId,
          warehouseId: row.warehouseId,
          type: 'draft-issue',
          title,
          priorityScore,
        },
        timestamp: new Date().toISOString(),
      });
    });

    // 6. Emit result event (matches AgentOutputEnvelopeSchema)
    await emit({
      type: 'result',
      payload: {
        confidence: 0.95,
        reasoning_summary: `Created ${redRows.length} draft issues for red-flagged SKU+warehouse pairs`,
        reasoning_chain: [
          'Fetched supply data from Firestore',
          `Computed ${riskRows.length} risk rows`,
          `Identified ${redRows.length} red-flagged pairs`,
          'Generated issue titles and summaries via LLM',
          'Wrote draft issues to draftIssues collection',
        ],
        annotations: [],
        model: lastModel,
        duration_ms: Date.now() - startedAt,
        result: {
          issueCount: redRows.length,
          totalRiskRows: riskRows.length,
        },
      },
      timestamp: new Date().toISOString(),
    });
  }
}
