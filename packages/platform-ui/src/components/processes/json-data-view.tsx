'use client';

import * as React from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import { ChevronDown } from 'lucide-react';
import { MarkdownPresentation } from '@/components/tasks/markdown-presentation';
import { cn } from '@/lib/utils';

type ViewMode = 'formatted' | 'raw';

/**
 * Any JSON value — a step's `result.json` or a `.json` Output File — shown
 * formatted (labelled fields, markdown rendered, rule lists as cards, YAML/JSON
 * strings as code blocks) with a toggle to the raw JSON.
 */
export function JsonDataView({ value }: { value: unknown }) {
  const [mode, setMode] = React.useState<ViewMode>('formatted');

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <div className="inline-flex rounded-md border p-0.5 text-xs" role="group" aria-label="JSON view">
          {(['formatted', 'raw'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setMode(option)}
              aria-pressed={mode === option}
              className={cn(
                'rounded px-2 py-0.5 transition-colors',
                mode === option ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option === 'formatted' ? 'Formatted' : 'Raw'}
            </button>
          ))}
        </div>
      </div>

      {mode === 'formatted' ? (
        <div data-testid="json-formatted">
          <FormattedValue value={value} />
        </div>
      ) : (
        <pre
          className="whitespace-pre-wrap break-words rounded-md bg-muted p-4 text-xs"
          data-testid="json-raw"
        >
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  );
}

function FormattedValue({ value }: { value: unknown }) {
  if (isPlainObject(value)) return <ObjectSummary data={value} />;
  if (isObjectArray(value)) return <RecordList items={value} />;
  return <MetadataValue value={value} />;
}

// ── Object summary ──────────────────────────────────────────────────────────

type EntryKind = 'object-array' | 'short' | 'markdown' | 'yaml' | 'long-text';

const MARKDOWN_KEY_PATTERN = /^pr[-_ ]?body$|^body$|^markdown$|^notes$|^description$/i;
const YAML_KEY_PATTERN = /_yaml$|_json$/i;
const LONG_TEXT_CHAR_THRESHOLD = 200;
const SHORT_STRING_CHAR_THRESHOLD = 80;

function looksLikeMarkdown(value: string): boolean {
  return (
    value.includes('\n\n') &&
    (
      /(^|\n)#{1,6}\s/.test(value) ||
      /\*\*[^*]+\*\*/.test(value) ||
      /(^|\n)\s*-\s\[[ x]\]\s/.test(value) ||
      /^\s*#\s/.test(value)
    )
  );
}

/**
 * True for strings that look like a structured code block — YAML (`---`,
 * `- key:`) or JSON shape (`{` / `[`). Used to route values into a strict
 * <pre> block so their structure is preserved.
 */
function looksLikeStructuredString(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith('---')) return true;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return true;
  // YAML list of objects: "- key:" on first non-empty line
  return /^- \w+:/.test(trimmed);
}

function classifyEntry(key: string, value: unknown): EntryKind {
  if (isObjectArray(value)) return 'object-array';
  if (typeof value === 'string') {
    if (YAML_KEY_PATTERN.test(key) || looksLikeStructuredString(value)) {
      if (value.length > SHORT_STRING_CHAR_THRESHOLD || value.includes('\n')) return 'yaml';
    }
    if (MARKDOWN_KEY_PATTERN.test(key) && value.length > SHORT_STRING_CHAR_THRESHOLD) return 'markdown';
    if (looksLikeMarkdown(value)) return 'markdown';
    if (value.length > LONG_TEXT_CHAR_THRESHOLD || value.includes('\n')) return 'long-text';
  }
  return 'short';
}

interface ClassifiedEntry {
  key: string;
  value: unknown;
  kind: EntryKind;
}

function ObjectSummary({ data }: { data: Record<string, unknown> }) {
  const classified = React.useMemo<ClassifiedEntry[]>(
    () =>
      Object.entries(data)
        .filter(([, value]) => isEmptyValue(value) === false)
        .map(([key, value]) => ({ key, value, kind: classifyEntry(key, value) })),
    [data],
  );

  if (classified.length === 0) {
    return <p className="text-sm text-muted-foreground">No fields to show.</p>;
  }

  const ofKind = (kind: EntryKind) => classified.filter((entry) => entry.kind === kind);
  const shortEntries = ofKind('short');

  return (
    <div className="space-y-4">
      {ofKind('object-array').map(({ key, value }) => (
        <ObjectArrayBlock key={key} entryKey={key} value={value as Record<string, unknown>[]} />
      ))}

      {shortEntries.length > 0 && (
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
          {shortEntries.map(({ key, value }) => (
            <div key={key}>
              <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-0.5">
                {formatKey(key)}
              </dt>
              <dd className="text-sm">
                <MetadataValue value={value} />
              </dd>
            </div>
          ))}
        </dl>
      )}

      {ofKind('markdown').map(({ key, value }) => (
        <MarkdownBlock key={key} entryKey={key} value={value as string} />
      ))}

      {ofKind('yaml').map(({ key, value }) => (
        <CodeBlock key={key} entryKey={key} value={value as string} />
      ))}

      {ofKind('long-text').map(({ key, value }) => (
        <LongTextBlock key={key} entryKey={key} value={value as string} />
      ))}
    </div>
  );
}

