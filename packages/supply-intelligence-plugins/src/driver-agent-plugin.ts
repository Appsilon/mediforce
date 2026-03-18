// DriverAgentPlugin — generates natural-language risk summaries at three levels:
// 1. SKU+warehouse pair (per RiskRow)
// 2. Therapeutic category (aggregated)
// 3. Overall overview (KPI totals)
//
// All financial numbers are pre-computed and template-injected into prompts.
// The LLM generates narrative only — never recalculates numbers.

import type { AgentPlugin, AgentContext, EmitFn } from '@mediforce/agent-runtime';
import type { PluginCapabilityMetadata } from '@mediforce/platform-core';
import { fetchAllSupplyData } from './lib/supply-data-fetcher.js';
import {
  computeAllRiskRows,
  computeOverviewKpis,
  aggregateByCategory,
  type RiskRow,
} from './lib/risk-computations.js';
import { writeSummary, clearStaleSummaries } from './lib/summary-cache.js';
import { buildSkuSummaryPrompt } from './prompts/sku-summary.js';
import { buildCategorySummaryPrompt } from './prompts/category-summary.js';
import { buildOverviewSummaryPrompt } from './prompts/overview-summary.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Process items in batches of `batchSize` to limit concurrent LLM calls.
 */
async function processBatch<T>(
  items: T[],
  batchSize: number,
  fn: (item: T) => Promise<void>,
  onBatchDone?: (completed: number, total: number) => Promise<void>,
): Promise<void> {
  let completed = 0;
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    await Promise.all(chunk.map(fn));
    completed += chunk.length;
    if (onBatchDone) await onBatchDone(completed, items.length);
  }
}

// ─── Plugin ─────────────────────────────────────────────────────────────────

export class DriverAgentPlugin implements AgentPlugin {
  readonly metadata: PluginCapabilityMetadata = {
    name: 'Driver Agent',
    description: 'Generates risk analysis narratives for supply chain data',
    inputDescription: 'App context with supply chain data references',
    outputDescription: 'Risk narratives for SKUs, categories, and overview with markdown formatting',
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

    // 1. Fetch all supply data
    await emit({
      type: 'status',
      payload: 'Fetching supply chain data...',
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

    // 3. Generate SKU-level summaries (batched, 5 concurrent)
    await emit({
      type: 'status',
      payload: `Generating ${riskRows.length} SKU risk summaries...`,
      timestamp: new Date().toISOString(),
    });

    // Clear stale SKU summaries before regeneration
    await clearStaleSummaries('sku-pair');

    await processBatch(riskRows, 5, async (row: RiskRow) => {
      const { system, user } = buildSkuSummaryPrompt(row);
      const llmRes = await this.context.llm.complete([
        { role: 'system', content: system },
        { role: 'user', content: user },
      ]);
      lastModel = llmRes.model;

      await writeSummary({
        id: `sku:${row.skuId}|${row.warehouseId}`,
        scope: 'sku-pair',
        scopeKey: `${row.skuId}|${row.warehouseId}`,
        narrative: llmRes.content,
        generatedAt: new Date().toISOString(),
        agentRunId: this.context.processInstanceId,
        model: llmRes.model,
      });
    }, async (completed, total) => {
      await emit({
        type: 'progress',
        payload: { current: completed, total, label: 'SKU risk summaries' },
        timestamp: new Date().toISOString(),
      });
    });

    // 4. Generate category summaries
    await emit({
      type: 'status',
      payload: 'Generating category summaries...',
      timestamp: new Date().toISOString(),
    });

    const categories = aggregateByCategory(riskRows);

    // Clear stale category summaries
    await clearStaleSummaries('category');

    for (const cat of categories) {
      const categoryRows = riskRows.filter((r) => r.category === cat.category);
      const { system, user } = buildCategorySummaryPrompt(cat, categoryRows);
      const llmRes = await this.context.llm.complete([
        { role: 'system', content: system },
        { role: 'user', content: user },
      ]);
      lastModel = llmRes.model;

      await writeSummary({
        id: `category:${cat.category}`,
        scope: 'category',
        scopeKey: cat.category,
        narrative: llmRes.content,
        generatedAt: new Date().toISOString(),
        agentRunId: this.context.processInstanceId,
        model: llmRes.model,
      });
    }

    // 5. Generate overview summary
    await emit({
      type: 'status',
      payload: 'Generating overview summary...',
      timestamp: new Date().toISOString(),
    });

    const kpis = computeOverviewKpis(riskRows);

    // Clear stale overview summaries
    await clearStaleSummaries('overview');

    const { system: overviewSystem, user: overviewUser } =
      buildOverviewSummaryPrompt(kpis, categories, riskRows);
    const overviewRes = await this.context.llm.complete([
      { role: 'system', content: overviewSystem },
      { role: 'user', content: overviewUser },
    ]);
    lastModel = overviewRes.model;

    await writeSummary({
      id: 'overview',
      scope: 'overview',
      scopeKey: 'overview',
      narrative: overviewRes.content,
      generatedAt: new Date().toISOString(),
      agentRunId: this.context.processInstanceId,
      model: overviewRes.model,
    });

    // 6. Emit result event (matches AgentOutputEnvelopeSchema)
    await emit({
      type: 'result',
      payload: {
        confidence: 0.9,
        reasoning_summary: `Generated ${riskRows.length} SKU summaries, ${categories.length} category summaries, and 1 overview summary`,
        reasoning_chain: [
          'Fetched supply data from Firestore',
          `Computed ${riskRows.length} risk rows`,
          `Generated ${riskRows.length} SKU-level narratives`,
          `Generated ${categories.length} category-level narratives`,
          'Generated 1 overview narrative',
          'Cached all summaries to agentSummaries collection',
        ],
        annotations: [],
        model: lastModel,
        duration_ms: Date.now() - startedAt,
        result: {
          skuSummaryCount: riskRows.length,
          categorySummaryCount: categories.length,
          overviewGenerated: true,
        },
      },
      timestamp: new Date().toISOString(),
    });
  }
}
