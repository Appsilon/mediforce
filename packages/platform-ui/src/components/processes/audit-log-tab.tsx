'use client';

import * as React from 'react';
import Image from 'next/image';
import { format } from 'date-fns';
import { Check, CheckCircle2, ChevronRight, Printer, RotateCcw, Settings, User, UserCheck, XCircle, Bot } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { auditSignificance } from '@mediforce/platform-core';
import type { AuditEvent } from '@mediforce/platform-core';
import { cn } from '@/lib/utils';
import { SearchField } from '@/components/ui/search-field';
import { secondaryButtonClass } from '@/components/ui/button-styles';

/** Actor styling follows the executor chips in `step-status-panel` — human is
 *  orange, agent violet — so the same actor reads the same across the run. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ACTOR: Record<string, { Icon: LucideIcon; chip: string; text: string }> = {
  user: {
    Icon: User,
    chip: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/20 dark:text-orange-300 dark:border-orange-800',
    text: 'text-orange-700 dark:text-orange-300',
  },
  agent: {
    Icon: Bot,
    chip: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/20 dark:text-violet-300 dark:border-violet-800',
    text: 'text-violet-700 dark:text-violet-300',
  },
  system: {
    Icon: Settings,
    chip: 'bg-muted text-muted-foreground border-border',
    text: 'text-muted-foreground',
  },
};

type Outcome = 'approved' | 'rejected' | 'pending' | 'neutral';

const OUTCOME: Record<Outcome, { card: string; chip: string; text: string; Icon: LucideIcon }> = {
  approved: {
    card: 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/20',
    chip: 'border-green-300 bg-green-100 text-green-800 dark:border-green-700 dark:bg-green-900/40 dark:text-green-300',
    text: 'text-green-700 dark:text-green-400',
    Icon: CheckCircle2,
  },
  rejected: {
    card: 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/20',
    chip: 'border-red-300 bg-red-100 text-red-800 dark:border-red-700 dark:bg-red-900/40 dark:text-red-300',
    text: 'text-red-700 dark:text-red-400',
    Icon: XCircle,
  },
  pending: {
    card: 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20',
    chip: 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    text: 'text-amber-700 dark:text-amber-400',
    Icon: RotateCcw,
  },
  neutral: {
    card: 'border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/20',
    chip: 'border-orange-300 bg-orange-100 text-orange-800 dark:border-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
    text: 'text-orange-700 dark:text-orange-400',
    Icon: UserCheck,
  },
};

function actorOf(event: AuditEvent) {
  return ACTOR[event.actorType] ?? ACTOR.system;
}

/** The outcome a decision recorded, when the snapshot carries one. Drives the
 *  card's tone: an approval and a rejection should not look alike. */
function decisionOutcome(event: AuditEvent): Outcome {
  const verdict = event.outputSnapshot.verdict ?? event.inputSnapshot.verdict;
  if (typeof verdict !== 'string') return 'neutral';
  if (/^(approve|accept|pass)/i.test(verdict)) return 'approved';
  if (/^(reject|fail|deny)/i.test(verdict)) return 'rejected';
  if (/^(revise|escalate|rework)/i.test(verdict)) return 'pending';
  return 'neutral';
}

/** The run's own boundaries. They are the ends of the spine, so they stay in
 *  view rather than folding in with the machinery between decisions. */
const MILESTONE_ACTIONS: ReadonlySet<string> = new Set([
  'instance.created',
  'instance.started',
  'instance.completed',
  'instance.failed',
  'instance.cancelled',
]);

export type SpineItem =
  | { kind: 'decision'; event: AuditEvent }
  | { kind: 'milestone'; event: AuditEvent }
  | { kind: 'detail'; events: AuditEvent[] };

/**
 * The trail as a spine of decisions, everything between two of them folded into
 * one entry. Not grouped by step: most records are written without a `stepId`,
 * so those sections came out as scraps in the wrong order.
 */
export function toSpine(events: AuditEvent[]): SpineItem[] {
  const spine: SpineItem[] = [];

  for (const event of events) {
    if (auditSignificance(event) === 'decision') {
      spine.push({ kind: 'decision', event });
      continue;
    }
    if (MILESTONE_ACTIONS.has(event.action)) {
      spine.push({ kind: 'milestone', event });
      continue;
    }
    const last = spine[spine.length - 1];
    if (last !== undefined && last.kind === 'detail') last.events.push(event);
    else spine.push({ kind: 'detail', events: [event] });
  }
  return spine;
}

