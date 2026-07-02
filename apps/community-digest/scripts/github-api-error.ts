export interface GitHubApiErrorInput {
  url: string;
  status: number;
  statusText: string;
  rateLimitRemaining: string | null;
  rateLimitReset: string | null;
}

export class GitHubApiError extends Error {
  readonly status: number;
  readonly isRateLimit: boolean;
  readonly rateLimitReset: string | null;

  constructor(
    message: string,
    status: number,
    isRateLimit: boolean,
    rateLimitReset: string | null,
  ) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
    this.isRateLimit = isRateLimit;
    this.rateLimitReset = rateLimitReset;
  }
}

export function createGitHubApiError(input: GitHubApiErrorInput): GitHubApiError {
  const isRateLimit =
    (input.status === 403 || input.status === 429) && input.rateLimitRemaining === '0';
  const rateLimitReset =
    isRateLimit && input.rateLimitReset
      ? new Date(Number(input.rateLimitReset) * 1000).toISOString()
      : null;
  const resetClause = rateLimitReset ? ` (resets at ${rateLimitReset})` : '';
  const message = isRateLimit
    ? `GitHub API rate limit exceeded for ${input.url}${resetClause}`
    : `GitHub API request failed: ${input.status} ${input.statusText} for ${input.url}`;
  return new GitHubApiError(message, input.status, isRateLimit, rateLimitReset);
}
