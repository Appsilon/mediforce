const CITATION = /\[(\d+)\]/g;

export type CitationPart = { text: string } | { seq: number };

/** A judge's text split into plain text and every `[n]` that names an entry of the agent's log. */
export function citationParts(text: string, entries: ReadonlySet<number>): CitationPart[] {
  const parts: CitationPart[] = [];
  let last = 0;
  for (const match of text.matchAll(CITATION)) {
    const seq = Number(match[1]);
    if (entries.has(seq) === false) continue;
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ seq });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** The log entries a judge's text cites, as `[n]`. */
export function citedEntries(text: string | null): number[] {
  return text === null ? [] : [...text.matchAll(CITATION)].map((match) => Number(match[1]));
}
