/**
 * A citation of the agent's log as judges write it: `[7]`, and in rationales
 * written before the judge prompt asked for one entry per bracket also
 * `[7, 13]`, `[9-16]`, `[entries 7 and 8]` or `[log entries 8-11]`.
 */
const CITATION = /\[(?:(?:log\s+)?entr(?:y|ies)\s+)?\d+(?:\s*[-–]\s*\d+)?(?:(?:\s*,\s*(?:and\s+)?|\s+and\s+|\s*&\s*)\d+(?:\s*[-–]\s*\d+)?)*\]/gi;
/** One entry or range inside a citation. */
const ITEM = /(\d+)(?:\s*[-–]\s*(\d+))?/g;
/** No judge cites a stretch of the log this long; a longer "range" is a misread. */
const MAX_RANGE = 200;

export type CitationPart = { text: string } | { seq: number };

/** A judge's text split into plain text and every number in a citation that names an entry of the agent's log. */
export function citationParts(text: string, entries: ReadonlySet<number>): CitationPart[] {
  const parts: CitationPart[] = [];
  let last = 0;
  for (const citation of text.matchAll(CITATION)) {
    for (const number of citation[0].matchAll(/\d+/g)) {
      const seq = Number(number[0]);
      if (entries.has(seq) === false) continue;
      const start = citation.index + number.index;
      if (start > last) parts.push({ text: text.slice(last, start) });
      parts.push({ seq });
      last = start + number[0].length;
    }
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** The log entries a judge's text cites, every entry of a cited range included. */
export function citedEntries(text: string | null): number[] {
  if (text === null) return [];
  return [...text.matchAll(CITATION)].flatMap((citation) => [...citation[0].matchAll(ITEM)].flatMap((item) => {
    const from = Number(item[1]);
    const to = item[2] === undefined ? from : Number(item[2]);
    if (to < from || to - from > MAX_RANGE) return [from];
    return Array.from({ length: to - from + 1 }, (_, offset) => from + offset);
  }));
}
