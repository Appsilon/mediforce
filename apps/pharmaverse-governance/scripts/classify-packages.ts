import { readFile, writeFile } from 'node:fs/promises';

// ---------------------------------------------------------------------------
// Deterministic package classifier.
//
// Computes every threshold-based field (status tag, quality badges, per-criterion
// evidence, renewal triggers, change type, confidence, objective early warnings)
// from the collected metrics. No LLM — same metrics always produce the same
// classification and the same canonical wording. The downstream agent step adds
// only judgment (recommendations / interpretive flags); it cannot alter anything
// computed here.
// ---------------------------------------------------------------------------

interface PackageMetrics {
  packageName: string;
  repo: string;
  repoUrl: string;
  currentState: {
    governanceStatus: string | null;
    submissionReadiness: string | null;
    maintenanceHealth: string | null;
    technicalQuality: string | null;
    lastReviewDate: string | null;
    endorsementTermStart: string | null;
  };
  releases: {
    latest: { tag: string; date: string } | null;
    earliest: { tag: string; date: string } | null;
    totalCount: number;
    countLast18Months: number;
    majorBumps: { from: string; to: string; date: string }[];
  };
  issues: {
    openCount: number;
    closedCount: number;
    criticalResponseMedianDays: number | null;
    nonCriticalTriageMedianDays: number | null;
    unresolvedCriticalCount: number;
    oldestUnresolvedDays: number | null;
  };
  pullRequests: { openCount: number; mergedLast6Months: number; medianReviewTimeDays: number | null };
  cranChecks: { status: string; okCount: number; noteCount: number; warningCount: number; errorCount: number };
  cranStatus: string;
  coverage: { percent: number | null; source: string };
  hasVignettes: boolean;
  documentation: { hasManPages: boolean; usesRoxygen: boolean };
  contributors: { total: number; commitsLast90Days: number; commitsLast180Days: number };
  errors: string[];
}

interface EvidenceItem { criteriaId: string; met: boolean; evidence: string }

interface InputData {
  packages?: PackageMetrics[];
  steps?: Record<string, { packages?: PackageMetrics[] } | undefined>;
}

const CRITICAL_RESPONSE_THRESHOLD = 30;
const NONCRITICAL_TRIAGE_THRESHOLD = 90;
const COVERAGE_THRESHOLD = 70;
const OLD_ISSUE_DAYS = 365;

/** A metric is unknown when null, its source is "unknown", or its data errored. */
function errored(metrics: PackageMetrics, key: string): boolean {
  return metrics.errors.some((e) => e.toLowerCase().includes(key));
}

function num(n: number | null): string {
  return n === null ? 'N/A' : (Math.round(n * 100) / 100).toString();
}

interface Classification {
  proposedStatus: string;
  statusEvidence: EvidenceItem[];
  proposedBadges: { submissionReadiness: string | null; maintenanceHealth: string; technicalQuality: string };
  badgeEvidence: { submissionReadiness: EvidenceItem[]; maintenanceHealth: EvidenceItem[]; technicalQuality: EvidenceItem[] };
  renewalTriggers: { rt1_termExpired: boolean; rt2_majorRelease: boolean; rt3_councilInitiated: boolean };
  renewalAssessment: null;
  changeType: string;
  previousState: PackageMetrics['currentState'];
  proposedChanges: Array<{ field: string; from: string | null; to: string }>;
  confidence: string;
  dataGaps: string[];
  flags: string[];
  earlyWarnings: string[];
}

