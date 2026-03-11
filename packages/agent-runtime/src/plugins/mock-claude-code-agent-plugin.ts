// Mock plugin for UAT — returns fixture data instantly instead of spawning Claude CLI.
// Activate with MOCK_AGENT=true env var. Preserves the full plugin pipeline
// (skill loading, prompt building, envelope extraction) — only the CLI call is skipped.

import { ClaudeCodeAgentPlugin } from './claude-code-agent-plugin.js';

interface SpawnCliOptions {
  model?: string;
  addDirs?: string[];
  logFile?: string;
  timeoutMs?: number;
  outputDir?: string;
}

/**
 * Mock fixtures keyed by skill name.
 * Each returns a JSON string matching the Claude CLI stream-json result format:
 * `{ "result": "<agent output as JSON string>" }`
 *
 * The agent output string follows the AgentOutputContract:
 * `{ "output_file": "...", "summary": "..." }` or raw JSON.
 */
const MOCK_FIXTURES: Record<string, (outputDir?: string) => string> = {
  'trial-metadata-extractor': () => JSON.stringify({
    result: JSON.stringify({
      confidence: 0.85,
      schema_version: '1.0',
      extraction_date: new Date().toISOString().slice(0, 10),
      study_id: 'MOCK-STUDY-001',
      study_title: 'Mock Phase II Clinical Trial',
      sponsor: 'Mock Pharma Inc.',
      indication: 'Mild-to-moderate condition',
      phase: 'II',
      design: 'Randomized, double-blind, placebo-controlled',
      arms: [
        { name: 'Placebo', description: 'Matching placebo' },
        { name: 'Low Dose', description: '50mg QD' },
        { name: 'High Dose', description: '100mg QD' },
      ],
      endpoints: {
        primary: ['Change from baseline in primary score at Week 24'],
        secondary: ['Change from baseline in secondary score at Week 24'],
      },
      statistical_analyses: {
        primary_analysis: [{
          endpoint: 'Primary score change',
          method: 'ANCOVA with baseline, site, and treatment',
          hypothesis: { alpha: 0.05, alternative: 'two-sided' },
        }],
      },
      summary: 'Extracted trial metadata for MOCK-STUDY-001 Phase II',
    }),
  }),

  'mock-tlg-generator': (outputDir?: string) => {
    const mockMarkdown = [
      '# Mock TLG Shell Specifications',
      '',
      '## Tables',
      '| ID | Title | Population | Dataset |',
      '|------|-------|------------|---------|',
      '| T-14.1.1 | Demographics | Safety | ADSL |',
      '| T-14.2.1 | Primary Endpoint Summary | ITT | ADLB |',
      '| T-14.2.2 | Secondary Endpoint Summary | ITT | ADLB |',
      '',
      '## Figures',
      '| ID | Title | Population | Dataset |',
      '|------|-------|------------|---------|',
      '| F-14.2.1 | Primary Endpoint Over Time | ITT | ADLB |',
      '',
      '## Listings',
      '| ID | Title | Population | Dataset |',
      '|------|-------|------------|---------|',
      '| L-16.2.1 | Adverse Events | Safety | ADAE |',
    ].join('\n');

    const outputFile = outputDir
      ? `${outputDir}/MOCK-STUDY-001-mock-tlg-shells.md`
      : '/tmp/MOCK-STUDY-001-mock-tlg-shells.md';

    // Write the mock file synchronously-ish via the result contract
    return JSON.stringify({
      result: JSON.stringify({
        output_file: outputFile,
        summary: 'Generated 3 tables, 1 figure, 1 listing for MOCK-STUDY-001 Phase II',
        _mock_file_content: mockMarkdown,
      }),
    });
  },

  'sdtm-to-adam': () => JSON.stringify({
    result: JSON.stringify({
      confidence: 0.80,
      datasets_generated: ['ADSL', 'ADAE', 'ADLB', 'ADVS'],
      code_files: ['adsl.R', 'adae.R', 'adlb.R', 'advs.R'],
      summary: 'Derived 4 ADaM datasets from SDTM data for MOCK-STUDY-001',
    }),
  }),

  'adam-to-tlg': () => JSON.stringify({
    result: JSON.stringify({
      confidence: 0.80,
      tables_generated: 3,
      figures_generated: 1,
      listings_generated: 1,
      summary: 'Generated 3 tables, 1 figure, 1 listing from ADaM datasets for MOCK-STUDY-001',
    }),
  }),
};

const DEFAULT_MOCK = () => JSON.stringify({
  result: JSON.stringify({
    confidence: 0.75,
    summary: 'Mock agent completed successfully',
    result: { mock: true },
  }),
});

export class MockClaudeCodeAgentPlugin extends ClaudeCodeAgentPlugin {
  protected override async spawnClaudeCli(
    _prompt: string,
    options?: SpawnCliOptions,
  ): Promise<string> {
    // Resolve skill name from the prompt or context
    const skillName = this.resolveSkillName(_prompt);
    const fixture = MOCK_FIXTURES[skillName] ?? DEFAULT_MOCK;
    const result = fixture(options?.outputDir);

    // For skills that produce output files, write the mock file
    try {
      const parsed = JSON.parse(result) as { result: string };
      const inner = JSON.parse(parsed.result) as Record<string, unknown>;
      if (inner._mock_file_content && inner.output_file) {
        const { writeFile: writeFileFn, mkdir: mkdirFn } = await import('node:fs/promises');
        const { dirname } = await import('node:path');
        await mkdirFn(dirname(inner.output_file as string), { recursive: true });
        await writeFileFn(inner.output_file as string, inner._mock_file_content as string, 'utf-8');
        // Remove the internal field from the result
        delete inner._mock_file_content;
        parsed.result = JSON.stringify(inner);
        return JSON.stringify(parsed);
      }
    } catch {
      // Not a file-producing skill, return as-is
    }

    // Simulate a short delay so the UI shows the step is running briefly
    await new Promise((resolve) => setTimeout(resolve, 1500));

    console.log(`[mock-agent] Returning fixture for skill '${skillName}'`);
    return result;
  }

  /** Extract skill name from the prompt — looks for the skill marker in the assembled prompt. */
  private resolveSkillName(prompt: string): string {
    // The prompt includes the skill content from SKILL.md, but the skill name
    // is set in agentConfig. Access it from the stored context.
    const skill = (this as unknown as { agentConfig: { skill?: string } }).agentConfig?.skill;
    if (skill) return skill;

    // Fallback: try to extract from prompt content
    for (const name of Object.keys(MOCK_FIXTURES)) {
      if (prompt.toLowerCase().includes(name.replace(/-/g, ' '))) return name;
    }
    return 'unknown';
  }
}
