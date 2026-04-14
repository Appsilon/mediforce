import { readFile, writeFile } from 'node:fs/promises';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PackageInput {
  name: string;
  repo: string;
  repoUrl: string;
  defaultBranch: string;
}

interface DiscoverResult {
  packages: PackageInput[];
}

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
    countLast18Months: number;
    majorBumps: { from: string; to: string; date: string }[];
    allReleases: { tag: string; date: string }[];
  };

  issues: {
    openCount: number;
    closedCount: number;
    criticalResponseMedianDays: number | null;
    nonCriticalTriageMedianDays: number | null;
    unresolvedCriticalCount: number;
    oldestUnresolvedDays: number | null;
  };

  pullRequests: {
    openCount: number;
    mergedLast6Months: number;
    medianReviewTimeDays: number | null;
  };

  cranChecks: {
    status: 'passing' | 'warnings' | 'errors' | 'not-on-cran' | 'unknown';
    okCount: number;
    noteCount: number;
    warningCount: number;
    errorCount: number;
  };

  cranStatus: 'published' | 'not-on-cran';

  coverage: {
    percent: number | null;
    source: 'codecov' | 'badge' | 'unknown';
  };

  hasVignettes: boolean;

  documentation: {
    hasManPages: boolean;
    usesRoxygen: boolean;
  };

  contributors: {
    total: number;
    commitsLast90Days: number;
    commitsLast180Days: number;
  };

  collectedAt: string;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Rate limiting and GitHub fetch infrastructure
// ---------------------------------------------------------------------------

let rateLimitRemaining = 5000;
let githubConcurrency = 3;

function githubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'mediforce-pharmaverse-governance',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function updateRateLimit(response: Response): void {
  const remaining = response.headers.get('X-RateLimit-Remaining');
  if (remaining !== null) {
    rateLimitRemaining = parseInt(remaining, 10);
  }
}

