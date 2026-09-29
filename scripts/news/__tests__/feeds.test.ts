import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  byNewest,
  formatDate,
  matchesFilters,
  mergeEntries,
  monthLabel,
  normalise,
  trimSummary,
  type NewsEntry,
} from '../feeds';
import { decodeEntities, parseRssItems } from '../parse-rss';
import { toEntries } from '../releases';

const FEED = readFileSync(join(__dirname, 'appsilon-feed.fixture.xml'), 'utf8');

const entry = (over: Partial<NewsEntry>): NewsEntry => ({
  kind: 'post', id: 'x', title: 't', url: 'u', date: '2026-01-01T00:00:00Z', summary: '', ...over,
});

describe('normalise', () => {
  /**
   * The bug this exists for: Webflow writes a curly apostrophe in the title and
   * `&#39;` in the description, so a straight-quoted needle matches neither and
   * the page silently shows no posts at all.
   */
  it('folds every apostrophe the feed uses onto one', () => {
    expect(normalise('What’s Your Workflow?')).toContain("what's your workflow");
    expect(normalise('What&#39;s Your Workflow?')).toContain("what's your workflow");
    expect(normalise("What's Your Workflow?")).toContain("what's your workflow");
  });

  it('reads a hyphenated slug as words, so a URL matches a phrase', () => {
    expect(normalise('https://x/post/whats-your-workflow-tfls')).toContain('whats your workflow');
  });
});

describe('matchesFilters', () => {
  it('matches on the title, the summary or the slug', () => {
    const fields = { title: '', summary: '', url: '' };
    expect(matchesFilters({ ...fields, title: 'Introducing Mediforce v1.0.0' })).toBe(true);
    expect(matchesFilters({ ...fields, summary: 'built on Mediforce' })).toBe(true);
    expect(matchesFilters({ ...fields, url: 'https://x/post/mediforce-databricks' })).toBe(true);
  });

  it('leaves the rest of the blog out', () => {
    expect(matchesFilters({
      title: 'Shiny in Production: a retrospective',
      summary: 'Lessons from scaling R Shiny apps.',
      url: 'https://www.appsilon.com/post/shiny-in-production',
    })).toBe(false);
  });

  it('takes the filter list as an argument, so marketing owns it', () => {
    const fields = { title: 'Posit Connect tips', summary: '', url: '' };
    expect(matchesFilters(fields)).toBe(false);
    expect(matchesFilters(fields, ['posit'])).toBe(true);
  });
});

describe('parseRssItems, against the real feed', () => {
  it('finds exactly the posts that are ours', () => {
    const posts = parseRssItems(FEED);
    expect(posts).toHaveLength(6);
    expect(posts.filter((post) => post.title.includes('Workflow?'))).toHaveLength(4);
    expect(posts.filter((post) => /mediforce/i.test(post.title))).toHaveLength(2);
  });

  it('caps a description, because 18 of the feed\'s 100 run past a card', () => {
    const long = `<rss><channel><item>
      <title>Mediforce long one</title>
      <link>https://www.appsilon.com/post/long</link>
      <description>${'word '.repeat(200)}</description>
      <pubDate>Wed, 24 Sep 2026 09:00:00 GMT</pubDate>
    </item></channel></rss>`;
    const [post] = parseRssItems(long);
    expect(post.summary?.length).toBeLessThanOrEqual(221);
    expect(post.summary?.endsWith('\u2026')).toBe(true);
  });

  it('reads each field the page renders', () => {
    const [newest] = parseRssItems(FEED).sort(byNewest);
    expect(newest.kind).toBe('post');
    expect(newest.url).toMatch(/^https:\/\/www\.appsilon\.com\/post\//);
    expect(newest.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(newest.summary.length).toBeGreaterThan(20);
    expect(newest.title).not.toContain('&#');
  });

  it('strips markup rather than handing it to the page', () => {
    for (const post of parseRssItems(FEED)) {
      expect(post.summary).not.toMatch(/<[a-z]/i);
      expect(post.title).not.toMatch(/<[a-z]/i);
    }
  });

  it('is empty, not broken, for a feed with no matches', () => {
    expect(parseRssItems(FEED, ['nothing-matches-this'])).toEqual([]);
  });

  it('survives a truncated download instead of throwing', () => {
    expect(() => parseRssItems(FEED.slice(0, 5_000))).not.toThrow();
  });
});

describe('decodeEntities', () => {
  it('turns numeric and named entities into characters', () => {
    expect(decodeEntities('R&amp;D &#39;26 &quot;now&quot;')).toBe(`R&D '26 "now"`);
  });
});

describe('mergeEntries', () => {
  it('interleaves both sources newest first', () => {
    const merged = mergeEntries(
      [entry({ id: 'p1', date: '2026-09-24T09:00:00Z' }), entry({ id: 'p2', date: '2026-08-27T09:00:00Z' })],
      [entry({ kind: 'release', id: 'r1', date: '2026-09-23T10:00:00Z' })],
    );
    expect(merged.map((item) => item.id)).toEqual(['p1', 'r1', 'p2']);
  });

  it('still lists the posts when GitHub gave nothing', () => {
    const merged = mergeEntries([entry({ id: 'p1' })], []);
    expect(merged).toHaveLength(1);
  });

  it('puts an undated entry last rather than throwing', () => {
    const merged = mergeEntries([entry({ id: 'bad', date: '' })], [entry({ kind: 'release', id: 'r1' })]);
    expect(merged[merged.length - 1].id).toBe('bad');
  });
});

describe('formatting', () => {
  it('writes a date the same way wherever it runs', () => {
    expect(formatDate('2026-09-23T10:00:00Z')).toBe('23 September 2026');
    expect(monthLabel('2026-09-23T10:00:00Z')).toBe('Sep 2026');
    expect(formatDate('')).toBe('');
  });

  it('trims a summary on a word boundary and leaves a short one alone', () => {
    expect(trimSummary('Short enough.')).toBe('Short enough.');
    const long = trimSummary('word '.repeat(80), 40);
    expect(long.length).toBeLessThanOrEqual(41);
    expect(long.endsWith('…')).toBe(true);
    expect(long).not.toMatch(/\s…$/);
  });
});

describe('toEntries', () => {
  const release = (over: Record<string, unknown> = {}) => ({
    id: 1, name: 'v1.2.0', tag_name: 'v1.2.0', html_url: 'https://x/releases/1',
    published_at: '2026-09-23T10:00:00Z', created_at: '2026-09-23T09:00:00Z',
    draft: false, prerelease: false, ...over,
  });

  it('keeps published releases and drops drafts and pre-releases', () => {
    const entries = toEntries([release(), release({ id: 2, draft: true }), release({ id: 3, prerelease: true })]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'release', tag: 'v1.2.0', id: 'release-1' });
  });

  it('falls back to the tag when a release was never named', () => {
    expect(toEntries([release({ name: null })])[0].title).toBe('v1.2.0');
    expect(toEntries([release({ name: '   ' })])[0].title).toBe('v1.2.0');
  });

  it('uses the creation date when a release has no publish date', () => {
    expect(toEntries([release({ published_at: null })])[0].date).toBe('2026-09-23T09:00:00Z');
  });

  it('gives a release no summary, whatever its notes say', () => {
    expect(toEntries([release()])[0].summary).toBeUndefined();
  });
});
