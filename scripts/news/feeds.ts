
export interface NewsEntry {
  /** `release` is a GitHub release, `post` an Appsilon blog entry. */
  kind: 'release' | 'post';
  id: string;
  title: string;
  url: string;
  /** ISO 8601. Feeds disagree on format; this is what sorting uses. */
  date: string;
  summary?: string;
  /** Release tag, e.g. `v1.2.0`. Absent on posts. */
  tag?: string;
}

/**
 * Titles a post must match to count as ours.
 *
 * Marketing owns this list: adding a series here is the whole change. Matched
 * against the title, the description and the URL slug, because the feed's
 * description is only ~150 characters and a post can be about Mediforce
 * without naming it there.
 */
export const POST_FILTERS: readonly string[] = [
  'mediforce',
  "what's your workflow",
];

/**
 * Fold the characters the two feeds disagree about.
 *
 * Webflow writes a curly apostrophe in `<title>` and the `&#39;` entity in
 * `<description>`, so a straight-quoted needle matches neither and the filter
 * silently returns nothing. The slug spells the same phrase with hyphens.
 */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/&#3[49];|&apos;|&quot;/g, "'")
    .replace(/[-_/]+/g, ' ');
}

export function matchesFilters(
  fields: { title: string; summary: string; url: string },
  filters: readonly string[] = POST_FILTERS,
): boolean {
  const haystack = normalise(`${fields.title} ${fields.summary} ${fields.url}`);
  return filters.some((filter) => haystack.includes(normalise(filter)));
}

/** Newest first. An unparseable date sorts last rather than throwing. */
export function byNewest(a: NewsEntry, b: NewsEntry): number {
  const left = Date.parse(a.date);
  const right = Date.parse(b.date);
  if (Number.isNaN(left)) return 1;
  if (Number.isNaN(right)) return -1;
  return right - left;
}

/**
 * One list from both sources.
 *
 * Releases arrive from the browser and may be missing entirely when GitHub is
 * unreachable or rate-limits the reader; the posts were baked at build time and
 * are always there, so the page still has something to show.
 */
export function mergeEntries(
  posts: readonly NewsEntry[],
  releases: readonly NewsEntry[],
): NewsEntry[] {
  return [...posts, ...releases].sort(byNewest);
}

/** `23 September 2026`, in a fixed locale so the server and browser agree. */
export function formatDate(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Month heading for the timeline rail, e.g. `Sep 2026`.
 *
 * Spelled out rather than left to `toLocaleDateString`, which renders
 * September as the four-letter `Sept` under `en-GB` and would leave one label
 * in the rail wider than the rest, differently across ICU versions.
 */
export function monthLabel(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return `${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
}

/**
 * Trim to a word boundary so a card never ends mid-word. Returns the text
 * unchanged when it already fits, and adds no ellipsis when nothing was cut.
 */
export function trimSummary(text: string, max = 220): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
