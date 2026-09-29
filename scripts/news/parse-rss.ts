import { matchesFilters, trimSummary, type NewsEntry } from './feeds';

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&[a-z]+;|&#\d+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity);
}

function tagText(block: string, tag: string): string {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
  if (match === null) return '';
  const inner = match[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1');
  return decodeEntities(inner.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function parseRssItems(
  xml: string,
  filters?: readonly string[],
): NewsEntry[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];
  const entries: NewsEntry[] = [];

  for (const block of items) {
    const title = tagText(block, 'title');
    const url = tagText(block, 'link');
    const summary = trimSummary(tagText(block, 'description'));
    if (url === '' || title === '') continue;
    if (!matchesFilters({ title, summary, url }, filters)) continue;

    const published = new Date(tagText(block, 'pubDate'));
    entries.push({
      kind: 'post',
      id: tagText(block, 'guid') || url,
      title,
      url,
      date: Number.isNaN(published.getTime()) ? '' : published.toISOString(),
      summary,
    });
  }

  return entries;
}