async function pauseIfNeeded(): Promise<void> {
  if (rateLimitRemaining < 50) {
    console.warn(`Rate limit critically low (${rateLimitRemaining}). Pausing for 60 seconds...`);
    await sleep(60_000);
  } else if (rateLimitRemaining < 200) {
    githubConcurrency = 1;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function githubFetch(url: string): Promise<Response> {
  await pauseIfNeeded();
  const response = await fetch(url, { headers: githubHeaders() });
  updateRateLimit(response);
  return response;
}

/**
 * Run GitHub API calls with bounded concurrency within a single package.
 * Each task is a function returning a promise.
 */
async function withGithubConcurrency<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const index = nextIndex;
      nextIndex++;
      results[index] = await tasks[index]();
    }
  }

  const workers: Promise<void>[] = [];
  const concurrency = Math.min(githubConcurrency, tasks.length);
  for (let i = 0; i < concurrency; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function monthsAgo(months: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function parseSemverMajor(tag: string): number | null {
  const match = tag.replace(/^v/i, '').match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

// ---------------------------------------------------------------------------
// 1. Current governance state (custom properties)
// ---------------------------------------------------------------------------

async function collectGovernanceState(
  repo: string,
): Promise<PackageMetrics['currentState']> {
  const url = `https://api.github.com/repos/${repo}/properties/values`;
  const response = await githubFetch(url);

  const defaultState: PackageMetrics['currentState'] = {
    governanceStatus: null,
    submissionReadiness: null,
    maintenanceHealth: null,
    technicalQuality: null,
    lastReviewDate: null,
    endorsementTermStart: null,
  };

  if (!response.ok) {
    return defaultState;
  }

  const data = (await response.json()) as Array<{
    property_name: string;
    value: string | null;
  }>;

  const propertyMap: Record<string, string> = {
    'governance-status': 'governanceStatus',
    'submission-readiness': 'submissionReadiness',
    'maintenance-health': 'maintenanceHealth',
    'technical-quality': 'technicalQuality',
    'last-review-date': 'lastReviewDate',
    'endorsement-term-start': 'endorsementTermStart',
  };

  for (const prop of data) {
    const key = propertyMap[prop.property_name];
    if (key !== undefined) {
      (defaultState as Record<string, string | null>)[key] = prop.value ?? null;
    }
  }

  return defaultState;
}

// ---------------------------------------------------------------------------
// 2. Releases
// ---------------------------------------------------------------------------

async function collectReleases(repo: string): Promise<PackageMetrics['releases']> {
  const url = `https://api.github.com/repos/${repo}/releases?per_page=100`;
  const response = await githubFetch(url);

  if (!response.ok) {
    return { latest: null, countLast18Months: 0, majorBumps: [], allReleases: [] };
  }

  const data = (await response.json()) as Array<{
    tag_name: string;
    published_at: string;
    draft: boolean;
  }>;

  const releases = data
    .filter((r) => !r.draft)
    .map((r) => ({ tag: r.tag_name, date: r.published_at }))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const cutoff18m = monthsAgo(18);
  const countLast18Months = releases.filter(
    (r) => new Date(r.date) >= cutoff18m,
  ).length;

  const majorBumps: { from: string; to: string; date: string }[] = [];
  for (let i = releases.length - 1; i > 0; i--) {
    const olderMajor = parseSemverMajor(releases[i].tag);
    const newerMajor = parseSemverMajor(releases[i - 1].tag);
    if (olderMajor !== null && newerMajor !== null && newerMajor > olderMajor) {
      majorBumps.push({
        from: releases[i].tag,
        to: releases[i - 1].tag,
        date: releases[i - 1].date,
      });
    }
  }

  return {
    latest: releases.length > 0 ? releases[0] : null,
    countLast18Months,
    majorBumps,
    allReleases: releases,
  };
}

// ---------------------------------------------------------------------------
// 3. Issues & response times
// ---------------------------------------------------------------------------

const CRITICAL_LABELS = ['bug', 'critical', 'breaking', 'urgent', 'security'];

function isCriticalIssue(labels: string[]): boolean {
  return labels.some((label) =>
    CRITICAL_LABELS.some((cl) => label.toLowerCase().includes(cl)),
  );
}

async function fetchFirstCommentTime(
  repo: string,
  issueNumber: number,
): Promise<string | null> {
  const url = `https://api.github.com/repos/${repo}/issues/${issueNumber}/comments?per_page=1`;
  const response = await githubFetch(url);
  if (!response.ok) return null;

  const data = (await response.json()) as Array<{ created_at: string }>;
  if (data.length === 0) return null;
  return data[0].created_at;
}

interface RawIssue {
  number: number;
  state: string;
  created_at: string;
  closed_at: string | null;
  labels: Array<{ name: string }>;
  pull_request?: unknown;
}

async function collectIssues(repo: string): Promise<PackageMetrics['issues']> {
  const since18m = monthsAgo(18).toISOString();
  const url = `https://api.github.com/repos/${repo}/issues?state=all&per_page=100&since=${since18m}`;
  const response = await githubFetch(url);

  const defaultIssues: PackageMetrics['issues'] = {
    openCount: 0,
    closedCount: 0,
    criticalResponseMedianDays: null,
    nonCriticalTriageMedianDays: null,
    unresolvedCriticalCount: 0,
    oldestUnresolvedDays: null,
  };

  if (!response.ok) return defaultIssues;

  const rawIssues = (await response.json()) as RawIssue[];
  // Filter out pull requests
  const issues = rawIssues.filter((issue) => issue.pull_request === undefined);

  const openCount = issues.filter((i) => i.state === 'open').length;
  const closedCount = issues.filter((i) => i.state === 'closed').length;

  // Collect first-response times for critical and non-critical issues
  const criticalResponseDays: number[] = [];
  const nonCriticalResponseDays: number[] = [];
  let unresolvedCriticalCount = 0;
  let oldestUnresolvedDays: number | null = null;

  // Fetch first comment times — use GitHub concurrency limiter
  const commentTasks = issues.map((issue) => {
    return async () => {
      const labels = issue.labels.map((l) => l.name);
      const critical = isCriticalIssue(labels);
      const createdAt = new Date(issue.created_at);

      if (critical && issue.state === 'open') {
        unresolvedCriticalCount++;
        const ageDays = daysBetween(createdAt, new Date());
        if (oldestUnresolvedDays === null || ageDays > oldestUnresolvedDays) {
          oldestUnresolvedDays = ageDays;
        }
      }

      const firstCommentTime = await fetchFirstCommentTime(repo, issue.number);
      if (firstCommentTime !== null) {
        const responseDays = daysBetween(createdAt, new Date(firstCommentTime));
        if (critical) {
          criticalResponseDays.push(responseDays);
        } else {
          nonCriticalResponseDays.push(responseDays);
        }
      }
    };
  });

  await withGithubConcurrency(commentTasks);

  return {
    openCount,
    closedCount,
    criticalResponseMedianDays: median(criticalResponseDays),
    nonCriticalTriageMedianDays: median(nonCriticalResponseDays),
    unresolvedCriticalCount,
    oldestUnresolvedDays,
  };
}

// ---------------------------------------------------------------------------
// 4. PR activity
// ---------------------------------------------------------------------------

interface RawPR {
  number: number;
  state: string;
  merged_at: string | null;
  created_at: string;
}

interface RawReview {
  submitted_at: string;
}

async function collectPullRequests(repo: string): Promise<PackageMetrics['pullRequests']> {
  const url = `https://api.github.com/repos/${repo}/pulls?state=all&per_page=50&sort=updated&direction=desc`;
  const response = await githubFetch(url);

  if (!response.ok) {
    return { openCount: 0, mergedLast6Months: 0, medianReviewTimeDays: null };
  }

  const prs = (await response.json()) as RawPR[];

  const openCount = prs.filter((pr) => pr.state === 'open').length;
  const sixMonthsAgo = monthsAgo(6);
  const mergedLast6Months = prs.filter(
    (pr) => pr.merged_at !== null && new Date(pr.merged_at) >= sixMonthsAgo,
  ).length;

  // Fetch first review time for merged PRs to compute median review time
  const mergedPrs = prs.filter((pr) => pr.merged_at !== null).slice(0, 20);
  const reviewTimeDays: number[] = [];

  const reviewTasks = mergedPrs.map((pr) => {
    return async () => {
      const reviewUrl = `https://api.github.com/repos/${repo}/pulls/${pr.number}/reviews?per_page=1`;
      const reviewResponse = await githubFetch(reviewUrl);
      if (!reviewResponse.ok) return;
      const reviews = (await reviewResponse.json()) as RawReview[];
      if (reviews.length > 0) {
        const prCreated = new Date(pr.created_at);
        const firstReview = new Date(reviews[0].submitted_at);
        reviewTimeDays.push(daysBetween(prCreated, firstReview));
      }
    };
  });

  await withGithubConcurrency(reviewTasks);

  return {
    openCount,
    mergedLast6Months,
    medianReviewTimeDays: median(reviewTimeDays),
  };
}

// ---------------------------------------------------------------------------
// 5. CRAN check status
// ---------------------------------------------------------------------------

async function collectCranChecks(
  packageName: string,
): Promise<PackageMetrics['cranChecks']> {
  const url = `https://cran.r-project.org/web/checks/check_results_${packageName}.html`;

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'mediforce-pharmaverse-governance' },
    });

    if (response.status === 404) {
      return { status: 'not-on-cran', okCount: 0, noteCount: 0, warningCount: 0, errorCount: 0 };
    }

    if (!response.ok) {
      return { status: 'unknown', okCount: 0, noteCount: 0, warningCount: 0, errorCount: 0 };
    }

    const html = await response.text();

    // Count statuses in the HTML table.
    // CRAN check pages have table cells with status values like:
    //   <td> OK </td>  <td> NOTE </td>  <td> WARNING </td>  <td> ERROR </td>
    const okCount = (html.match(/>(\s*)OK(\s*)</g) ?? []).length;
    const noteCount = (html.match(/>(\s*)NOTE(\s*)</g) ?? []).length;
    const warningCount = (html.match(/>(\s*)WARNING(\s*)</g) ?? []).length;
    const errorCount = (html.match(/>(\s*)ERROR(\s*)</g) ?? []).length;

    let status: PackageMetrics['cranChecks']['status'] = 'passing';
    if (errorCount > 0) {
      status = 'errors';
    } else if (warningCount > 0) {
      status = 'warnings';
    }

    return { status, okCount, noteCount, warningCount, errorCount };
  } catch {
    return { status: 'unknown', okCount: 0, noteCount: 0, warningCount: 0, errorCount: 0 };
  }
}