/** Quoted identifiers are the content of a description, so they carry the
 *  weight. The trailing "of instance '<uuid>'" is dropped — it names the page
 *  you are already on. */
export function describeParts(description: string): Array<{ text: string; strong: boolean }> {
  const trimmed = description.replace(/\s*(?:of|in)\s+instance\s+'[^']*'/gi, '');
  const parts: Array<{ text: string; strong: boolean }> = [];
  let cursor = 0;

  for (const match of trimmed.matchAll(/'([^']+)'/g)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ text: trimmed.slice(cursor, index), strong: false });
    const value = match[1];
    // A uuid is the least meaningful thing in the row and the longest. Keep the
    // leading segment — enough to match against a record elsewhere — and give
    // it no weight at all.
    parts.push(UUID.test(value)
      ? { text: value.slice(0, 8), strong: false }
      : { text: value, strong: true });
    cursor = index + match[0].length;
  }
  if (cursor < trimmed.length) parts.push({ text: trimmed.slice(cursor), strong: false });
  return parts.length > 0 ? parts : [{ text: trimmed, strong: false }];
}

const VERDICT_HEADLINES: Record<string, string> = {
  approve: 'Approved',
  approved: 'Approved',
  accept: 'Accepted',
  reject: 'Rejected',
  rejected: 'Rejected',
  revise: 'Sent back for revision',
  escalate: 'Escalated',
  escalated: 'Escalated',
  submitted: 'Submitted',
};

/** What a decision decided. The stored description leads with a task uuid,
 *  which is true and useless as the first thing a reviewer reads. */
export function headlineFor(event: AuditEvent): string {
  const verdict = event.outputSnapshot.verdict ?? event.inputSnapshot.verdict;
  if (typeof verdict === 'string') {
    const known = VERDICT_HEADLINES[verdict.toLowerCase()];
    if (known !== undefined) return known;
  }
  return event.description || event.action;
}

function Description({ text, className }: { text: string; className?: string }) {
  return (
    <span className={className}>
      {describeParts(text).map((part, index) => (
        part.strong
          ? <b key={index} className="font-semibold">{part.text}</b>
          : <React.Fragment key={index}>{part.text}</React.Fragment>
      ))}
    </span>
  );
}

/** Includes `headlineFor`: a decision's headline is derived from its verdict,
 *  so "Sent back for revision" is on the screen and in no stored field. */
