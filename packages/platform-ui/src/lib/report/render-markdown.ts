import type { RunReportData, ReportStep } from './assemble-report.js';

function escapeMarkdown(text: string): string {
  return text.replace(/[|]/g, '\\|');
}

function statusEmoji(status: string): string {
  const map: Record<string, string> = {
    completed: '\u2705',
    running: '\u23f3',
    pending: '\u26aa',
    failed: '\u274c',
    escalated: '\u26a0\ufe0f',
    paused: '\u23f8\ufe0f',
  };
  return map[status] ?? '\u2753';
}

function instanceStatusLabel(status: string): string {
  const map: Record<string, string> = {
    created: '\ud83d\udfe1 Created',
    running: '\ud83d\udfe2 Running',
    paused: '\ud83d\udfe1 Paused',
    completed: '\u2705 Completed',
    failed: '\ud83d\udd34 Failed',
  };
  return map[status] ?? status;
}

function executorLabel(type: string): string {
  const map: Record<string, string> = {
    human: '\ud83d\udc64 Human',
    agent: '\ud83e\udd16 AI Agent',
    script: '\u2699\ufe0f Script',
    cowork: '\ud83e\udd1d Cowork',
  };
  return map[type] ?? type;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

function truncateJson(value: unknown, maxLines: number): string {
  const full = JSON.stringify(value, null, 2);
  const lines = full.split('\n');
  if (lines.length <= maxLines) return full;
  return lines.slice(0, maxLines).join('\n') + '\n...';
}

function renderStepSection(step: ReportStep, index: number): string {
  const lines: string[] = [];

  const durationStr = step.durationMs !== null
    ? ` (${formatDurationCompact(step.durationMs)})`
    : '';

  lines.push(
    `### ${index + 1}. ${statusEmoji(step.status)} ${step.name}${durationStr}`,
  );
  lines.push('');

  // Metadata line
  const meta: string[] = [];
  meta.push(`**Status:** ${step.status}`);
  meta.push(`**Executor:** ${executorLabel(step.executorType)}`);
  if (step.agentOutput?.model && step.agentOutput.model !== 'script') {
    meta.push(`**Model:** \`${step.agentOutput.model}\``);
  }
  if (
    step.agentOutput?.confidence !== undefined &&
    step.agentOutput?.confidence !== null &&
    step.agentOutput?.model !== 'script'
  ) {
    const pct = Math.round(step.agentOutput.confidence * 100);
    meta.push(`**Confidence:** ${pct}%`);
    if (step.agentOutput.confidence_rationale) {
      meta.push(`*${step.agentOutput.confidence_rationale}*`);
    }
  }
  lines.push(meta.join(' | '));
  lines.push('');

  // Timing
  if (step.startedAt) {
    lines.push(
      `> Started: ${formatTimestamp(step.startedAt)}` +
        (step.completedAt ? ` \u2192 Completed: ${formatTimestamp(step.completedAt)}` : ''),
    );
    lines.push('');
  }

  // Error
  if (step.error) {
    lines.push('**Error:**');
    lines.push('```');
    lines.push(step.error);
    lines.push('```');
    lines.push('');
  }

  // Review verdicts
  if (step.reviewVerdicts && step.reviewVerdicts.length > 0) {
    lines.push('**Review Verdicts:**');
    for (const verdict of step.reviewVerdicts) {
      const comment = verdict.comment ? ` \u2014 ${verdict.comment}` : '';
      lines.push(
        `- **${verdict.verdict}** by ${verdict.reviewerId} (${verdict.reviewerRole})${comment}`,
      );
    }
    lines.push('');
  }

  // Input
  if (Object.keys(step.input).length > 0) {
    lines.push('<details><summary>Input</summary>');
    lines.push('');
    lines.push('```json');
    lines.push(truncateJson(step.input, 30));
    lines.push('```');
    lines.push('</details>');
    lines.push('');
  }

  // Output
  if (step.output !== null && Object.keys(step.output).length > 0) {
    lines.push('<details><summary>Output</summary>');
    lines.push('');
    lines.push('```json');
    lines.push(truncateJson(step.output, 30));
    lines.push('```');
    lines.push('</details>');
    lines.push('');
  }

  // Git metadata
  const git = step.agentOutput?.gitMetadata;
  if (git) {
    lines.push('**Git:**');
    lines.push(`- Branch: \`${git.branch}\``);
    lines.push(`- Commit: [\`${git.commitSha.slice(0, 7)}\`](${git.repoUrl}/commit/${git.commitSha})`);
    if (git.changedFiles.length > 0) {
      lines.push(`- Changed files (${git.changedFiles.length}):`);
      for (const file of git.changedFiles) {
        lines.push(`  - \`${file}\``);
      }
    }
    lines.push('');
  }

  // Audit trail for this step
  if (step.auditEvents.length > 0) {
    lines.push('<details><summary>Audit Trail</summary>');
    lines.push('');
    lines.push('| Time | Action | Description |');
    lines.push('|------|--------|-------------|');
    for (const event of step.auditEvents.slice(0, 10)) {
      const time = formatTimestamp(event.timestamp).split(' ')[1] ?? '';
      lines.push(
        `| ${time} | ${escapeMarkdown(event.action)} | ${escapeMarkdown(event.description)} |`,
      );
    }
    if (step.auditEvents.length > 10) {
      lines.push(`| ... | *${step.auditEvents.length - 10} more events* | |`);
    }
    lines.push('</details>');
    lines.push('');
  }

  return lines.join('\n');
}

function formatDurationCompact(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

export function renderMarkdown(report: RunReportData): string {
  const lines: string[] = [];

  // Header
  lines.push(`# ${report.definitionName} \u2014 Run Report`);
  lines.push('');

  // Status banner for non-completed runs
  if (report.summary.status !== 'completed') {
    lines.push(
      `> **${instanceStatusLabel(report.summary.status)}** \u2014 This report reflects the current state of the run.`,
    );
    if (report.instance.pauseReason) {
      lines.push(`> Pause reason: ${report.instance.pauseReason}`);
    }
    if (report.instance.error) {
      lines.push(`> Error: ${report.instance.error}`);
    }
    lines.push('');
  }

  // Summary table
  lines.push('## Summary');
  lines.push('');
  lines.push(`| | |`);
  lines.push(`|---|---|`);
  lines.push(`| **Status** | ${instanceStatusLabel(report.summary.status)} |`);
  lines.push(`| **Started** | ${formatTimestamp(report.summary.createdAt)} |`);
  lines.push(`| **Triggered by** | ${report.summary.triggerType} |`);
  lines.push(`| **Created by** | ${report.summary.createdBy} |`);
  lines.push(
    `| **Progress** | ${report.summary.completedSteps}/${report.summary.totalSteps} steps |`,
  );
  if (report.summary.wallClockDuration) {
    lines.push(
      `| **Wall-clock** | ${report.summary.wallClockDuration} |`,
    );
  }
  if (report.summary.activeProcessingTimeMs > 0) {
    lines.push(
      `| **Active processing** | ${report.summary.activeProcessingTime} |`,
    );
  }
  lines.push(
    `| **Definition version** | ${report.definitionVersion} |`,
  );
  lines.push('');

  // Step timeline
  lines.push('## Step Timeline');
  lines.push('');

  for (let i = 0; i < report.steps.length; i++) {
    lines.push(renderStepSection(report.steps[i], i));
  }

  // Footer
  lines.push('---');
  lines.push(
    `*Generated by Mediforce \u2014 ${new Date().toISOString().split('T')[0]}*`,
  );
  lines.push('');

  return lines.join('\n');
}