// ---------------------------------------------------------------------------
// 6. CRAN publication status
// ---------------------------------------------------------------------------

async function collectCranStatus(
  packageName: string,
): Promise<PackageMetrics['cranStatus']> {
  try {
    const response = await fetch(
      `https://cran.r-project.org/package=${packageName}`,
      { method: 'HEAD', headers: { 'User-Agent': 'mediforce-pharmaverse-governance' } },
    );
    return response.status === 200 ? 'published' : 'not-on-cran';
  } catch {
    return 'not-on-cran';
  }
}

// ---------------------------------------------------------------------------
// 7. Test coverage
// ---------------------------------------------------------------------------

async function collectCoverage(repo: string): Promise<PackageMetrics['coverage']> {
  // Try codecov first
  try {
    const repoName = repo.includes('/') ? repo.split('/')[1] : repo;
    const codecovUrl = `https://codecov.io/api/v2/github/pharmaverse/repos/${repoName}/`;
    const response = await fetch(codecovUrl, {
      headers: { 'User-Agent': 'mediforce-pharmaverse-governance' },
    });

    if (response.ok) {
      const data = (await response.json()) as {
        totals?: { coverage?: number };
      };
      if (data.totals?.coverage !== undefined && data.totals.coverage !== null) {
        return { percent: data.totals.coverage, source: 'codecov' };
      }
    }
  } catch {
    // Fall through to badge check
  }

  // Try README badge
  try {
    const readmeUrl = `https://api.github.com/repos/${repo}/readme`;
    const response = await githubFetch(readmeUrl);

    if (response.ok) {
      const data = (await response.json()) as { content?: string; encoding?: string };
      if (data.content && data.encoding === 'base64') {
        const readme = Buffer.from(data.content, 'base64').toString('utf-8');
        // Look for coverage badge patterns like:
        //   codecov.io/...badge.svg  or  coverage-85%25-green  or  coverage%20--%2095%25
        const badgeMatch = readme.match(
          /coverage[^)]*?(\d{1,3}(?:\.\d+)?)\s*%/i,
        );
        if (badgeMatch) {
          return { percent: parseFloat(badgeMatch[1]), source: 'badge' };
        }
        // Try URL-encoded patterns: coverage-85%25
        const encodedMatch = readme.match(
          /coverage[^)]*?(\d{1,3}(?:\.\d+)?)%25/i,
        );
        if (encodedMatch) {
          return { percent: parseFloat(encodedMatch[1]), source: 'badge' };
        }
      }
    }
  } catch {
    // Fall through
  }

  return { percent: null, source: 'unknown' };
}