function classify(m: PackageMetrics, now: Date): Classification {
  const dataGaps: string[] = [];

  // ----- data availability -----
  const coverageKnown = m.coverage.percent !== null && m.coverage.source !== 'unknown' && !errored(m, 'coverage');
  if (!coverageKnown) dataGaps.push('coverage unknown');
  const cranKnown = m.cranChecks.status !== 'unknown' && m.cranStatus === 'published' && !errored(m, 'cran');
  if (m.cranChecks.status === 'unknown') dataGaps.push('CRAN check data unavailable');
  const critMedianKnown = m.issues.criticalResponseMedianDays !== null;
  const nonCritMedianKnown = m.issues.nonCriticalTriageMedianDays !== null;

  // ----- Maintenance Health (AM/LM) -----
  const am1Fail = critMedianKnown && (m.issues.criticalResponseMedianDays as number) > CRITICAL_RESPONSE_THRESHOLD;
  const am2Fail = nonCritMedianKnown && (m.issues.nonCriticalTriageMedianDays as number) > NONCRITICAL_TRIAGE_THRESHOLD;
  const am3Met = m.releases.countLast18Months >= 1;
  const maintenanceHealth = am1Fail || am2Fail || !am3Met ? 'Low Maintenance' : 'Actively Maintained';
  const maintenanceEvidence: EvidenceItem[] = [
    { criteriaId: 'AM-1', met: !am1Fail, evidence: `Critical response median = ${num(m.issues.criticalResponseMedianDays)}d (threshold: ${CRITICAL_RESPONSE_THRESHOLD})` },
    { criteriaId: 'AM-2', met: !am2Fail, evidence: `Non-critical triage median = ${num(m.issues.nonCriticalTriageMedianDays)}d (threshold: ${NONCRITICAL_TRIAGE_THRESHOLD})` },
    { criteriaId: 'AM-3', met: am3Met, evidence: `${m.releases.countLast18Months} release(s) in last 18 months (threshold: 1)` },
  ];

  // ----- Technical Quality (QR/RP): positive unless a KNOWN criterion fails -----
  const qr0Fail = cranKnown && (m.cranChecks.errorCount > 0 || m.cranChecks.warningCount > 0);
  const qr1Fail = coverageKnown && (m.coverage.percent as number) < COVERAGE_THRESHOLD;
  const qr2Fail = !m.hasVignettes;
  const qr4Fail = !(m.documentation.hasManPages && m.documentation.usesRoxygen);
  const technicalQuality = qr0Fail || qr1Fail || qr2Fail || qr4Fail ? 'Review Pending' : 'Quality Reviewed';
  const technicalEvidence: EvidenceItem[] = [
    { criteriaId: 'QR-0', met: !qr0Fail, evidence: cranKnown ? `CRAN checks: ${m.cranChecks.okCount} OK, ${m.cranChecks.errorCount} errors, ${m.cranChecks.warningCount} warnings` : 'CRAN check status unknown' },
    { criteriaId: 'QR-1', met: !qr1Fail, evidence: coverageKnown ? `Coverage: ${num(m.coverage.percent)}% (threshold: ${COVERAGE_THRESHOLD}%)` : 'Coverage unknown' },
    { criteriaId: 'QR-2', met: !qr2Fail, evidence: m.hasVignettes ? 'Vignettes present' : 'No vignettes found' },
    { criteriaId: 'QR-4', met: !qr4Fail, evidence: `Man pages: ${m.documentation.hasManPages ? 'yes' : 'no'}, roxygen2: ${m.documentation.usesRoxygen ? 'yes' : 'no'}` },
  ];

  // ----- Status tag (option a): CRAN + release-in-term + actively maintained -----
  const prev = m.currentState.governanceStatus;
  let proposedStatus: string;
  if (prev) {
    proposedStatus = prev; // conservative: keep the recorded status on re-review
  } else {
    proposedStatus =
      m.cranStatus === 'published' && am3Met && maintenanceHealth === 'Actively Maintained'
        ? 'Stable'
        : 'Maturing';
  }
  const statusEvidence: EvidenceItem[] = [
    { criteriaId: 'ST-1', met: m.releases.majorBumps.length === 0, evidence: m.releases.majorBumps.length === 0 ? 'No major version bumps in last 18 months' : `${m.releases.majorBumps.length} major bump(s)` },
    { criteriaId: 'ST-2', met: !am1Fail && !am2Fail, evidence: `Issue response within thresholds (critical ${num(m.issues.criticalResponseMedianDays)}d / non-critical ${num(m.issues.nonCriticalTriageMedianDays)}d)` },
    { criteriaId: 'ST-3', met: am3Met, evidence: `${m.releases.countLast18Months} release(s) in last 18 months` },
    { criteriaId: 'ST-5', met: !qr4Fail, evidence: `Documentation ${qr4Fail ? 'incomplete' : 'present'}` },
  ];

  // ----- Submission Readiness (Stable only) -----
  let submissionReadiness: string | null;
  const submissionEvidence: EvidenceItem[] = [];
  if (proposedStatus !== 'Stable') {
    submissionReadiness = 'Not Assessed';
    submissionEvidence.push({ criteriaId: 'SS-0', met: false, evidence: 'Submission readiness assessed for Stable packages only' });
  } else {
    const ss1Met = coverageKnown && (m.coverage.percent as number) >= COVERAGE_THRESHOLD && m.hasVignettes;
    submissionReadiness = ss1Met ? 'Submission-Suitable' : 'Submission-Caution';
    submissionEvidence.push({
      criteriaId: ss1Met ? 'SS-1' : 'SC-1',
      met: ss1Met,
      evidence: coverageKnown
        ? `Coverage ${num(m.coverage.percent)}%, vignettes ${m.hasVignettes ? 'present' : 'absent'}`
        : 'Coverage unknown — cannot confirm validation artifacts',
    });
  }

  // ----- Renewal triggers -----
  let rt1 = false;
  if (m.currentState.endorsementTermStart) {
    const start = new Date(m.currentState.endorsementTermStart);
    const expiry = new Date(start.getTime());
    expiry.setMonth(expiry.getMonth() + 18);
    rt1 = expiry <= now;
  }
  const renewalTriggers = { rt1_termExpired: rt1, rt2_majorRelease: m.releases.majorBumps.length > 0, rt3_councilInitiated: false };

  // ----- Change type + proposed changes -----
  const firstReview = m.currentState.governanceStatus === null;
  const proposedChanges: Array<{ field: string; from: string | null; to: string }> = [];
  if (!firstReview) {
    if (m.currentState.governanceStatus !== proposedStatus) proposedChanges.push({ field: 'governanceStatus', from: m.currentState.governanceStatus, to: proposedStatus });
    if (m.currentState.maintenanceHealth !== maintenanceHealth) proposedChanges.push({ field: 'maintenanceHealth', from: m.currentState.maintenanceHealth, to: maintenanceHealth });
    if (m.currentState.technicalQuality !== technicalQuality) proposedChanges.push({ field: 'technicalQuality', from: m.currentState.technicalQuality, to: technicalQuality });
    if (submissionReadiness !== null && m.currentState.submissionReadiness !== submissionReadiness) proposedChanges.push({ field: 'submissionReadiness', from: m.currentState.submissionReadiness, to: submissionReadiness });
  }
  const changeType = firstReview ? 'initial-assessment' : proposedChanges.length > 0 ? 'proposed-change' : 'consent-agenda';

  // ----- Objective early warnings (facts, not judgment) -----
  const earlyWarnings: string[] = [];
  if (m.issues.oldestUnresolvedDays !== null && m.issues.oldestUnresolvedDays > OLD_ISSUE_DAYS) {
    earlyWarnings.push(`Unresolved issue older than 1 year (${Math.round(m.issues.oldestUnresolvedDays)} days)`);
  }
  if (m.issues.unresolvedCriticalCount > 0) {
    earlyWarnings.push(`${m.issues.unresolvedCriticalCount} unresolved critical issues`);
  }

  // ----- Confidence from data gaps -----
  if (m.errors.length > 0) dataGaps.push(`${m.errors.length} metric collection error(s)`);
  const confidence = dataGaps.length === 0 ? 'high' : dataGaps.length <= 2 ? 'medium' : 'low';

  return {
    proposedStatus,
    statusEvidence,
    proposedBadges: { submissionReadiness, maintenanceHealth, technicalQuality },
    badgeEvidence: { submissionReadiness: submissionEvidence, maintenanceHealth: maintenanceEvidence, technicalQuality: technicalEvidence },
    renewalTriggers,
    renewalAssessment: null,
    changeType,
    previousState: m.currentState,
    proposedChanges,
    confidence,
    dataGaps,
    flags: [],
    earlyWarnings,
  };
}

