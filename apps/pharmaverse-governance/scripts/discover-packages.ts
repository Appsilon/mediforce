import { readFile, writeFile } from 'node:fs/promises';

const EXCLUDED_REPOS = new Set([
  'blog',
  'pharmaverse.github.io',
  '.github',
  'pharmaverse-logos',
  'pharmaverse',
  'examples',
]);

const CONCURRENCY_LIMIT = 5;
const ORG = 'pharmaverse';

interface DiscoverInput {
  org?: string;
}

interface PackageInfo {
  name: string;
  repo: string;
  repoUrl: string;
  version: string;
  title: string;
  license: string;
  maintainer: string;
  description: string;
  bugsUrl: string;
  defaultBranch: string;
  stars: number;
  createdAt: string;
}

interface ExcludedRepo {
  name: string;
  reason: string;
}

interface DiscoverResult {
  packages: PackageInfo[];
  excluded: ExcludedRepo[];
  metadata: {
    org: string;
    totalRepos: number;
    packageCount: number;
    excludedCount: number;
    discoveredAt: string;
  };
}

interface GitHubRepo {
  name: string;
  html_url: string;
  archived: boolean;
  default_branch: string;
  stargazers_count: number;
  created_at: string;
}

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

async function githubFetch(url: string): Promise<Response> {
  const response = await fetch(url, { headers: githubHeaders() });
  checkRateLimit(response);
  return response;
}

async function fetchAllRepos(org: string): Promise<GitHubRepo[]> {
  const repos: GitHubRepo[] = [];
  let page = 1;
  while (true) {
    const url = `https://api.github.com/orgs/${org}/repos?per_page=100&page=${page}`;
    console.log(`Fetching repos page ${page}...`);
    const response = await githubFetch(url);
    if (!response.ok) {
      console.error(`Failed to fetch repos: ${response.status} ${response.statusText}`);
      break;
    }
    const data = (await response.json()) as GitHubRepo[];
    if (data.length === 0) break;
    repos.push(...data);
    if (data.length < 100) break;
    page++;
  }
  console.log(`Found ${repos.length} total repos in ${org}`);
  return repos;
}

function parseDescriptionFile(content: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let currentKey: string | null = null;
  let currentValue = '';

  for (const line of content.split('\n')) {
    // Continuation line (starts with whitespace)
    if (currentKey !== null && /^\s+/.test(line)) {
      currentValue += ' ' + line.trim();
      continue;
    }

    // Save previous field
    if (currentKey !== null) {
      fields[currentKey] = currentValue.trim();
    }

    // New field line
    const match = line.match(/^([A-Za-z][A-Za-z0-9_.]*)\s*:\s*(.*)/);
    if (match) {
      currentKey = match[1];
      currentValue = match[2];
    } else {
      currentKey = null;
      currentValue = '';
    }
  }

  // Save last field
  if (currentKey !== null) {
    fields[currentKey] = currentValue.trim();
  }

  return fields;
}

async function fetchDescriptionFile(repo: string): Promise<Record<string, string> | null> {
  const url = `https://api.github.com/repos/${ORG}/${repo}/contents/DESCRIPTION`;
  const response = await githubFetch(url);
  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as { content?: string; encoding?: string };
  if (!data.content || data.encoding !== 'base64') {
    return null;
  }

  const decoded = Buffer.from(data.content, 'base64').toString('utf-8');
  return parseDescriptionFile(decoded);
}

async function processInBatches<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

async function main(): Promise<void> {
  const inputRaw = await readFile('/output/input.json', 'utf-8');
  const input = JSON.parse(inputRaw) as DiscoverInput;

  const org = input.org ?? ORG;
  console.log(`Discovering R packages in ${org}...`);

  const allRepos = await fetchAllRepos(org);

  const packages: PackageInfo[] = [];
  const excluded: ExcludedRepo[] = [];

  // First pass: filter out excluded-list and archived repos
  const candidates: GitHubRepo[] = [];
  for (const repo of allRepos) {
    if (EXCLUDED_REPOS.has(repo.name)) {
      excluded.push({ name: repo.name, reason: 'excluded-list' });
      console.log(`  Excluded ${repo.name}: excluded-list`);
    } else if (repo.archived) {
      excluded.push({ name: repo.name, reason: 'archived' });
      console.log(`  Excluded ${repo.name}: archived`);
    } else {
      candidates.push(repo);
    }
  }

  console.log(`${candidates.length} candidate repos to check for DESCRIPTION files...`);

  // Second pass: check DESCRIPTION file with concurrency limit
  await processInBatches(candidates, CONCURRENCY_LIMIT, async (repo) => {
    console.log(`  Checking ${repo.name}...`);
    const fields = await fetchDescriptionFile(repo.name);

    if (fields === null) {
      excluded.push({ name: repo.name, reason: 'no-description-file' });
      console.log(`    ${repo.name}: no DESCRIPTION file`);
      return;
    }

    const packageInfo: PackageInfo = {
      name: fields.Package ?? repo.name,
      repo: repo.name,
      repoUrl: repo.html_url,
      version: fields.Version ?? '',
      title: fields.Title ?? '',
      license: fields.License ?? '',
      maintainer: fields.Maintainer ?? '',
      description: fields.Description ?? '',
      bugsUrl: fields.BugReports ?? '',
      defaultBranch: repo.default_branch,
      stars: repo.stargazers_count,
      createdAt: repo.created_at,
    };

    packages.push(packageInfo);
    console.log(`    ${repo.name}: found package ${packageInfo.name} v${packageInfo.version}`);
  });

  // Sort packages alphabetically by name
  packages.sort((a, b) => a.name.localeCompare(b.name));

  const result: DiscoverResult = {
    packages,
    excluded,
    metadata: {
      org,
      totalRepos: allRepos.length,
      packageCount: packages.length,
      excludedCount: excluded.length,
      discoveredAt: new Date().toISOString(),
    },
  };

  await writeFile('/output/result.json', JSON.stringify(result, null, 2), 'utf-8');
  console.log(
    `Done: ${packages.length} packages discovered, ${excluded.length} repos excluded out of ${allRepos.length} total`,
  );
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