// ---------------------------------------------------------------------------
// 8. Vignettes
// ---------------------------------------------------------------------------

async function collectVignettes(repo: string): Promise<boolean> {
  const url = `https://api.github.com/repos/${repo}/contents/vignettes`;
  const response = await githubFetch(url);
  return response.ok;
}

// ---------------------------------------------------------------------------
// 9. Documentation
// ---------------------------------------------------------------------------

async function collectDocumentation(repo: string): Promise<PackageMetrics['documentation']> {
  const manUrl = `https://api.github.com/repos/${repo}/contents/man`;
  const manResponse = await githubFetch(manUrl);
  const hasManPages = manResponse.ok;

  // Check DESCRIPTION for roxygen2 usage
  const descUrl = `https://api.github.com/repos/${repo}/contents/DESCRIPTION`;
  const descResponse = await githubFetch(descUrl);
  let usesRoxygen = false;

  if (descResponse.ok) {
    const data = (await descResponse.json()) as { content?: string; encoding?: string };
    if (data.content && data.encoding === 'base64') {
      const content = Buffer.from(data.content, 'base64').toString('utf-8');
      usesRoxygen = /roxygen2/i.test(content);
    }
  }

  return { hasManPages, usesRoxygen };
}

// ---------------------------------------------------------------------------
// 10. Contributor activity
// ---------------------------------------------------------------------------

async function collectContributors(repo: string): Promise<PackageMetrics['contributors']> {
  // Total contributors
  const contribUrl = `https://api.github.com/repos/${repo}/contributors?per_page=100`;
  const contribResponse = await githubFetch(contribUrl);
  let total = 0;

  if (contribResponse.ok) {
    const data = (await contribResponse.json()) as Array<{ login: string }>;
    total = data.length;
  }

  // Commit activity (weekly breakdown for last year)
  const activityUrl = `https://api.github.com/repos/${repo}/stats/commit_activity`;
  const activityResponse = await githubFetch(activityUrl);

  let commitsLast90Days = 0;
  let commitsLast180Days = 0;

  if (activityResponse.ok) {
    // GitHub may return 202 while computing stats — treat as empty
    if (activityResponse.status === 200) {
      const weeks = (await activityResponse.json()) as Array<{
        week: number; // unix timestamp of the start of the week
        total: number;
      }>;

      const now = Date.now() / 1000;
      const cutoff90 = now - 90 * 24 * 60 * 60;
      const cutoff180 = now - 180 * 24 * 60 * 60;

      for (const week of weeks) {
        if (week.week >= cutoff180) {
          commitsLast180Days += week.total;
        }
        if (week.week >= cutoff90) {
          commitsLast90Days += week.total;
        }
      }
    }
  }

  return { total, commitsLast90Days, commitsLast180Days };
}

// ---------------------------------------------------------------------------
// Collect all metrics for a single package
// ---------------------------------------------------------------------------