export function matchesQuery(event: AuditEvent, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  const verdict = event.outputSnapshot.verdict ?? event.inputSnapshot.verdict;
  return [
    headlineFor(event),
    event.description,
    event.action,
    event.actorId,
    event.actorRole,
    event.basis,
    event.stepId ?? '',
    event.entityId,
    typeof verdict === 'string' ? verdict : '',
  ].some((field) => field.toLowerCase().includes(needle));
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

function RecordRow({ event, open }: { event: AuditEvent; open: boolean }) {
  const significance = auditSignificance(event);
  const outcome = decisionOutcome(event);
  const { Icon } = actorOf(event);
  const isDecision = significance === 'decision';

  const palette = OUTCOME[outcome];
  // A decision is marked by what was decided; only the routine rows still say
  // who by, where the actor is the whole of the information.
  const Marker = isDecision ? palette.Icon : Icon;

  return (
    <details open={open} className="group">
      <summary
        className={cn(
          'flex items-start gap-2.5 cursor-pointer list-none transition-colors',
          isDecision
            ? cn('rounded-md border px-3 py-2', palette.card)
            : 'rounded-sm -mx-2 px-2 py-1.5 hover:bg-muted/50',
        )}
      >
        <Marker className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', isDecision ? palette.text : 'text-muted-foreground')} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Description
              text={isDecision ? headlineFor(event) : (event.description || event.action)}
              className={cn('text-[13px]', isDecision && 'font-semibold')}
            />
            {isDecision && (
              <span className={cn('rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', palette.chip)}>
                Decision
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {event.actorId}
            {event.actorRole && <span className="text-muted-foreground/60"> · {event.actorRole}</span>}
          </span>
          {isDecision && event.basis && (
            <span className="mt-1 block text-xs">
              <span className="text-muted-foreground">Basis: </span>{event.basis}
            </span>
          )}
        </span>
        <span className="shrink-0 flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
          {format(new Date(event.timestamp), 'HH:mm:ss')}
          <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
        </span>
      </summary>

      <div className="ml-6 mb-2 mt-1.5 rounded-md border bg-muted/30 p-3 text-xs">
        <dl className="grid grid-cols-[minmax(0,88px)_minmax(0,1fr)] gap-x-3 gap-y-1">
          <Detail label="Action"><code className="font-mono">{event.action}</code></Detail>
          {isDecision && event.description && <Detail label="Recorded as">{event.description}</Detail>}
          {event.basis && !isDecision && <Detail label="Basis">{event.basis}</Detail>}
          <Detail label="Entity">
            <code className="font-mono">{event.entityType} / {event.entityId}</code>
          </Detail>
          <Detail label="Recorded">
            <span className="tabular-nums">{format(new Date(event.timestamp), 'yyyy-MM-dd HH:mm:ss')}</span>
          </Detail>
        </dl>
        {(Object.keys(event.inputSnapshot).length > 0 || Object.keys(event.outputSnapshot).length > 0) && (
          <details className="mt-2 border-t pt-2">
            <summary className="cursor-pointer list-none text-[11px] font-medium text-muted-foreground hover:text-foreground hover:underline">
              Show raw record
            </summary>
            <pre className="mt-1.5 overflow-x-auto rounded bg-muted p-2 text-[11px] leading-relaxed">
              {JSON.stringify({ input: event.inputSnapshot, output: event.outputSnapshot }, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </details>
  );
}

function DetailGroup({ events, open }: { events: AuditEvent[]; open: boolean }) {
  // Name what is inside so the group can be skipped without opening it.
  const kinds = [...new Set(events.map((event) => event.action.split('.').slice(-1)[0].replace(/_/g, ' ')))];

  return (
    <details open={open} className="group">
      <summary className="-mx-2 flex items-center gap-2 rounded-sm px-2 py-1.5 cursor-pointer list-none text-xs text-muted-foreground hover:bg-muted/50">
        <ChevronRight className="h-3 w-3 shrink-0 transition-transform group-open:rotate-90" />
        <span className="tabular-nums">{events.length} {events.length === 1 ? 'record' : 'records'}</span>
        <span className="truncate text-muted-foreground/60">{kinds.join(', ')}</span>
      </summary>
      <div className="ml-5 mt-1 space-y-0.5 border-l pl-3">
        {events.map((event, index) => (
          <div key={`${event.timestamp}-${index}`} className="flex items-baseline gap-2 py-0.5 text-xs text-muted-foreground">
            <span className="shrink-0 tabular-nums">{format(new Date(event.timestamp), 'HH:mm:ss')}</span>
            <Description text={event.description || event.action} className="min-w-0 truncate" />
            <code className="ml-auto shrink-0 font-mono text-[10px] opacity-70">{event.action}</code>
          </div>
        ))}
      </div>
    </details>
  );
}

type ActorFilter = 'all' | 'user' | 'agent' | 'system';

/** Written out rather than capitalised in CSS: `capitalize` changes the glyphs
 *  a sighted reader sees and nothing a screen reader hears. */
const ACTOR_FILTERS: ReadonlyArray<{ value: ActorFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'user', label: 'Human' },
  { value: 'agent', label: 'Agent' },
  { value: 'system', label: 'System' },
];

export function AuditLogTab({ events, loading, error, printable = true }: {
  events: AuditEvent[];
  loading: boolean;
  error?: Error | null;
  /** False while another pane is the one on screen. The print path keys off a
   *  single `data-print-root`; two on the page at once and printing the report
   *  would drag the trail along with it. */
  printable?: boolean;
}) {
  const [actorFilter, setActorFilter] = React.useState<ActorFilter>('all');
  const [decisionsOnly, setDecisionsOnly] = React.useState(false);
  const [query, setQuery] = React.useState('');
  // Remounts every row so `open` is applied again — `<details open>` is only
  // read on mount, so without this a second "Expand all" would do nothing.
  const [expansion, setExpansion] = React.useState<{ open: boolean; nonce: number } | null>(null);

  const visible = React.useMemo(() => events.filter((event) => {
    if (actorFilter !== 'all' && event.actorType !== actorFilter) return false;
    if (decisionsOnly && auditSignificance(event) !== 'decision') return false;
    if (!matchesQuery(event, query)) return false;
    return true;
  }), [events, actorFilter, decisionsOnly, query]);

  const decisionCount = React.useMemo(
    () => events.filter((event) => auditSignificance(event) === 'decision').length,
    [events],
  );
  const routineCount = React.useMemo(
    () => events.filter((event) => auditSignificance(event) === 'routine').length,
    [events],
  );

  if (loading) {
    return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 rounded bg-muted animate-pulse" />)}</div>;
  }

  if (error) {
    return (
      <div className="py-8 text-center text-sm text-destructive">
        Failed to load audit events: {error.message}
      </div>
    );
  }

  if (events.length === 0) {
    return <div className="py-8 text-center text-sm text-muted-foreground">No audit events</div>;
  }

  const spine = toSpine(visible);
  const allOpen = expansion?.open === true;

  return (
    // `data-print-root` hands this to the same print path the report uses: the
    // trail becomes the document, free of the panel that frames it on screen.
    <div {...(printable ? { 'data-print-root': true } : {})} className="space-y-4">
      {/* Two deliberate rows rather than one that wraps: at panel width the
          filters and three buttons never fit on a line, and letting them wrap
          left a single button stranded. Row one is what you are looking at,
          row two is what you do with it. */}
      <div className="space-y-2 print:hidden">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search records, actors, actions"
        />

        <div className="flex items-stretch gap-0.5 rounded-md border p-0.5">
          {ACTOR_FILTERS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setActorFilter(value)}
              aria-pressed={actorFilter === value}
              className={cn(
                'flex-1 rounded-sm px-2.5 py-1 text-sm font-medium transition-colors',
                actorFilter === value
                  ? 'bg-primary-subtle text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {/* A toggle has to look like one whether or not you can see colour:
              the box fills and takes a tick, it does not only change hue. */}
          <button
            onClick={() => setDecisionsOnly((prev) => !prev)}
            role="switch"
            aria-checked={decisionsOnly}
            className={cn(
              secondaryButtonClass,
              decisionsOnly && 'border-primary bg-primary-subtle text-primary',
            )}
          >
            <span
              className={cn(
                'grid h-3.5 w-3.5 place-items-center rounded-sm border transition-colors',
                decisionsOnly ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40',
              )}
            >
              {decisionsOnly && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
            </span>
            Decisions only
          </button>
          <button
            onClick={() => setExpansion((prev) => ({ open: prev?.open !== true, nonce: (prev?.nonce ?? 0) + 1 }))}
            className={secondaryButtonClass}
          >
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
          {/* Same print path as the report: `data-print-root` makes the trail the
              document, so this prints the records rather than the run page. */}
          <button
            onClick={() => window.print()}
            className={cn(secondaryButtonClass, 'ml-auto')}
          >
            <Printer className="h-4 w-4" />
            Print
          </button>
        </div>
      </div>

      <header className="hidden print:flex items-start gap-3 border-b pb-3">
        <Image src="/logo.png" alt="Mediforce" width={32} height={32} loading="eager" className="shrink-0" />
        <div className="min-w-0">
          <h1 className="font-headline text-lg font-semibold">Audit Trail</h1>
          <p className="text-xs text-muted-foreground">
            Generated {format(new Date(), 'MMMM d, yyyy HH:mm')}
          </p>
        </div>
      </header>

      <p className="text-xs text-muted-foreground tabular-nums">
        {events.length} records · {decisionCount} {decisionCount === 1 ? 'decision' : 'decisions'} · {routineCount} routine
      </p>

      {spine.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {query.trim() === '' ? 'No records match this filter.' : `No records match “${query.trim()}”.`}
        </p>
      )}

      <div className="space-y-1">
        {spine.map((item, index) => {
          const key = `${expansion?.nonce ?? 0}-${index}`;
          if (item.kind === 'detail') return <DetailGroup key={key} events={item.events} open={allOpen} />;
          return <RecordRow key={key} event={item.event} open={allOpen} />;
        })}
      </div>
    </div>
  );
}
