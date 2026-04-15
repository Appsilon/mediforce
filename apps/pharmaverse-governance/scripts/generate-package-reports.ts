import { readFile, writeFile, mkdir } from 'node:fs/promises';
import puppeteer, { type Browser } from 'puppeteer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EvidenceItem {
  criteriaId: string;
  met: boolean;
  evidence: string;
}

interface BadgeEvidence {
  submissionReadiness: EvidenceItem[];
  maintenanceHealth: EvidenceItem[];
  technicalQuality: EvidenceItem[];
}

interface RenewalAssessment {
  rc1_valueProposition?: string;
  rc2_maintenanceCovenant?: string;
  rc3_qualityBadges?: string;
  rc4_userAdoption?: string;
}

interface PackageAssessment {
  packageName: string;
  repo: string;
  repoUrl: string;

  proposedStatus: string;
  statusEvidence: EvidenceItem[];

  proposedBadges: {
    submissionReadiness: string;
    maintenanceHealth: string;
    technicalQuality: string;
  };
  badgeEvidence: BadgeEvidence;

  renewalTriggers: {
    rt1_termExpired: boolean;
    rt2_majorRelease: boolean;
    rt3_councilInitiated: boolean;
  };
  renewalAssessment: RenewalAssessment | null;

  changeType: string;
  previousState: {
    governanceStatus: string | null;
    submissionReadiness: string | null;
    maintenanceHealth: string | null;
    technicalQuality: string | null;
  };
  proposedChanges: Array<{ field: string; from: string | null; to: string }>;

  confidence: string;
  dataGaps: string[];
  flags: string[];
  earlyWarnings: string[];

  report: string;
}

interface PackageMetrics {
  packageName: string;
  repo: string;
  repoUrl: string;
  cranStatus: string;
  releases: {
    latest: { tag: string; date: string } | null;
    countLast18Months: number;
  };
  issues: {
    openCount: number;
    closedCount: number;
    criticalResponseMedianDays: number | null;
    unresolvedCriticalCount: number;
  };
  pullRequests: {
    openCount: number;
    mergedLast6Months: number;
    medianReviewTimeDays: number | null;
  };
  coverage: {
    percent: number | null;
  };
  contributors: {
    total: number;
    commitsLast90Days: number;
  };
  errors: string[];
}

interface CouncilDecision {
  packageName: string;
  decision: string;
  decidedAt: string;
  source: string;
}

interface CouncilSummary {
  title: string;
  reviewDate: string;
  overview: {
    totalPackages: number;
    consentAgendaCount: number;
    proposedChangesCount: number;
    renewalsDueCount: number;
    earlyWarningsCount: number;
  };
  consentAgenda: Array<{ packageName: string; status: string }>;
  proposedChanges: Array<{ packageName: string; currentStatus: string; proposedStatus: string; reason: string }>;
  earlyWarnings: Array<{ packageName: string; warning: string }>;
  councilDecisions: CouncilDecision[];
}

interface InputData {
  councilSummary?: CouncilSummary;
  steps?: {
    'assess-packages'?: {
      assessments: PackageAssessment[];
    };
    'collect-metrics'?: {
      packages: PackageMetrics[];
    };
    'discover-packages'?: {
      packages: Array<{ name: string; task: string; maintainerName?: string; maintainerEmail?: string }>;
    };
    'generate-council-summary'?: {
      councilSummary?: CouncilSummary;
    };
    [key: string]: unknown;
  };
}

interface ReportEntry {
  packageName: string;
  htmlPath: string;
  pdfPath: string;
  status: string;
  maintainerName: string;
  maintainerEmail: string;
}

// ---------------------------------------------------------------------------
// HTML Generation
// ---------------------------------------------------------------------------

const REPORTS_DIR = '/output/reports';

