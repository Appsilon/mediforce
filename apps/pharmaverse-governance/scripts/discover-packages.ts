import { readFile, writeFile } from 'node:fs/promises';

const REGISTRY_REPO = 'pharmaverse/pharmaverse';
const REGISTRY_BRANCH = 'develop';
const PACKAGES_PATH = 'data/packages';
const CONCURRENCY_LIMIT = 5;

interface PackageInfo {
  name: string;
  repo: string;
  repoUrl: string;
  defaultBranch: string;
  docs: string;
  task: string;
  details: string;
}

interface DiscoverResult {
  packages: PackageInfo[];
  metadata: {
    registryRepo: string;
    branch: string;
    packageCount: number;
    discoveredAt: string;
  };
}

interface GitHubContentEntry {
  name: string;
  url: string;
  type: string;
}

interface GitHubFileContent {
  content: string;
  encoding: string;
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

async function githubFetch(url: string): Promise<Response> {
  const response = await fetch(url, { headers: githubHeaders() });
  const remaining = response.headers.get('X-RateLimit-Remaining');
  if (remaining !== null && parseInt(remaining, 10) < 100) {
    const reset = response.headers.get('X-RateLimit-Reset');
    const resetTime = reset ? new Date(parseInt(reset, 10) * 1000).toISOString() : 'unknown';
    console.warn(`WARNING: GitHub rate limit low — ${remaining} remaining (resets at ${resetTime})`);
  }
  return response;
}

function parseYaml(text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let currentKey: string | null = null;
  let currentValue = '';

  for (const line of text.split('\n')) {
    if (currentKey !== null && /^\s+/.test(line)) {
      currentValue += ' ' + line.trim();
      continue;
    }

    if (currentKey !== null) {
      fields[currentKey] = currentValue.trim();
    }

    const match = line.match(/^([A-Za-z][A-Za-z0-9_.]*)\s*:\s*(.*)/);
    if (match) {
      currentKey = match[1];
      currentValue = match[2];
    } else {
      currentKey = null;
      currentValue = '';
    }
  }

  if (currentKey !== null) {
    fields[currentKey] = currentValue.trim();
  }

  return fields;
}

async function fetchPackageYaml(entryUrl: string): Promise<Record<string, string> | null> {
  const response = await githubFetch(entryUrl);
  if (!response.ok) {
    return null;
  }
  const data = (await response.json()) as GitHubFileContent;
  if (!data.content || data.encoding !== 'base64') {
    return null;
  }
  const decoded = Buffer.from(data.content, 'base64').toString('utf-8');
  return parseYaml(decoded);
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
  console.log(`Discovering packages from ${REGISTRY_REPO} (${REGISTRY_BRANCH})...`);

  const dirUrl = `https://api.github.com/repos/${REGISTRY_REPO}/contents/${PACKAGES_PATH}?ref=${REGISTRY_BRANCH}`;
  const dirResponse = await githubFetch(dirUrl);
  if (!dirResponse.ok) {
    throw new Error(`Failed to list ${PACKAGES_PATH}: ${dirResponse.status} ${dirResponse.statusText}`);
  }

  const entries = (await dirResponse.json()) as GitHubContentEntry[];
  const yamlEntries = entries.filter((entry) => entry.name.endsWith('.yaml'));
  console.log(`Found ${yamlEntries.length} yaml files in registry`);

  const packages: PackageInfo[] = [];

  await processInBatches(yamlEntries, CONCURRENCY_LIMIT, async (entry) => {
    const fields = await fetchPackageYaml(entry.url);
    if (fields === null) {
      console.warn(`  Skipped ${entry.name}: could not fetch`);
      return;
    }

    const name = fields.name ?? entry.name.replace(/\.yaml$/, '');
    const repo = fields.repo ?? '';
    const repoUrl = repo ? `https://github.com/${repo}` : '';

    // Fetch default branch from the GitHub API
    let defaultBranch = 'main';
    if (repo) {
      const repoResponse = await githubFetch(`https://api.github.com/repos/${repo}`);
      if (repoResponse.ok) {
        const repoData = (await repoResponse.json()) as { default_branch?: string };
        defaultBranch = repoData.default_branch ?? 'main';
      }
    }

    packages.push({
      name,
      repo,
      repoUrl,
      defaultBranch,
      docs: fields.docs ?? '',
      task: fields.task ?? '',
      details: fields.details ?? '',
    });
    console.log(`  ${name} (${repo}, branch: ${defaultBranch})`);
  });

  packages.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  const result: DiscoverResult = {
    packages,
    metadata: {
      registryRepo: REGISTRY_REPO,
      branch: REGISTRY_BRANCH,
      packageCount: packages.length,
      discoveredAt: new Date().toISOString(),
    },
  };

  await writeFile('/output/result.json', JSON.stringify(result, null, 2), 'utf-8');
  console.log(`\nDone: ${packages.length} packages discovered`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
