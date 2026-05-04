import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function confidenceToTrafficLight(confidence: number): { color: string; label: string } {
  if (confidence >= 0.8) return { color: 'text-green-600 dark:text-green-400', label: 'high' };
  if (confidence >= 0.5) return { color: 'text-amber-600 dark:text-amber-400', label: 'medium' };
  return { color: 'text-red-600 dark:text-red-400', label: 'low' };
}

/**
 * Whether a `gitMetadata.repoUrl` value points at a browsable host (GitHub-style).
 * Run-branch commits live in a local bare repo and are never pushed, so the
 * value is often a filesystem path. We only render `/commit/<sha>` and
 * `/compare/...` deep links when we know the prefix is fetchable over HTTP.
 */
export function isBrowsableRepoUrl(repoUrl: string | null | undefined): repoUrl is string {
  if (!repoUrl) return false;
  return repoUrl.startsWith('http://') || repoUrl.startsWith('https://');
}
