import { readFile, writeFile } from 'node:fs/promises';

interface GatherInput {
  repo: string;
  lookbackHours?: number;
  sinceDate?: string;
}

interface GitHubCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
  url: string;
  branch: string;
}

interface GitHubPR {
  number: number;
  title: string;
  state: string;
  mergedAt: string | null;
  author: string;
  url: string;
  labels: string[];
}

interface GitHubIssue {
  number: number;
  title: string;
  state: string;
  createdAt: string;
  closedAt: string | null;
  author: string;
  url: string;
  labels: string[];
}

interface GatherResult {
  changes: {
    commits: GitHubCommit[];
    pullRequests: GitHubPR[];
    issues: GitHubIssue[];
  };
  metadata: {
    repo: string;
    since: string;
    until: string;
    totalCommits: number;
    totalPRs: number;
    totalIssues: number;
  };
}

async function githubFetch(url: string): Promise<Response> {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'mediforce-community-digest',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return fetch(url, { headers });
}

async function fetchBranches(repo: string): Promise<string[]> {
  const branches: string[] = [];
  let page = 1;
  while (true) {
    const url = `https://api.github.com/repos/${repo}/branches?per_page=100&page=${page}`;
    const response = await githubFetch(url);
    if (!response.ok) {
      console.error(`Failed to fetch branches: ${response.status} ${response.statusText}`);
      break;
    }
    const data = (await response.json()) as Array<{ name: string }>;
    if (data.length === 0) break;
    branches.push(...data.map((branch) => branch.name));
    if (data.length < 100) break;
    page++;
  }
  return branches;
}

async function fetchCommitsForBranch(
  repo: string,
  branch: string,
  since: string,
  until: string,
): Promise<GitHubCommit[]> {
  const url = `https://api.github.com/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&since=${since}&until=${until}&per_page=100`;
  const response = await githubFetch(url);
  if (!response.ok) {
    // Branch may have been deleted between listing and fetching
    if (response.status !== 409) {
      console.error(`Failed to fetch commits for branch '${branch}': ${response.status} ${response.statusText}`);
    }
    return [];
  }
  const data = (await response.json()) as Array<{
    sha: string;
    commit: { message: string; author: { name: string; date: string } };
    html_url: string;
  }>;
  return data.map((commit) => ({
    sha: commit.sha.slice(0, 8),
    message: commit.commit.message.split('\n')[0],
    author: commit.commit.author.name,
    date: commit.commit.author.date,
    url: commit.html_url,
    branch,
  }));
}

async function fetchCommits(repo: string, since: string, until: string): Promise<GitHubCommit[]> {
  const branches = await fetchBranches(repo);
  console.log(`Found ${branches.length} branches: ${branches.join(', ')}`);

  const perBranch = await Promise.all(
    branches.map((branch) => fetchCommitsForBranch(repo, branch, since, until)),
  );

  // Deduplicate by SHA — keep the first branch a commit appears on
  const seen = new Set<string>();
  const commits: GitHubCommit[] = [];
  for (const branchCommits of perBranch) {
    for (const commit of branchCommits) {
      if (!seen.has(commit.sha)) {
        seen.add(commit.sha);
        commits.push(commit);
      }
    }
  }

  // Sort by date descending
  commits.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return commits;
}

async function fetchPullRequests(repo: string, since: string): Promise<GitHubPR[]> {
  const url = `https://api.github.com/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=50`;
  const response = await githubFetch(url);
  if (!response.ok) {
    console.error(`Failed to fetch PRs: ${response.status} ${response.statusText}`);
    return [];
  }
  const data = (await response.json()) as Array<{
    number: number;
    title: string;
    state: string;
    merged_at: string | null;
    user: { login: string };
    html_url: string;
    labels: Array<{ name: string }>;
  }>;
  const sinceDate = new Date(since);
  return data
    .filter((pr) => pr.merged_at !== null && new Date(pr.merged_at) >= sinceDate)
    .map((pr) => ({
      number: pr.number,
      title: pr.title,
      state: pr.state,
      mergedAt: pr.merged_at,
      author: pr.user.login,
      url: pr.html_url,
      labels: pr.labels.map((label) => label.name),
    }));
}

async function fetchIssues(repo: string, since: string): Promise<GitHubIssue[]> {
  const url = `https://api.github.com/repos/${repo}/issues?state=all&since=${since}&sort=updated&direction=desc&per_page=50`;
  const response = await githubFetch(url);
  if (!response.ok) {
    console.error(`Failed to fetch issues: ${response.status} ${response.statusText}`);
    return [];
  }
  const data = (await response.json()) as Array<{
    number: number;
    title: string;
    state: string;
    created_at: string;
    closed_at: string | null;
    user: { login: string };
    html_url: string;
    labels: Array<{ name: string }>;
    pull_request?: unknown;
  }>;
  return data
    .filter((issue) => issue.pull_request === undefined)
    .map((issue) => ({
      number: issue.number,
      title: issue.title,
      state: issue.state,
      createdAt: issue.created_at,
      closedAt: issue.closed_at,
      author: issue.user.login,
      url: issue.html_url,
      labels: issue.labels.map((label) => label.name),
    }));
}

async function main(): Promise<void> {
  const inputRaw = await readFile('/output/input.json', 'utf-8');
  const input = JSON.parse(inputRaw) as GatherInput;

  const repo = input.repo;
  const lookbackHours = input.lookbackHours ?? 24;

  const until = new Date();
  const since = input.sinceDate
    ? new Date(input.sinceDate)
    : new Date(until.getTime() - lookbackHours * 60 * 60 * 1000);

  const sinceIso = since.toISOString();
  const untilIso = until.toISOString();

  console.log(`Gathering changes for ${repo} from ${sinceIso} to ${untilIso}`);

  const [commits, pullRequests, issues] = await Promise.all([
    fetchCommits(repo, sinceIso, untilIso),
    fetchPullRequests(repo, sinceIso),
    fetchIssues(repo, sinceIso),
  ]);

  const result: GatherResult = {
    changes: { commits, pullRequests, issues },
    metadata: {
      repo,
      since: sinceIso,
      until: untilIso,
      totalCommits: commits.length,
      totalPRs: pullRequests.length,
      totalIssues: issues.length,
    },
  };

  await writeFile('/output/result.json', JSON.stringify(result, null, 2), 'utf-8');
  console.log(`Done: ${commits.length} commits, ${pullRequests.length} PRs, ${issues.length} issues`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