async function collectPackageMetrics(pkg: PackageInput): Promise<PackageMetrics> {
  const errors: string[] = [];
  const now = new Date().toISOString();

  // Helper to catch and record errors for individual metric collections
  async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  [${pkg.name}] ${label} FAILED: ${message}`);
      errors.push(`${label}: ${message}`);
      return fallback;
    }
  }

  // Parallelize independent GitHub API calls within this package
  const [
    currentState,
    releases,
    issues,
    pullRequests,
    contributors,
    hasVignettes,
    documentation,
    coverage,
  ] = await Promise.all([
    safe('governance-state', () => collectGovernanceState(pkg.repo), {
      governanceStatus: null,
      submissionReadiness: null,
      maintenanceHealth: null,
      technicalQuality: null,
      lastReviewDate: null,
      endorsementTermStart: null,
    }),
    safe('releases', () => collectReleases(pkg.repo), {
      latest: null,
      countLast18Months: 0,
      majorBumps: [],
      allReleases: [],
    }),
    safe('issues', () => collectIssues(pkg.repo), {
      openCount: 0,
      closedCount: 0,
      criticalResponseMedianDays: null,
      nonCriticalTriageMedianDays: null,
      unresolvedCriticalCount: 0,
      oldestUnresolvedDays: null,
    }),
    safe('pull-requests', () => collectPullRequests(pkg.repo), {
      openCount: 0,
      mergedLast6Months: 0,
      medianReviewTimeDays: null,
    }),
    safe('contributors', () => collectContributors(pkg.repo), {
      total: 0,
      commitsLast90Days: 0,
      commitsLast180Days: 0,
    }),
    safe('vignettes', () => collectVignettes(pkg.repo), false),
    safe('documentation', () => collectDocumentation(pkg.repo), {
      hasManPages: false,
      usesRoxygen: false,
    }),
    safe('coverage', () => collectCoverage(pkg.repo), {
      percent: null,
      source: 'unknown' as const,
    }),
  ]);

  // CRAN checks and status are not GitHub-rate-limited — run in parallel separately
  const [cranChecks, cranStatus] = await Promise.all([
    safe('cran-checks', () => collectCranChecks(pkg.name), {
      status: 'unknown' as const,
      okCount: 0,
      noteCount: 0,
      warningCount: 0,
      errorCount: 0,
    }),
    safe('cran-status', () => collectCranStatus(pkg.name), 'not-on-cran' as const),
  ]);

  return {
    packageName: pkg.name,
    repo: pkg.repo,
    repoUrl: pkg.repoUrl,
    currentState,
    releases,
    issues,
    pullRequests,
    cranChecks,
    cranStatus,
    coverage,
    hasVignettes,
    documentation,
    contributors,
    collectedAt: now,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// Testing filter: only process these packages to save API calls and time
const TEST_FILTER = ['admiral', 'rhino'];

async function main(): Promise<void> {
  const inputRaw = await readFile('/output/input.json', 'utf-8');
  const input = JSON.parse(inputRaw) as DiscoverResult;

  let packages = input.packages;

  // Derive repoUrl if missing (backward compat with older discover-packages output)
  for (const pkg of packages) {
    if (!pkg.repoUrl && pkg.repo) {
      pkg.repoUrl = `https://github.com/${pkg.repo}`;
    }
    if (!pkg.defaultBranch) {
      pkg.defaultBranch = 'main';
    }
  }

  // Apply test filter
  if (TEST_FILTER.length > 0) {
    const before = packages.length;
    packages = packages.filter((pkg) => TEST_FILTER.includes(pkg.name));
    console.log(`Test filter active: ${before} packages → ${packages.length} (${TEST_FILTER.join(', ')})`);
  }

  console.log(`Collecting metrics for ${packages.length} packages...`);

  const results: PackageMetrics[] = [];

  // Process packages sequentially to keep rate limiting manageable
  for (let i = 0; i < packages.length; i++) {
    const pkg = packages[i];
    console.log(`Collecting metrics for ${pkg.name} (${i + 1}/${packages.length})`);

    if (rateLimitRemaining > 0) {
      console.log(`  Rate limit remaining: ${rateLimitRemaining} (concurrency: ${githubConcurrency})`);
    }

    const metrics = await collectPackageMetrics(pkg);
    results.push(metrics);

    if (metrics.errors.length > 0) {
      console.warn(`  Errors for ${pkg.name}: ${metrics.errors.join('; ')}`);
    }
  }

  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);

  const output = {
    packages: results,
    metadata: {
      totalPackages: results.length,
      totalErrors,
      collectedAt: new Date().toISOString(),
      rateLimitRemaining,
    },
  };

  await writeFile('/output/result.json', JSON.stringify(output, null, 2), 'utf-8');
  console.log(
    `Done: ${results.length} packages collected, ${totalErrors} total errors`,
  );
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
