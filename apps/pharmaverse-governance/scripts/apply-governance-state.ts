import { readFile, writeFile } from 'node:fs/promises';

const ORG = 'pharmaverse';

interface ApprovedPackageState {
  repo: string;
  governanceStatus: string;
  submissionReadiness: string;
  maintenanceHealth: string;
  technicalQuality: string;
  renewEndorsementTerm: boolean;
  previousState: {
    governanceStatus: string | null;
    submissionReadiness: string | null;
    maintenanceHealth: string | null;
    technicalQuality: string | null;
  };
}

interface ApplyInput {
  packages: ApprovedPackageState[];
  reviewDate: string;
}

interface PropertyChange {
  property: string;
  previousValue: string | null;
  newValue: string;
}

interface AppliedChange {
  repo: string;
  changes: PropertyChange[];
}

interface FailedChange {
  repo: string;
  error: string;
}

interface ApplyResult {
  applied: AppliedChange[];
  failed: FailedChange[];
  metadata: {
    totalPackages: number;
    successCount: number;
    failCount: number;
    changesDetected: number;
    reviewDate: string;
    appliedAt: string;
  };
}

function githubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'User-Agent': 'mediforce-pharmaverse-governance',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function checkRateLimit(response: Response): void {
  const remaining = response.headers.get('X-RateLimit-Remaining');
  if (remaining !== null) {
    const value = parseInt(remaining, 10);
    if (value < 100) {
      const reset = response.headers.get('X-RateLimit-Reset');
      const resetTime = reset ? new Date(parseInt(reset, 10) * 1000).toISOString() : 'unknown';
      console.warn(`WARNING: GitHub rate limit low — ${value} requests remaining (resets at ${resetTime})`);
    }
  }
}

interface CustomProperty {
  property_name: string;
  value: string;
}

function buildProperties(pkg: ApprovedPackageState, reviewDate: string): CustomProperty[] {
  const properties: CustomProperty[] = [
    { property_name: 'governance-status', value: pkg.governanceStatus },
    { property_name: 'submission-readiness', value: pkg.submissionReadiness },
    { property_name: 'maintenance-health', value: pkg.maintenanceHealth },
    { property_name: 'technical-quality', value: pkg.technicalQuality },
    { property_name: 'last-review-date', value: reviewDate },
  ];

  if (pkg.renewEndorsementTerm) {
    properties.push({ property_name: 'endorsement-term-start', value: reviewDate });
  }

  return properties;
}

function detectChanges(pkg: ApprovedPackageState, reviewDate: string): PropertyChange[] {
  const changes: PropertyChange[] = [];

  const propertyMap: Array<{
    property: string;
    newValue: string;
    previousValue: string | null;
  }> = [
    {
      property: 'governance-status',
      newValue: pkg.governanceStatus,
      previousValue: pkg.previousState.governanceStatus,
    },
    {
      property: 'submission-readiness',
      newValue: pkg.submissionReadiness,
      previousValue: pkg.previousState.submissionReadiness,
    },
    {
      property: 'maintenance-health',
      newValue: pkg.maintenanceHealth,
      previousValue: pkg.previousState.maintenanceHealth,
    },
    {
      property: 'technical-quality',
      newValue: pkg.technicalQuality,
      previousValue: pkg.previousState.technicalQuality,
    },
  ];

  for (const entry of propertyMap) {
    if (entry.newValue !== entry.previousValue) {
      changes.push({
        property: entry.property,
        previousValue: entry.previousValue,
        newValue: entry.newValue,
      });
    }
  }

  // last-review-date always counts as a change (it's always updated)
  changes.push({
    property: 'last-review-date',
    previousValue: null,
    newValue: reviewDate,
  });

  if (pkg.renewEndorsementTerm) {
    changes.push({
      property: 'endorsement-term-start',
      previousValue: null,
      newValue: reviewDate,
    });
  }

  return changes;
}

async function updateRepoProperties(repo: string, properties: CustomProperty[]): Promise<void> {
  const url = `https://api.github.com/repos/${ORG}/${repo}/properties/values`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: githubHeaders(),
    body: JSON.stringify({ properties }),
  });

  checkRateLimit(response);

  if (!response.ok) {
    const body = await response.text();

    if (response.status === 403) {
      throw new Error(
        `GitHub API returned 403 Forbidden for ${repo}. ` +
          `The GITHUB_TOKEN must have org admin permissions to set custom properties. ` +
          `Required permission: "Organization Custom Properties" write access. ` +
          `Response: ${body}`,
      );
    }

    throw new Error(`GitHub API returned ${response.status} ${response.statusText} for ${repo}: ${body}`);
  }
}

async function main(): Promise<void> {
  const inputRaw = await readFile('/output/input.json', 'utf-8');
  const input = JSON.parse(inputRaw) as ApplyInput;

  const { packages, reviewDate } = input;
  console.log(`Applying governance state for ${packages.length} packages (review date: ${reviewDate})...`);

  const applied: AppliedChange[] = [];
  const failed: FailedChange[] = [];
  let changesDetected = 0;

  for (const pkg of packages) {
    console.log(`\nProcessing ${pkg.repo}...`);

    try {
      const properties = buildProperties(pkg, reviewDate);
      const changes = detectChanges(pkg, reviewDate);
      changesDetected += changes.length;

      for (const change of changes) {
        console.log(
          `  ${change.property}: ${change.previousValue ?? '(not set)'} -> ${change.newValue}`,
        );
      }

      await updateRepoProperties(pkg.repo, properties);

      applied.push({ repo: pkg.repo, changes });
      console.log(`  Successfully updated ${pkg.repo} (${changes.length} changes)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push({ repo: pkg.repo, error: message });
      console.error(`  Failed to update ${pkg.repo}: ${message}`);
    }
  }

  const result: ApplyResult = {
    applied,
    failed,
    metadata: {
      totalPackages: packages.length,
      successCount: applied.length,
      failCount: failed.length,
      changesDetected,
      reviewDate,
      appliedAt: new Date().toISOString(),
    },
  };

  await writeFile('/output/result.json', JSON.stringify(result, null, 2), 'utf-8');
  console.log(
    `\nDone: ${applied.length} repos updated, ${failed.length} failed, ${changesDetected} total changes detected`,
  );
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
