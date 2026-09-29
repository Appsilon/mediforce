import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRssItems } from './news/parse-rss';
import { fetchReleases } from './news/releases';
import { byNewest, type NewsEntry } from './news/feeds';

const FEED_URL = 'https://www.appsilon.com/post/rss.xml';
const FETCH_TIMEOUT_MS = 15_000;
const OUT = join(fileURLToPath(new URL('../docs/', import.meta.url)), 'news.json');

function committed(): NewsEntry[] {
  try {
    return JSON.parse(readFileSync(OUT, 'utf8')) as NewsEntry[];
  } catch {
    return [];
  }
}

async function posts(): Promise<NewsEntry[]> {
  const response = await fetch(FEED_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: 'application/rss+xml, application/xml;q=0.9' },
  });
  if (response.ok === false) throw new Error(`the blog feed returned ${response.status}`);

  const found = parseRssItems(await response.text());
  if (found.length === 0) throw new Error('the blog feed parsed but matched no posts');
  return found;
}

function reason(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function main(): Promise<void> {
  const [fromBlog, fromGitHub] = await Promise.allSettled([posts(), fetchReleases()]);

  if (fromBlog.status === 'rejected' || fromGitHub.status === 'rejected') {
    const kept = committed();
    for (const outcome of [fromBlog, fromGitHub]) {
      if (outcome.status === 'rejected') console.warn(`[news] ${reason(outcome.reason)}`);
    }
    console.warn(`[news] keeping the ${kept.length} entries already committed`);
    return;
  }

  const entries = [...fromBlog.value, ...fromGitHub.value].sort(byNewest);
  writeFileSync(OUT, `${JSON.stringify(entries, null, 2)}\n`);
  console.log(
    `[news] ${fromBlog.value.length} post(s) and ${fromGitHub.value.length} release(s) -> docs/news.json`,
  );
}

void main();
