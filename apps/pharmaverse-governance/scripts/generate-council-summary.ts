import { readFile, writeFile } from 'node:fs/promises';

// ---------------------------------------------------------------------------
// Deterministic council summary generator.
//
// Replaces the former agentic step: the council summary is a pure roll-up of the
// structured assessment data, so it needs no LLM. This makes the report
// repeatable, enforces the exact structure, and removes the per-run token cost
// (the aggregation prompt was exceeding the model context limit).
// ---------------------------------------------------------------------------

interface EvidenceItem {
  criteriaId: string;
  met: boolean;
  evidence: string;
}

interface PackageAssessment {
  packageName: string;
  repo: string;
  repoUrl: string;
  proposedStatus: string;
  statusEvidence: EvidenceItem[];
  proposedBadges: {
    submissionReadiness: string | null;
    maintenanceHealth: string | null;
    technicalQuality: string | null;
  };
  badgeEvidence: {
    submissionReadiness: EvidenceItem[];
    maintenanceHealth: EvidenceItem[];
    technicalQuality: EvidenceItem[];
  };
  renewalTriggers: {
    rt1_termExpired: boolean;
    rt2_majorRelease: boolean;
    rt3_councilInitiated: boolean;
  };
  changeType: string;
  proposedChanges: Array<{ field: string; from: string | null; to: string }>;
  confidence: string;
  dataGaps: string[];
  flags: string[];
  earlyWarnings: string[];
}

interface CouncilDecision {
  packageName: string;
  decision: string;
  decidedAt: string;
  source: string;
}