function escapeHtml(text: string | null | undefined): string {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function statusBadgeClass(status: string): string {
  const normalized = status.toLowerCase().replace(/\s+/g, '-');
  if (normalized.includes('stable')) return 'badge-stable';
  if (normalized.includes('maturing')) return 'badge-maturing';
  if (normalized.includes('watch')) return 'badge-watch';
  if (normalized.includes('at-risk') || normalized.includes('at risk')) return 'badge-at-risk';
  if (normalized.includes('archived')) return 'badge-archived';
  return 'badge-neutral';
}

function qualityBadgeClass(badge: string): string {
  const normalized = badge.toLowerCase();
  if (normalized.includes('suitable') || normalized.includes('actively') || normalized.includes('quality reviewed')) return 'badge-stable';
  if (normalized.includes('caution') || normalized.includes('pending')) return 'badge-watch';
  if (normalized.includes('low')) return 'badge-at-risk';
  if (normalized.includes('not assessed')) return 'badge-neutral';
  return 'badge-neutral';
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return 'N/A';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'N/A';
  return String(value);
}

function formatDays(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'N/A';
  return `${Math.round(value)}d`;
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'N/A';
  return `${Math.round(value * 10) / 10}%`;
}

function buildEvidenceRows(evidence: EvidenceItem[]): string {
  if (evidence.length === 0) return '<p class="muted">No evidence recorded.</p>';

  const rows = evidence.map((item) => {
    const icon = item.met ? '<span class="met">Pass</span>' : '<span class="not-met">Fail</span>';
    return `<tr>
      <td><span class="criteria-code">${escapeHtml(item.criteriaId)}</span></td>
      <td>${icon}</td>
      <td>${escapeHtml(item.evidence)}</td>
    </tr>`;
  });

  return `<table>
    <thead><tr><th>Criteria</th><th>Result</th><th>Evidence</th></tr></thead>
    <tbody>${rows.join('\n')}</tbody>
  </table>`;
}

function buildRecommendations(
  assessment: PackageAssessment,
  decision: CouncilDecision | undefined,
): string {
  const items: string[] = [];

  if (decision) {
    items.push(`<div class="recommendation"><strong>Council Decision:</strong> ${escapeHtml(decision.decision)} <span class="muted">(${formatDate(decision.decidedAt)})</span></div>`);
  }

  if (assessment.proposedChanges.length > 0) {
    for (const change of assessment.proposedChanges) {
      items.push(`<div class="recommendation caution"><strong>${escapeHtml(change.field)}:</strong> ${escapeHtml(change.from ?? 'Not set')} &rarr; ${escapeHtml(change.to)}</div>`);
    }
  }

  if (assessment.earlyWarnings.length > 0) {
    for (const warning of assessment.earlyWarnings) {
      items.push(`<div class="recommendation alert"><strong>Warning:</strong> ${escapeHtml(warning)}</div>`);
    }
  }

  if (assessment.flags.length > 0) {
    for (const flag of assessment.flags) {
      items.push(`<div class="recommendation caution"><strong>Flag:</strong> ${escapeHtml(flag)}</div>`);
    }
  }

  if (assessment.dataGaps.length > 0) {
    items.push(`<div class="recommendation caution"><strong>Data Gaps:</strong> ${assessment.dataGaps.map(escapeHtml).join(', ')}</div>`);
  }

  if (items.length === 0) {
    items.push('<div class="recommendation">No action items. Package is healthy.</div>');
  }

  return items.join('\n');
}

function buildRenewalSection(assessment: PackageAssessment): string {
  const triggers = assessment.renewalTriggers;
  const hasTrigger = triggers.rt1_termExpired || triggers.rt2_majorRelease || triggers.rt3_councilInitiated;

  if (!hasTrigger) return '';

  const triggerList: string[] = [];
  if (triggers.rt1_termExpired) triggerList.push('<span class="criteria-code">RT-1</span> 18-month term expired');
  if (triggers.rt2_majorRelease) triggerList.push('<span class="criteria-code">RT-2</span> Major version release');
  if (triggers.rt3_councilInitiated) triggerList.push('<span class="criteria-code">RT-3</span> Council-initiated');

  let assessmentHtml = '';
  const renewal = assessment.renewalAssessment;
  if (renewal) {
    const dimensions: string[] = [];
    if (renewal.rc1_valueProposition) dimensions.push(`<tr><td><span class="criteria-code">RC-1</span></td><td>${escapeHtml(renewal.rc1_valueProposition)}</td></tr>`);
    if (renewal.rc2_maintenanceCovenant) dimensions.push(`<tr><td><span class="criteria-code">RC-2</span></td><td>${escapeHtml(renewal.rc2_maintenanceCovenant)}</td></tr>`);
    if (renewal.rc3_qualityBadges) dimensions.push(`<tr><td><span class="criteria-code">RC-3</span></td><td>${escapeHtml(renewal.rc3_qualityBadges)}</td></tr>`);
    if (renewal.rc4_userAdoption) dimensions.push(`<tr><td><span class="criteria-code">RC-4</span></td><td>${escapeHtml(renewal.rc4_userAdoption)}</td></tr>`);

    if (dimensions.length > 0) {
      assessmentHtml = `
        <h3>Renewal Assessment</h3>
        <table>
          <thead><tr><th>Dimension</th><th>Assessment</th></tr></thead>
          <tbody>${dimensions.join('\n')}</tbody>
        </table>`;
    }
  }

  return `
    <div class="section">
      <h2>Renewal Triggers</h2>
      <ul>${triggerList.map((t) => `<li>${t}</li>`).join('\n')}</ul>
      ${assessmentHtml}
    </div>`;
}

function generatePackageHtml(
  assessment: PackageAssessment,
  metrics: PackageMetrics | undefined,
  discoveredPkg: { name: string; task: string } | undefined,
  decision: CouncilDecision | undefined,
  reviewDate: string,
): string {
  const packageName = assessment.packageName;
  const repoUrl = assessment.repoUrl || `https://github.com/pharmaverse/${assessment.repo}`;
  const cranStatus = metrics?.cranStatus ?? 'unknown';
  const taskCategory = discoveredPkg?.task ?? 'N/A';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Governance Report - ${escapeHtml(packageName)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #1a1a2e; background: #fff; padding: 2rem; max-width: 850px; margin: 0 auto; line-height: 1.6; font-size: 14px; }

    /* Header */
    .report-header { border-bottom: 3px solid #2563eb; padding-bottom: 1rem; margin-bottom: 1.5rem; }
    .report-header h1 { font-size: 1.4rem; font-weight: 700; color: #1e293b; }
    .report-header .subtitle { font-size: 0.85rem; color: #64748b; margin-top: 0.25rem; }

    /* Sections */
    .section { margin-bottom: 1.5rem; }
    .section h2 { font-size: 1.05rem; font-weight: 600; color: #334155; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.35rem; margin-bottom: 0.75rem; }
    .section h3 { font-size: 0.9rem; font-weight: 600; color: #475569; margin: 0.75rem 0 0.5rem; }

    /* Identity grid */
    .identity-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem 2rem; font-size: 0.85rem; margin-bottom: 1rem; }
    .identity-grid dt { color: #64748b; font-weight: 500; }
    .identity-grid dd { color: #1e293b; font-weight: 600; }

    /* Badges */
    .badge { display: inline-block; padding: 0.15rem 0.6rem; border-radius: 9999px; font-size: 0.72rem; font-weight: 600; vertical-align: middle; }
    .badge-stable { background: #dcfce7; color: #166534; }
    .badge-maturing { background: #dbeafe; color: #1e40af; }
    .badge-watch { background: #fef3c7; color: #92400e; }
    .badge-at-risk { background: #fee2e2; color: #991b1b; }
    .badge-archived { background: #f1f5f9; color: #475569; }
    .badge-neutral { background: #f1f5f9; color: #475569; }
    .status-banner { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 1rem; }
    .status-banner .status-label { font-size: 0.75rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
    .status-banner .status-value { font-size: 1.1rem; font-weight: 700; }
    .confidence-tag { font-size: 0.7rem; color: #64748b; margin-left: auto; }

    /* Quality badges row */
    .badges-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; margin-bottom: 1rem; }
    .badge-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.6rem 0.75rem; text-align: center; }
    .badge-card .dim-label { font-size: 0.65rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 0.25rem; }
    .badge-card .dim-value { font-weight: 600; font-size: 0.8rem; }

    /* Metrics grid */
    .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 0.6rem; margin-bottom: 1rem; }
    .stat-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.5rem 0.6rem; text-align: center; }
    .stat-value { font-size: 1.25rem; font-weight: 700; color: #1e293b; }
    .stat-label { font-size: 0.6rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; }

    /* Tables */
    table { width: 100%; border-collapse: collapse; font-size: 0.82rem; margin: 0.5rem 0; }
    th { text-align: left; padding: 0.4rem 0.6rem; background: #f8fafc; border-bottom: 2px solid #e2e8f0; font-weight: 600; color: #475569; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.025em; }
    td { padding: 0.4rem 0.6rem; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
    tr:hover td { background: #f8fafc; }

    /* Criteria codes */
    .criteria-code { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.72rem; background: #f1f5f9; padding: 0.1rem 0.35rem; border-radius: 4px; color: #475569; white-space: nowrap; }

    /* Evidence result indicators */
    .met { color: #16a34a; font-weight: 600; font-size: 0.75rem; }
    .not-met { color: #dc2626; font-weight: 600; font-size: 0.75rem; }

    /* Recommendations */
    .recommendation { background: #f0fdf4; border-left: 3px solid #22c55e; padding: 0.5rem 0.75rem; margin: 0.5rem 0; font-size: 0.82rem; border-radius: 0 6px 6px 0; }
    .recommendation.caution { background: #fffbeb; border-left-color: #f59e0b; }
    .recommendation.alert { background: #fef2f2; border-left-color: #ef4444; }
    .recommendation strong { display: inline; }

    /* Muted text */
    .muted { color: #94a3b8; font-size: 0.82rem; }

    /* Links */
    a { color: #2563eb; text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* Lists */
    ul { padding-left: 1.2rem; margin: 0.5rem 0; }
    li { margin-bottom: 0.25rem; font-size: 0.85rem; }

    /* Footer */
    .report-footer { border-top: 2px solid #e2e8f0; padding-top: 0.75rem; margin-top: 2rem; font-size: 0.72rem; color: #94a3b8; text-align: center; }

    /* Print styles */
    @media print {
      body { padding: 1cm; max-width: none; font-size: 11pt; }
      .report-header { border-bottom-width: 2px; }
      .status-banner, .badge-card, .stat-card { border: 1px solid #ccc; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .badge { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .met, .not-met { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .recommendation { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      a { color: #000; }
      a[href]::after { content: " (" attr(href) ")"; font-size: 0.7em; color: #666; }
    }
  </style>
</head>
<body>

  <div class="report-header">
    <h1>Pharmaverse Governance Report &mdash; ${escapeHtml(packageName)}</h1>
    <div class="subtitle">Review Date: ${formatDate(reviewDate)}</div>
  </div>

  <!-- Package Identity -->
  <div class="section">
    <h2>Package Identity</h2>
    <dl class="identity-grid">
      <dt>Package</dt>
      <dd>${escapeHtml(packageName)}</dd>
      <dt>Repository</dt>
      <dd><a href="${escapeHtml(repoUrl)}" target="_blank">${escapeHtml(repoUrl)}</a></dd>
      <dt>CRAN Status</dt>
      <dd>${escapeHtml(cranStatus)}</dd>
      <dt>Task Category</dt>
      <dd>${escapeHtml(taskCategory)}</dd>
    </dl>
  </div>

  <!-- Governance Status -->
  <div class="section">
    <h2>Current Governance Status</h2>
    <div class="status-banner">
      <div>
        <div class="status-label">Status</div>
        <div class="status-value"><span class="badge ${statusBadgeClass(assessment.proposedStatus)}">${escapeHtml(assessment.proposedStatus)}</span></div>
      </div>
      <div class="confidence-tag">Confidence: ${escapeHtml(assessment.confidence)}</div>
    </div>
  </div>

  <!-- Quality Badges -->
  <div class="section">
    <h2>Quality Badges</h2>
    <div class="badges-row">
      <div class="badge-card">
        <div class="dim-label">Submission Readiness</div>
        <div class="dim-value"><span class="badge ${qualityBadgeClass(assessment.proposedBadges.submissionReadiness)}">${escapeHtml(assessment.proposedBadges.submissionReadiness)}</span></div>
      </div>
      <div class="badge-card">
        <div class="dim-label">Maintenance Health</div>
        <div class="dim-value"><span class="badge ${qualityBadgeClass(assessment.proposedBadges.maintenanceHealth)}">${escapeHtml(assessment.proposedBadges.maintenanceHealth)}</span></div>
      </div>
      <div class="badge-card">
        <div class="dim-label">Technical Quality</div>
        <div class="dim-value"><span class="badge ${qualityBadgeClass(assessment.proposedBadges.technicalQuality)}">${escapeHtml(assessment.proposedBadges.technicalQuality)}</span></div>
      </div>
    </div>
  </div>

  <!-- Key Metrics -->
  <div class="section">
    <h2>Key Metrics</h2>
    <div class="metrics-grid">
      <div class="stat-card">
        <div class="stat-value">${formatNumber(metrics?.releases.countLast18Months)}</div>
        <div class="stat-label">Releases (18mo)</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${formatNumber(metrics?.issues.openCount)}</div>
        <div class="stat-label">Open Issues</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${formatNumber(metrics?.pullRequests.openCount)}</div>
        <div class="stat-label">Open PRs</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${formatPercent(metrics?.coverage.percent)}</div>
        <div class="stat-label">Coverage</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${formatNumber(metrics?.contributors.total)}</div>
        <div class="stat-label">Contributors</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${formatDays(metrics?.issues.criticalResponseMedianDays)}</div>
        <div class="stat-label">Critical Response</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${formatNumber(metrics?.pullRequests.mergedLast6Months)}</div>
        <div class="stat-label">PRs Merged (6mo)</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${formatNumber(metrics?.contributors.commitsLast90Days)}</div>
        <div class="stat-label">Commits (90d)</div>
      </div>
    </div>
  </div>

  <!-- Status Assessment Details -->
  <div class="section">
    <h2>Status Assessment</h2>
    <p class="muted" style="margin-bottom:0.5rem">Evidence for proposed status: <strong>${escapeHtml(assessment.proposedStatus)}</strong></p>
    ${buildEvidenceRows(assessment.statusEvidence)}
  </div>

  <!-- Badge Assessment Details -->
  <div class="section">
    <h2>Badge Assessment Details</h2>

    <h3>Submission Readiness: ${escapeHtml(assessment.proposedBadges.submissionReadiness)}</h3>
    ${buildEvidenceRows(assessment.badgeEvidence.submissionReadiness ?? [])}

    <h3>Maintenance Health: ${escapeHtml(assessment.proposedBadges.maintenanceHealth)}</h3>
    ${buildEvidenceRows(assessment.badgeEvidence.maintenanceHealth ?? [])}

    <h3>Technical Quality: ${escapeHtml(assessment.proposedBadges.technicalQuality)}</h3>
    ${buildEvidenceRows(assessment.badgeEvidence.technicalQuality ?? [])}
  </div>

  <!-- Renewal Triggers (if any) -->
  ${buildRenewalSection(assessment)}

  <!-- Council Decision & Recommendations -->
  <div class="section">
    <h2>Recommendations &amp; Action Items</h2>
    ${buildRecommendations(assessment, decision)}
  </div>

  <div class="report-footer">
    Generated by Pharmaverse Governance Review &mdash; ${formatDate(reviewDate)}
  </div>

</body>
</html>`;
}

// ---------------------------------------------------------------------------
// PDF Generation
// ---------------------------------------------------------------------------

async function generatePdf(htmlPath: string, pdfPath: string, browser: Browser): Promise<void> {
  const page = await browser.newPage();
  try {
    const htmlContent = await readFile(htmlPath, 'utf-8');
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      margin: { top: '1.5cm', right: '1.5cm', bottom: '1.5cm', left: '1.5cm' },
      printBackground: true,
    });
  } finally {
    await page.close();
  }
}

// ---------------------------------------------------------------------------
// Notification Review Presentation
// ---------------------------------------------------------------------------

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (s.includes('stable')) return '#22c55e';
  if (s.includes('maturing')) return '#3b82f6';
  if (s.includes('watch')) return '#f59e0b';
  if (s.includes('at-risk') || s.includes('at risk')) return '#ef4444';
  if (s.includes('archived')) return '#6b7280';
  return '#6b7280';
}

function buildNotificationPresentation(
  reportContents: Array<{ entry: ReportEntry; html: string }>,
  reviewDate: string,
): string {
  const cards = reportContents.map(({ entry, html }) => {
    // Extract <body> content from the full HTML report to embed inline
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const bodyContent = bodyMatch ? bodyMatch[1] : '<p>Report content unavailable</p>';
    const color = statusColor(entry.status);

    return `
    <details class="report-card" style="border-left: 4px solid ${color};">
      <summary>
        <span class="pkg-name">${escapeHtml(entry.packageName)}</span>
        <span class="badge" style="background: ${color}; color: #fff;">${escapeHtml(entry.status)}</span>
        <span class="recipient">
          <span class="recipient-icon">&#9993;</span>
          <span class="recipient-name">${escapeHtml(entry.maintainerName)}</span>
          &lt;${escapeHtml(entry.maintainerEmail)}&gt;
        </span>
      </summary>
      <div class="report-body">
        <div class="email-bar">
          <strong>To:</strong> ${escapeHtml(entry.maintainerName)} &lt;${escapeHtml(entry.maintainerEmail)}&gt;
          &nbsp;&nbsp;|&nbsp;&nbsp;
          <strong>Attachment:</strong> ${escapeHtml(entry.packageName)}.pdf
        </div>
        <div class="report-preview">${bodyContent}</div>
      </div>
    </details>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #1e293b; background: #fff; padding: 1.5rem; max-width: 920px; margin: 0 auto; line-height: 1.6; font-size: 14px; }
    h1 { font-size: 1.3rem; font-weight: 700; border-bottom: 3px solid #2563eb; padding-bottom: 0.5rem; margin: 0 0 0.5rem 0; }
    .subtitle { font-size: 0.85rem; color: #64748b; margin-bottom: 1.25rem; }

    .report-card { border: 1px solid #e2e8f0; border-radius: 0.5rem; margin: 0.75rem 0; overflow: hidden; }
    .report-card > summary { padding: 0.75rem 1rem; cursor: pointer; font-weight: 600; font-size: 0.95rem; background: #f8fafc; display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; list-style: none; }
    .report-card > summary::-webkit-details-marker { display: none; }
    .report-card > summary::before { content: '▶'; font-size: 0.6rem; color: #94a3b8; transition: transform 0.15s; }
    .report-card[open] > summary::before { transform: rotate(90deg); }
    .report-card > summary:hover { background: #f1f5f9; }

    .pkg-name { font-size: 1rem; }
    .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 0.25rem; font-size: 0.7rem; font-weight: 700; }
    .recipient { margin-left: auto; font-size: 0.8rem; font-weight: 400; color: #475569; display: flex; align-items: center; gap: 0.3rem; }
    .recipient-icon { font-size: 1rem; }

    .report-body { padding: 0; }
    .email-bar { background: #eff6ff; border-bottom: 1px solid #bfdbfe; padding: 0.6rem 1rem; font-size: 0.82rem; color: #1e40af; }
    .report-preview { padding: 1rem; border-top: 1px solid #e2e8f0; }

    /* Reset styles inside the embedded report so they don't clash */
    .report-preview h1 { font-size: 1.2rem; border-bottom: 2px solid #2563eb; }

    @media (prefers-color-scheme: dark) {
      body { color: #e2e8f0; background: #0f172a; }
      h1 { color: #f1f5f9; border-bottom-color: #3b82f6; }
      .subtitle { color: #94a3b8; }
      .report-card { border-color: #334155; }
      .report-card > summary { background: #1e293b; }
      .report-card > summary:hover { background: #334155; }
      .recipient { color: #94a3b8; }
      .email-bar { background: #1e293b; border-color: #334155; color: #93c5fd; }
      .report-preview { border-color: #334155; }
    }
  </style>
</head>
<body>
  <h1>Notification Preview &mdash; Per-Package Governance Reports</h1>
  <div class="subtitle">${escapeHtml(String(reportContents.length))} reports to send &nbsp;|&nbsp; Review date: ${escapeHtml(reviewDate)}</div>
  ${cards}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const inputRaw = await readFile('/output/input.json', 'utf-8');
  const input = JSON.parse(inputRaw) as InputData;

  // councilSummary may be at the top level (direct input) or nested inside
  // the generate-council-summary step output (when reached via review-council-summary
  // verdict routing, where steps: instance.variables is merged in).
  const councilSummary = input.councilSummary
    ?? input.steps?.['generate-council-summary']?.councilSummary;
  if (!councilSummary) {
    throw new Error('Missing councilSummary in input.json — not found at top level or in steps.generate-council-summary');
  }

  const reviewDate = councilSummary.reviewDate ?? new Date().toISOString().slice(0, 10);

  // Extract assessment data from steps
  const assessments: PackageAssessment[] = input.steps?.['assess-packages']?.assessments ?? [];
  const metricsPackages: PackageMetrics[] = input.steps?.['collect-metrics']?.packages ?? [];
  const discoveredPackages = input.steps?.['discover-packages']?.packages ?? [];

  if (assessments.length === 0) {
    console.warn('No package assessments found in input. Writing empty result.');
    const emptyResult = {
      reports: [],
      totalReports: 0,
      generatedAt: new Date().toISOString(),
    };
    await writeFile('/output/result.json', JSON.stringify(emptyResult, null, 2), 'utf-8');
    return;
  }

  // Build lookup maps
  const metricsMap = new Map<string, PackageMetrics>();
  for (const pkg of metricsPackages) {
    metricsMap.set(pkg.packageName, pkg);
  }

  const discoveredMap = new Map<string, (typeof discoveredPackages)[number]>();
  for (const pkg of discoveredPackages) {
    console.log(`  discovered: ${pkg.name} maintainer=${pkg.maintainerName ?? 'unknown'} <${pkg.maintainerEmail ?? 'N/A'}>`);
    discoveredMap.set(pkg.name, pkg);
  }

  const decisionsMap = new Map<string, CouncilDecision>();
  for (const decision of councilSummary.councilDecisions ?? []) {
    decisionsMap.set(decision.packageName, decision);
  }

  // Create reports directory
  await mkdir(REPORTS_DIR, { recursive: true });

  console.log(`Generating reports for ${assessments.length} packages...`);

  // Generate HTML reports
  const reports: ReportEntry[] = [];
  const reportHtmlContents: Array<{ entry: ReportEntry; html: string }> = [];
  for (const assessment of assessments) {
    const packageName = assessment.packageName;
    const htmlPath = `${REPORTS_DIR}/${packageName}.html`;

    const metrics = metricsMap.get(packageName);
    const discovered = discoveredMap.get(packageName);
    const decision = decisionsMap.get(packageName);

    const html = generatePackageHtml(assessment, metrics, discovered, decision, reviewDate);
    await writeFile(htmlPath, html, 'utf-8');

    const entry: ReportEntry = {
      packageName,
      htmlPath,
      pdfPath: `${REPORTS_DIR}/${packageName}.pdf`,
      status: assessment.proposedStatus,
      maintainerName: discovered?.maintainerName ?? 'Unknown',
      maintainerEmail: discovered?.maintainerEmail ?? 'N/A',
    };
    reports.push(entry);
    reportHtmlContents.push({ entry, html });

    console.log(`  HTML: ${htmlPath}`);
  }

  // Generate PDFs using puppeteer
  console.log('Launching browser for PDF generation...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    for (const report of reports) {
      console.log(`  PDF: ${report.pdfPath}`);
      await generatePdf(report.htmlPath, report.pdfPath, browser);
    }
  } finally {
    await browser.close();
  }

  // Build presentation HTML for the review step — embeds each report with maintainer info
  const presentationHtml = buildNotificationPresentation(reportHtmlContents, reviewDate);
  await writeFile('/output/presentation.html', presentationHtml, 'utf-8');

  // Write result
  const result = {
    output_file: '/output/result.json',
    presentation: presentationHtml,
    reports,
    totalReports: reports.length,
    generatedAt: new Date().toISOString(),
  };

  await writeFile('/output/result.json', JSON.stringify(result, null, 2), 'utf-8');
  console.log(`Done: ${reports.length} reports generated`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
