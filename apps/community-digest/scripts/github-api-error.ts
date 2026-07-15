export interface GitHubApiErrorInput {
  url: string;
  status: number;
  statusText: string;
  rateLimitRemaining: string | null;
  rateLimitReset: string | null;
}

export class GitHubApiError extends Error {
  readonly status: number;

  constructor(input: GitHubApiErrorInput) {
    super(buildMessage(input));
    this.name = 'GitHubApiError';
    this.status = input.status;
  }
}

function buildMessage(input: GitHubApiErrorInput): string {
  const isRateLimit =
    (input.status === 403 || input.status === 429) && input.rateLimitRemaining === '0';
  if (!isRateLimit) {
    return `GitHub API request failed: ${input.status} ${input.statusText} for ${input.url}`;
  }
  const resetClause = input.rateLimitReset
    ? ` (resets at ${new Date(Number(input.rateLimitReset) * 1000).toISOString()})`
    : '';
  return `GitHub API rate limit exceeded for ${input.url}${resetClause}`;
}