interface InputData {
  assessments?: PackageAssessment[];
  verdict?: string;
  comment?: string;
  reviewDate?: string;
  steps?: Record<string, { assessments?: PackageAssessment[]; councilSummary?: { councilDecisions?: CouncilDecision[] } } | undefined>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(text: string | null | undefined): string {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (s.includes('stable')) return 'b-stable';
  if (s.includes('maturing')) return 'b-maturing';
  if (s.includes('watch')) return 'b-watch';
  if (s.includes('risk')) return 'b-atrisk';
  if (s.includes('archived')) return 'b-archived';
  return 'b-na';
}

function statusBorderClass(status: string): string {
  const s = status.toLowerCase();
  if (s.includes('stable')) return 'status-stable';
  if (s.includes('maturing')) return 'status-maturing';
  if (s.includes('watch')) return 'status-watch';
  if (s.includes('risk')) return 'status-atrisk';
  if (s.includes('archived')) return 'status-archived';
  return '';
}

function badgeClass(badge: string | null | undefined): string {
  if (!badge || badge.trim().length === 0) return 'b-na';
  const b = badge.toLowerCase();
  if (b.includes('suitable') || b.includes('actively') || b.includes('quality reviewed')) return 'b-ok';
  if (b.includes('low') || b.includes('caution-fail')) return 'b-fail';
  if (b.includes('caution') || b.includes('pending')) return 'b-warn';
  if (b.includes('not assessed')) return 'b-na';
  return 'b-na';
}

function badgeLabel(badge: string | null | undefined): string {
  return badge && badge.trim().length > 0 ? badge : 'Unknown';
}

function monthYear(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function checkMark(met: boolean): string {
  return met ? '<span style="color:#22c55e">&#10003;</span>' : '<span style="color:#ef4444">&#10007;</span>';
}

/** Light, deterministic mention match: a council comment resolves a package if
 *  it names that package (word boundary, case-insensitive). No LLM parsing. */
function decisionForPackage(comment: string, packageName: string): string | null {
  const pattern = new RegExp(`(^|[^A-Za-z0-9])${packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9]|$)`, 'i');
  if (!pattern.test(comment)) return null;
  // Return the sentence/fragment mentioning the package for the decision record.
  const fragments = comment.split(/[\n;]+/).map((f) => f.trim()).filter(Boolean);
  const hit = fragments.find((f) => pattern.test(f));
  return hit ?? comment.trim();
}

// ---------------------------------------------------------------------------
// HTML sections
// ---------------------------------------------------------------------------

const STYLE = `
  * { box-sizing: border-box; }
  body { font-family: 'Raleway', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #333; background: #fff; padding: 1.5rem; max-width: 900px; margin: 0 auto; line-height: 1.6; font-size: 14px; }
  h1, h2, h3 { font-family: 'Montserrat', 'Raleway', sans-serif; }
  h1 { font-size: 1.5rem; font-weight: 700; color: #212529; border-bottom: 3px solid #ff0043; padding-bottom: 0.5rem; margin: 0 0 1.25rem 0; }
  h2 { font-size: 1.1rem; font-weight: 600; color: #444; margin: 1.5rem 0 0.5rem 0; }
  .stats { display: grid; grid-template-columns: repeat(6, 1fr); gap: 0.5rem; margin-bottom: 1.25rem; }
  .stat { background: #f8f9fa; border: 1px solid rgba(0,0,0,0.125); border-radius: 0.25rem; padding: 0.6rem 0.4rem; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
  .stat.green { background: #ecfdf5; border-color: #a7f3d0; }
  .stat.amber { background: #fffbeb; border-color: #fde68a; }
  .stat.red { background: #fef2f2; border-color: #fecaca; }
  .stat-n { font-family: 'Montserrat', sans-serif; font-size: 1.6rem; font-weight: 700; line-height: 1.2; }
  .stat-l { font-size: 0.6rem; color: #6c757d; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 0.15rem; }
  details { border: 1px solid rgba(0,0,0,0.125); border-radius: 0.25rem; margin: 0.6rem 0; overflow: hidden; }
  summary { padding: 0.6rem 0.85rem; cursor: pointer; font-family: 'Montserrat', sans-serif; font-weight: 600; font-size: 0.9rem; background: #f8f9fa; user-select: none; list-style: none; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  summary::-webkit-details-marker { display: none; }
  summary::before { content: '\\25B6'; font-size: 0.6rem; color: #6c757d; transition: transform 0.15s; flex-shrink: 0; }
  details[open] > summary::before { transform: rotate(90deg); }
  summary:hover { background: #f5f5f5; }
  summary .sm-name { font-size: 0.95rem; }
  summary .sm-name a { color: #007bff; text-decoration: none; }
  summary .sm-badges { display: flex; align-items: center; gap: 0.3rem; margin-left: auto; flex-wrap: wrap; }
  .det-body { padding: 0.6rem 0.85rem; }
  details.ref { border-color: #dee2e6; border-left: 3px solid #ff0043; }
  details.ref > summary { background: #f7f7f7; font-size: 0.8rem; color: #444; }
  details.status-stable { border-left: 4px solid #22c55e; }
  details.status-maturing { border-left: 4px solid #3b82f6; }
  details.status-watch { border-left: 4px solid #f59e0b; }
  details.status-atrisk { border-left: 4px solid #ef4444; }
  details.status-archived { border-left: 4px solid #6b7280; }
  .b { display: inline-block; padding: 0.1rem 0.4rem; border-radius: 0.2rem; font-size: 0.6rem; font-weight: 700; white-space: nowrap; font-family: 'Montserrat', sans-serif; letter-spacing: 0.02em; }
  .b-stable { background: #22c55e; color: #fff; }
  .b-maturing { background: #3b82f6; color: #fff; }
  .b-watch { background: #f59e0b; color: #fff; }
  .b-atrisk { background: #ef4444; color: #fff; }
  .b-archived { background: #6b7280; color: #fff; }
  .b-ok { background: #22c55e; color: #fff; }
  .b-warn { background: #f59e0b; color: #fff; }
  .b-fail { background: #ef4444; color: #fff; }
  .b-na { background: #d1d5db; color: #6b7280; }
  .b-pending { background: #f59e0b; color: #fff; }
  .b-decided { background: #22c55e; color: #fff; }
  .dim-label { font-family: 'Montserrat', sans-serif; font-weight: 600; font-size: 0.85rem; margin: 0.75rem 0 0.25rem; color: #444; }
  table { width: 100%; border-collapse: collapse; font-size: 0.82rem; margin: 0.3rem 0; }
  th { text-align: left; padding: 0.35rem 0.5rem; background: #f8f9fa; border-bottom: 2px solid #dee2e6; font-weight: 600; color: #495057; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.03em; }
  td { padding: 0.35rem 0.5rem; border-bottom: 1px solid #f5f5f5; vertical-align: top; }
  tr:hover td { background: #f8f9fa; }
  .cc { font-family: 'SFMono-Regular', Menlo, monospace; font-size: 0.68rem; background: #f7f7f7; padding: 0.08rem 0.3rem; border-radius: 0.2rem; color: #495057; border: 1px solid #dee2e6; }
  .rec { border-left: 4px solid #22c55e; padding: 0.5rem 0.75rem; margin: 0.5rem 0; font-size: 0.82rem; border-radius: 0 0.25rem 0.25rem 0; background: #ecfdf5; }
  .rec.caution { background: #fffbeb; border-left-color: #f59e0b; }
  .dec-box { background: #ecfdf5; border: 2px solid #22c55e; border-radius: 0.25rem; padding: 0.6rem 0.85rem; margin: 0.4rem 0; }
  .dec-label { font-size: 0.65rem; text-transform: uppercase; color: #16a34a; font-weight: 700; letter-spacing: 0.05em; font-family: 'Montserrat', sans-serif; }
  .actions-group { margin: 0.75rem 0; padding-left: 0.85rem; border-left: 3px solid #dee2e6; }
  .actions-group.pre-decision { border-left-color: #3b82f6; }
  .actions-group.decisions { border-left-color: #f59e0b; }
  .actions-group.post-approval { border-left-color: #6b7280; }
  .actions-group h3 { font-family: 'Montserrat', sans-serif; font-size: 0.85rem; font-weight: 600; margin: 0 0 0.35rem 0; color: #444; }
  .action { padding: 0.35rem 0; font-size: 0.82rem; border-bottom: 1px solid #f5f5f5; }
  .action:last-child { border-bottom: none; }
  .cnt { background: #e5e7eb; color: #374151; font-size: 0.65rem; font-weight: 600; padding: 0.05rem 0.4rem; border-radius: 0.25rem; font-family: 'Montserrat', sans-serif; }
  .muted { color: #6c757d; font-style: italic; font-size: 0.82rem; }
  a { color: #007bff; text-decoration: none; }
  a:hover { text-decoration: underline; }
  @media (prefers-color-scheme: dark) {
    body { color: #dee2e6; background: #1a1a2e; }
    h1 { color: #f8f9fa; } h2, .dim-label, .actions-group h3 { color: #dee2e6; }
    .stat, summary { background: #2a2a3e; border-color: #3a3a4e; }
    .stat.green { background: #0a2a1a; border-color: #22c55e; }
    .stat.amber { background: #2a2000; border-color: #f59e0b; }
    .stat.red { background: #2a0a0a; border-color: #ef4444; }
    .stat-l { color: #adb5bd; }
    details { border-color: #3a3a4e; } summary:hover { background: #3a3a4e; }
    th { background: #2a2a3e; color: #adb5bd; border-color: #3a3a4e; } td { border-color: #2a2a3e; }
    tr:hover td { background: #2a2a3e; }
    .cc { background: #2a2a3e; color: #adb5bd; border-color: #3a3a4e; }
    .rec { background: #0a2a1a; } .rec.caution { background: #2a2000; }
    .dec-box { background: #0a2a1a; border-color: #22c55e; }
    a { color: #3bbfe4; } .cnt { background: #3a3a4e; color: #adb5bd; }
  }
`;

const CRITERIA_REFERENCE = `
<details class="ref">
  <summary>Governance Criteria Reference</summary>
  <div class="det-body">
    <table>
      <tr><th>Code</th><th>Status Tag</th></tr>
      <tr><td><span class="cc">ST-1..5</span></td><td>Stable: settled API, issues &le;30/90d, &ge;1 release/term, badges assessed, docs current</td></tr>
      <tr><td><span class="cc">MA-1..5</span></td><td>Maturing: RFC approved, active dev, QR within 12mo target</td></tr>
      <tr><td><span class="cc">WA-1..4</span></td><td>Watch: documented concern, majority vote, 30-day appeal</td></tr>
      <tr><td><span class="cc">AR-1..5</span></td><td>At Risk: failing after &ge;1 Watch quarter, remediation required</td></tr>
      <tr><td><span class="cc">AV-1..4</span></td><td>Archived: endorsement withdrawn</td></tr>
    </table>
    <table>
      <tr><th>Code</th><th>Quality Badge</th></tr>
      <tr><td><span class="cc">SS/SC</span></td><td>Submission: Suitable (validation, CDISC, stability) vs Caution</td></tr>
      <tr><td><span class="cc">AM/LM</span></td><td>Maintenance: Actively Maintained vs Low Maintenance</td></tr>
      <tr><td><span class="cc">QR/RP</span></td><td>Technical: Quality Reviewed vs Review Pending</td></tr>
    </table>
  </div>
</details>`;

function evidenceTable(items: EvidenceItem[]): string {
  if (items.length === 0) return '<p class="muted">No evidence recorded.</p>';
  const rows = items
    .map(
      (i) =>
        `<tr><td><span class="cc">${escapeHtml(i.criteriaId)}</span></td><td>${checkMark(i.met)}</td><td>${escapeHtml(i.evidence)}</td></tr>`,
    )
    .join('');
  return `<table><tr><th>ID</th><th>&#10003;</th><th>Evidence</th></tr>${rows}</table>`;
}

function packageSection(a: PackageAssessment, decision: CouncilDecision | undefined): string {
  const badges = [
    `<span class="b ${statusClass(a.proposedStatus)}">${escapeHtml(a.proposedStatus)}</span>`,
    `<span class="b ${badgeClass(a.proposedBadges.submissionReadiness)}">${escapeHtml(badgeLabel(a.proposedBadges.submissionReadiness))}</span>`,
    `<span class="b ${badgeClass(a.proposedBadges.maintenanceHealth)}">${escapeHtml(badgeLabel(a.proposedBadges.maintenanceHealth))}</span>`,
    `<span class="b ${badgeClass(a.proposedBadges.technicalQuality)}">${escapeHtml(badgeLabel(a.proposedBadges.technicalQuality))}</span>`,
    decision
      ? '<span class="b b-decided">Decided</span>'
      : '<span class="b b-pending">Pending</span>',
  ].join('');

  const renewalTriggers = Object.entries({
    'RT-1 term expired': a.renewalTriggers.rt1_termExpired,
    'RT-2 major release': a.renewalTriggers.rt2_majorRelease,
    'RT-3 council-initiated': a.renewalTriggers.rt3_councilInitiated,
  })
    .filter(([, fired]) => fired)
    .map(([label]) => label);

  const parts: string[] = [];
  parts.push(`<div class="dim-label">Status Criteria</div>${evidenceTable(a.statusEvidence)}`);
  parts.push(`<div class="dim-label">Technical Quality: <span class="b ${badgeClass(a.proposedBadges.technicalQuality)}">${escapeHtml(badgeLabel(a.proposedBadges.technicalQuality))}</span></div>${evidenceTable(a.badgeEvidence.technicalQuality)}`);
  parts.push(`<div class="dim-label">Maintenance Health: <span class="b ${badgeClass(a.proposedBadges.maintenanceHealth)}">${escapeHtml(badgeLabel(a.proposedBadges.maintenanceHealth))}</span></div>${evidenceTable(a.badgeEvidence.maintenanceHealth)}`);
  parts.push(`<div class="dim-label">Submission Readiness: <span class="b ${badgeClass(a.proposedBadges.submissionReadiness)}">${escapeHtml(badgeLabel(a.proposedBadges.submissionReadiness))}</span></div>${evidenceTable(a.badgeEvidence.submissionReadiness)}`);
  if (renewalTriggers.length > 0) {
    parts.push(`<div class="rec caution"><strong>Renewal triggers:</strong> ${renewalTriggers.map(escapeHtml).join(', ')}</div>`);
  }
  if (a.dataGaps.length > 0) {
    parts.push(`<div class="rec caution"><strong>Data gaps:</strong> ${a.dataGaps.map(escapeHtml).join(', ')}</div>`);
  }
  if (decision) {
    parts.push(`<div class="dec-box"><div class="dec-label">Council Decision</div><p>${escapeHtml(decision.decision)}</p></div>`);
  }

  return `
<details class="${statusBorderClass(a.proposedStatus)}">
  <summary>
    <span class="sm-name"><a href="${escapeHtml(a.repoUrl)}" target="_blank">${escapeHtml(a.packageName)}</a></span>
    <span class="sm-badges">${badges}</span>
  </summary>
  <div class="det-body">
    <p class="muted">Repository: <a href="${escapeHtml(a.repoUrl)}" target="_blank">${escapeHtml(a.repoUrl)}</a> &middot; Confidence: ${escapeHtml(a.confidence)}</p>
    ${parts.join('\n')}
  </div>
</details>`;
}

/** Locate the assessments array: top-level (flattened previous step), the
 *  assess-packages step output, or — as a fallback — any step whose output
 *  carries an `assessments` array. */
function resolveAssessments(input: InputData): PackageAssessment[] {
  if (Array.isArray(input.assessments) && input.assessments.length > 0) return input.assessments;
  const direct = input.steps?.['assess-packages']?.assessments;
  if (Array.isArray(direct) && direct.length > 0) return direct;
  for (const step of Object.values(input.steps ?? {})) {
    const candidate = (step as { assessments?: unknown } | undefined)?.assessments;
    if (Array.isArray(candidate) && candidate.length > 0) return candidate as PackageAssessment[];
  }
  return input.assessments ?? direct ?? [];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const input = JSON.parse(await readFile('/output/input.json', 'utf-8')) as InputData;

  const assessments = resolveAssessments(input);

  if (assessments.length === 0) {
    console.warn('No assessments found in input — check that assess-packages wrote its assessments array to /output/result.json.');
  }

  const reviewDateObj = input.reviewDate ? new Date(input.reviewDate) : new Date();
  const reviewDate = isoDate(reviewDateObj);

  // Council decisions: accumulate prior ones, plus any resolved by this revision's comment.
  const priorDecisions = input.steps?.['generate-council-summary']?.councilSummary?.councilDecisions ?? [];
  const decisionByPackage = new Map<string, CouncilDecision>();
  for (const d of priorDecisions) decisionByPackage.set(d.packageName, d);

  if (input.verdict === 'revise' && typeof input.comment === 'string' && input.comment.trim().length > 0) {
    const nowIso = new Date().toISOString();
    for (const a of assessments) {
      const decision = decisionForPackage(input.comment, a.packageName);
      if (decision) {
        decisionByPackage.set(a.packageName, {
          packageName: a.packageName,
          decision,
          decidedAt: nowIso,
          source: 'review-comment',
        });
      }
    }
  }

  const consent = assessments.filter((a) => a.changeType === 'consent-agenda');
  const changes = assessments.filter((a) => a.changeType !== 'consent-agenda');
  const renewalsDue = assessments.filter(
    (a) => a.renewalTriggers.rt1_termExpired || a.renewalTriggers.rt2_majorRelease || a.renewalTriggers.rt3_councilInitiated,
  );
  const warned = assessments.filter((a) => a.earlyWarnings.length > 0);
  const resolvedCount = assessments.filter((a) => decisionByPackage.has(a.packageName)).length;
  const pendingCount = assessments.length - resolvedCount;

  // ----- councilSummary result.json (shape consumed by generate-package-reports) -----
  const councilSummary = {
    title: `Pharmaverse Semiannual Governance Review — ${monthYear(reviewDateObj)}`,
    reviewDate,
    overview: {
      totalPackages: assessments.length,
      consentAgendaCount: consent.length,
      proposedChangesCount: changes.length,
      renewalsDueCount: renewalsDue.length,
      earlyWarningsCount: warned.length,
      pendingDecisions: pendingCount,
      resolvedDecisions: resolvedCount,
    },
    consentAgenda: consent.map((a) => ({ packageName: a.packageName, status: a.proposedStatus })),
    proposedChanges: changes.map((a) => ({
      packageName: a.packageName,
      currentStatus: 'none',
      proposedStatus: a.proposedStatus,
      reason: a.changeType === 'initial-assessment' ? 'Initial endorsement' : a.proposedChanges.map((c) => `${c.field}: ${c.from ?? 'unset'} -> ${c.to}`).join('; '),
    })),
    earlyWarnings: warned.flatMap((a) =>
      a.earlyWarnings.map((w) => ({ packageName: a.packageName, warning: w })),
    ),
    councilDecisions: [...decisionByPackage.values()],
  };

  // ----- presentation.html -----
  const statusGroups = new Map<string, number>();
  for (const a of changes) statusGroups.set(a.proposedStatus, (statusGroups.get(a.proposedStatus) ?? 0) + 1);

  const decisionLines = [...statusGroups.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(
      ([status, n]) =>
        `<div class="action"><strong>Council:</strong> Vote to endorse ${n} ${escapeHtml(status)} package${n === 1 ? '' : 's'} with initial governance status <span class="muted">&mdash; Majority vote, 60% quorum</span></div>`,
    )
    .join('');

  const decisionsSection = decisionByPackage.size > 0
    ? `<h2>Council Decisions</h2>${[...decisionByPackage.values()]
        .map((d) => `<div class="dec-box"><div class="dec-label">Decision &middot; ${escapeHtml(d.packageName)}</div><p>${escapeHtml(d.decision)}</p></div>`)
        .join('')}`
    : '';

  const orderRank = (s: string): number =>
    ['at risk', 'watch', 'maturing', 'stable', 'archived'].findIndex((k) => s.toLowerCase().includes(k));
  const sortedAssessments = [...assessments].sort(
    (a, b) => orderRank(a.proposedStatus) - orderRank(b.proposedStatus) || a.packageName.localeCompare(b.packageName),
  );

  const packageSections = sortedAssessments
    .map((a) => packageSection(a, decisionByPackage.get(a.packageName)))
    .join('\n');

  const earlyWarningsSection = warned.length === 0
    ? '<p class="muted">No early warnings this cycle.</p>'
    : `<details open>
  <summary>Early Warnings <span class="cnt">${warned.length}</span></summary>
  <div class="det-body">
    <table>
      <tr><th>Package</th><th>Status</th><th>Warning</th><th>Recommendation</th></tr>
      ${warned
        .map(
          (a) =>
            `<tr><td>${escapeHtml(a.packageName)}</td><td><span class="b ${statusClass(a.proposedStatus)}">${escapeHtml(a.proposedStatus)}</span></td><td>${a.earlyWarnings.map(escapeHtml).join('; ')}</td><td>Assign maintainer outreach for ${escapeHtml(a.packageName)}</td></tr>`,
        )
        .join('')}
    </table>
  </div>
</details>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&family=Raleway:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>${STYLE}</style>
</head>
<body>
<h1>${escapeHtml(councilSummary.title)}</h1>
${CRITERIA_REFERENCE}
<div class="stats">
  <div class="stat"><div class="stat-n">${assessments.length}</div><div class="stat-l">Packages</div></div>
  <div class="stat green"><div class="stat-n" style="color:#16a34a">${consent.length}</div><div class="stat-l">Consent</div></div>
  <div class="stat amber"><div class="stat-n" style="color:#d97706">${changes.length}</div><div class="stat-l">Changes</div></div>
  <div class="stat red"><div class="stat-n" style="color:#dc2626">${warned.length}</div><div class="stat-l">Warnings</div></div>
  <div class="stat green"><div class="stat-n" style="color:#16a34a">${resolvedCount}</div><div class="stat-l">Resolved</div></div>
  <div class="stat amber"><div class="stat-n" style="color:#d97706">${pendingCount}</div><div class="stat-l">Pending</div></div>
</div>
${decisionsSection}
<h2>Detailed Assessments</h2>
${packageSections}
<h2>Early Warnings</h2>
${earlyWarningsSection}
<h2>Action Items</h2>
<div class="actions-group pre-decision">
  <h3>Pre-Decision Checks</h3>
  <div class="action"><strong>Council Lead:</strong> Schedule the governance review meeting to approve the assessment framework and package endorsements <span class="muted">&mdash; Due: ${isoDate(addDays(reviewDateObj, 28))}</span></div>
</div>
<div class="actions-group decisions">
  <h3>Decisions Required</h3>
  ${decisionLines || '<div class="action muted">No decisions pending.</div>'}
</div>
<div class="actions-group post-approval">
  <h3>Post-Approval Actions</h3>
  ${warned.length > 0 ? `<div class="action"><strong>Communications Lead:</strong> Assign outreach to ${warned.length} package maintainer${warned.length === 1 ? '' : 's'} with early warnings <span class="muted">&mdash; Due: ${isoDate(addDays(reviewDateObj, 42))}</span></div>` : '<div class="action muted">No outreach required.</div>'}
</div>
</body>
</html>`;

  await writeFile('/output/presentation.html', html, 'utf-8');

  const result = {
    output_file: '/output/result.json',
    summary: `Council summary: ${assessments.length} packages reviewed, ${pendingCount} decisions pending, ${resolvedCount} resolved`,
    councilSummary,
  };
  await writeFile('/output/result.json', JSON.stringify(result, null, 2), 'utf-8');
  console.log(`Done: ${assessments.length} packages, ${warned.length} warnings, ${pendingCount} pending`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