function ObjectArrayBlock({ entryKey, value }: { entryKey: string; value: Record<string, unknown>[] }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
        {formatKey(entryKey)} <span className="normal-case font-normal text-muted-foreground/70">({value.length})</span>
      </dt>
      <dd className="text-sm">
        <RecordList items={value} />
      </dd>
    </div>
  );
}

/** A list of objects: rule cards when every item looks like a rule, plain cards otherwise. */
function RecordList({ items }: { items: Record<string, unknown>[] }) {
  const allRuleLike = items.every((item) => isRuleLike(item));

  return (
    <div className="space-y-2">
      {items.map((item, index) =>
        allRuleLike ? <RuleCard key={index} item={item} /> : <ObjectCard key={index} item={item} />,
      )}
    </div>
  );
}

/** A rule-like entry has both `message` and at least one of `id`/`severity`. */
function isRuleLike(item: Record<string, unknown>): boolean {
  const hasMessage = typeof item.message === 'string' && item.message.length > 0;
  const hasIdOrSeverity = typeof item.id === 'string' || typeof item.severity === 'string';
  return hasMessage && hasIdOrSeverity;
}

const RULE_PRIMARY_KEYS = new Set(['id', 'domain', 'severity', 'message', 'variable', 'check']);

function severityClassName(value: string): string {
  const normalized = value.toLowerCase().trim();
  if (/(critical|fatal|error)/.test(normalized)) {
    return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300';
  }
  if (/(major|high)/.test(normalized)) {
    return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
  }
  if (/(warn|warning|medium|moderate)/.test(normalized)) {
    return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300';
  }
  return 'bg-muted text-muted-foreground';
}