function resolvePackages(input: InputData): PackageMetrics[] {
  if (Array.isArray(input.packages) && input.packages.length > 0) return input.packages;
  const direct = input.steps?.['collect-metrics']?.packages;
  if (Array.isArray(direct)) return direct;
  for (const step of Object.values(input.steps ?? {})) {
    const c = (step as { packages?: unknown } | undefined)?.packages;
    if (Array.isArray(c) && c.length > 0 && (c[0] as PackageMetrics).cranStatus !== undefined) return c as PackageMetrics[];
  }
  return [];
}

async function main(): Promise<void> {
  const input = JSON.parse(await readFile('/output/input.json', 'utf-8')) as InputData;
  const packages = resolvePackages(input);
  const now = new Date();

  const assessments = packages.map((m) => ({
    packageName: m.packageName,
    repo: m.repo,
    repoUrl: m.repoUrl,
    ...classify(m, now),
  }));

  const stable = assessments.filter((a) => a.proposedStatus === 'Stable').length;
  const maturing = assessments.filter((a) => a.proposedStatus === 'Maturing').length;

  const result = {
    output_file: '/output/result.json',
    summary: `Classified ${assessments.length} packages: ${stable} Stable, ${maturing} Maturing`,
    assessments,
    summaryStats: {
      totalPackages: assessments.length,
      stable,
      maturing,
      lowMaintenance: assessments.filter((a) => a.proposedBadges.maintenanceHealth === 'Low Maintenance').length,
      reviewPending: assessments.filter((a) => a.proposedBadges.technicalQuality === 'Review Pending').length,
      earlyWarnings: assessments.filter((a) => a.earlyWarnings.length > 0).length,
    },
    classifiedAt: now.toISOString(),
  };
  await writeFile('/output/result.json', JSON.stringify(result, null, 2), 'utf-8');
  console.log(`Done: ${assessments.length} classified (${stable} Stable, ${maturing} Maturing)`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
