import { readFile, writeFile } from 'node:fs/promises';

// ---------------------------------------------------------------------------
// Compact digest for the recommendations agent.
//
// The agent runtime ALWAYS inlines the immediate predecessor's full output into
// the prompt ("## Input Data", no size spill). classify-packages emits ~156 KB
// of per-criterion evidence, which blows the model context. This step sits
// between classify-packages and assess-recommendations and projects the
// classification down to the few fields the agent needs to write recommendations
// — status, badges, warnings, gaps, and a handful of headline metrics. It drops
// the verbose evidence arrays (the report steps still read those from
// classify-packages directly). Deterministic; no LLM.
// ---------------------------------------------------------------------------

interface Assessment {
  packageName: string;
  repo: string;
  repoUrl: string;
  proposedStatus: string;
  proposedBadges: { submissionReadiness: string | null; maintenanceHealth: string | null; technicalQuality: string | null };
  renewalTriggers: { rt1_termExpired: boolean; rt2_majorRelease: boolean; rt3_councilInitiated: boolean };
  changeType: string;
  dataGaps: string[];
  earlyWarnings: string[];
}

interface Metrics {
  packageName: string;
  cranStatus: string;
  releases: { countLast18Months: number };
  issues: { openCount: number; unresolvedCriticalCount: number; oldestUnresolvedDays: number | null };
  coverage: { percent: number | null };
  contributors: { commitsLast90Days: number };
}

interface InputData {
  assessments?: Assessment[];
  steps?: Record<string, { assessments?: Assessment[]; packages?: Metrics[] } | undefined>;
}

function firedTriggers(t: Assessment['renewalTriggers']): string[] {
  const out: string[] = [];
  if (t.rt1_termExpired) out.push('RT-1 term expired');
  if (t.rt2_majorRelease) out.push('RT-2 major release');
  if (t.rt3_councilInitiated) out.push('RT-3 council-initiated');
  return out;
}

async function main(): Promise<void> {
  const input = JSON.parse(await readFile('/output/input.json', 'utf-8')) as InputData;
  const assessments = input.assessments ?? input.steps?.['classify-packages']?.assessments ?? [];
  const metrics = new Map<string, Metrics>();
  for (const m of input.steps?.['collect-metrics']?.packages ?? []) metrics.set(m.packageName, m);

  const packages = assessments.map((a) => {
    const m = metrics.get(a.packageName);
    return {
      packageName: a.packageName,
      status: a.proposedStatus,
      badges: {
        submission: a.proposedBadges.submissionReadiness,
        maintenance: a.proposedBadges.maintenanceHealth,
        technical: a.proposedBadges.technicalQuality,
      },
      changeType: a.changeType,
      earlyWarnings: a.earlyWarnings,
      dataGaps: a.dataGaps,
      renewalTriggers: firedTriggers(a.renewalTriggers),
      metrics: m
        ? {
            cranStatus: m.cranStatus,
            releasesLast18Months: m.releases.countLast18Months,
            openIssues: m.issues.openCount,
            unresolvedCritical: m.issues.unresolvedCriticalCount,
            oldestUnresolvedDays: m.issues.oldestUnresolvedDays,
            coveragePercent: m.coverage.percent,
            commitsLast90Days: m.contributors.commitsLast90Days,
          }
        : null,
    };
  });

  const result = {
    output_file: '/output/result.json',
    summary: `Digest for ${packages.length} packages`,
    packages,
  };
  await writeFile('/output/result.json', JSON.stringify(result, null, 2), 'utf-8');
  console.log(`Done: digested ${packages.length} packages`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