function RuleCard({ item }: { item: Record<string, unknown> }) {
  const id = typeof item.id === 'string' ? item.id : null;
  const domain = typeof item.domain === 'string' ? item.domain : null;
  const severity = typeof item.severity === 'string' ? item.severity : null;
  const message = typeof item.message === 'string' ? item.message : null;
  const variable = typeof item.variable === 'string' ? item.variable : null;
  const check = typeof item.check === 'string' ? item.check : null;

  const otherEntries = Object.entries(item).filter(
    ([key, value]) => RULE_PRIMARY_KEYS.has(key) === false && isEmptyValue(value) === false,
  );

  const meta: React.ReactNode[] = [];
  if (variable) meta.push(<span key="variable" className="font-mono">{variable}</span>);
  if (check) meta.push(<span key="check" className="font-mono">{check}</span>);

  return (
    <div className="rounded-md border p-3 hover:bg-muted/30 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {id && <span className="font-mono text-xs font-medium truncate">{id}</span>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {domain && (
            <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              {domain}
            </span>
          )}
          {severity && (
            <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium', severityClassName(severity))}>
              {severity}
            </span>
          )}
        </div>
      </div>
      {message && (
        <p className="mt-1.5 text-sm leading-normal break-words">{message}</p>
      )}
      {meta.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          {meta.map((node, index) => (
            <React.Fragment key={index}>
              {index > 0 && <span aria-hidden>·</span>}
              {node}
            </React.Fragment>
          ))}
        </div>
      )}
      {otherEntries.length > 0 && (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          {otherEntries.map(([subKey, subValue]) => (
            <div key={subKey}>
              <dt className="text-muted-foreground font-medium mb-0.5">{formatKey(subKey)}</dt>
              <dd className="break-words">
                <MetadataValue value={subValue} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function ObjectCard({ item }: { item: Record<string, unknown> }) {
  const entries = Object.entries(item);
  // Use a 2-col grid when every value is short; otherwise fall back to single column.
  const allShort = entries.every(([, entryValue]) => {
    if (entryValue === null || entryValue === undefined) return true;
    if (typeof entryValue === 'string') {
      return entryValue.length <= SHORT_STRING_CHAR_THRESHOLD && entryValue.includes('\n') === false;
    }
    return typeof entryValue === 'number' || typeof entryValue === 'boolean';
  });

  return (
    <div className="rounded-md border bg-muted/30 p-2">
      <KeyValueList entries={entries} columns={allShort ? 2 : 1} />
    </div>
  );
}

function MarkdownBlock({ entryKey, value }: { entryKey: string; value: string }) {
  return (
    <Collapsible.Root defaultOpen>
      <dt className="mb-1">
        <Collapsible.Trigger className="group inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors">
          <ChevronDown className="h-3 w-3 transition-transform group-data-[state=closed]:-rotate-90" />
          {formatKey(entryKey)}
        </Collapsible.Trigger>
      </dt>
      <dd className="text-sm">
        <Collapsible.Content>
          <div className="overflow-auto max-h-[400px] rounded-md border bg-muted/20 p-3">
            <MarkdownPresentation content={value} />
          </div>
        </Collapsible.Content>
      </dd>
    </Collapsible.Root>
  );
}

/** Strict-pre code block for YAML/JSON-shaped strings — preserves structure exactly. */
function CodeBlock({ entryKey, value }: { entryKey: string; value: string }) {
  const lineCount = value.split('\n').length;

  return (
    <CollapsedText entryKey={entryKey} summary={`${lineCount} line${lineCount === 1 ? '' : 's'}`}>
      <pre className="mt-2 rounded-md bg-muted p-3 text-xs leading-relaxed font-mono whitespace-pre overflow-x-auto max-h-[400px] overflow-y-auto">
        <code>{value}</code>
      </pre>
    </CollapsedText>
  );
}

function LongTextBlock({ entryKey, value }: { entryKey: string; value: string }) {
  const lineCount = value.split('\n').length;
  const preview = value.slice(0, 60).replace(/\s+/g, ' ').trim();
  const summary = lineCount > 1 ? `${lineCount} lines` : `${preview}${value.length > 60 ? '…' : ''}`;

  return (
    <CollapsedText entryKey={entryKey} summary={summary}>
      <pre className="mt-2 rounded-md bg-muted p-3 text-xs overflow-auto max-h-[400px] whitespace-pre-wrap break-words font-mono">
        {value}
      </pre>
    </CollapsedText>
  );
}

function CollapsedText({ entryKey, summary, children }: { entryKey: string; summary: string; children: React.ReactNode }) {
  return (
    <Collapsible.Root>
      <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
        {formatKey(entryKey)}
      </dt>
      <dd>
        <Collapsible.Trigger className="group inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <ChevronDown className="h-3 w-3 transition-transform group-data-[state=closed]:-rotate-90" />
          <span>{summary}</span>
        </Collapsible.Trigger>
        <Collapsible.Content>{children}</Collapsible.Content>
      </dd>
    </Collapsible.Root>
  );
}

// ── Values ──────────────────────────────────────────────────────────────────

function MetadataValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground italic">-</span>;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (typeof parsed === 'object' && parsed !== null) {
          return <MetadataValue value={parsed} />;
        }
      } catch {
        // Not valid JSON, fall through to plain string
      }
    }
    if (/^https?:\/\//.test(trimmed)) {
      return (
        <a
          href={trimmed}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline break-all"
        >
          {trimmed}
        </a>
      );
    }
    return <span className="whitespace-pre-wrap break-words">{value}</span>;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return <span className="font-mono text-xs">{String(value)}</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground italic">None</span>;

    if (value.every((item) => typeof item === 'string')) {
      return (
        <div className="flex flex-wrap gap-1.5">
          {value.map((item, index) => (
            <span key={index} className="inline-flex rounded-full bg-muted px-2.5 py-0.5 text-xs">
              {item}
            </span>
          ))}
        </div>
      );
    }

    return (
      <div className="space-y-1.5">
        {value.map((item, index) => (
          <div key={index} className="rounded-md border bg-muted/30 p-2">
            {isPlainObject(item) ? (
              <KeyValueList entries={Object.entries(item)} columns={1} />
            ) : (
              <span className="text-xs"><MetadataValue value={item} /></span>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (isPlainObject(value)) {
    return (
      <div className="rounded-md border bg-muted/30 p-2">
        <KeyValueList entries={Object.entries(value)} columns={1} />
      </div>
    );
  }

  return <span>{String(value)}</span>;
}

function KeyValueList({ entries, columns }: { entries: [string, unknown][]; columns: 1 | 2 }) {
  return (
    <dl className={cn('grid gap-y-1 text-xs', columns === 2 ? 'grid-cols-2 gap-x-3' : 'grid-cols-1')}>
      {entries.map(([subKey, subValue]) => (
        <div key={subKey}>
          <dt className="text-muted-foreground font-medium mb-0.5">{formatKey(subKey)}</dt>
          <dd className="break-words">
            <MetadataValue value={subValue} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Array.isArray(value) === false;
}

function isObjectArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => isPlainObject(item));
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.keys(value).length === 0;
  return false;
}

function formatKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
