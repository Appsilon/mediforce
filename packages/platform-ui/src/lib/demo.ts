/**
 * Demo scenarios: the showcase counterpart to the guide in `tour.ts`.
 *
 * Where a guide chapter explains the page you are already on, a scenario walks
 * one job across several pages — and the viewer does the clicking. A step says
 * where it happens; arriving there is what advances it.
 */

export type DemoStep = {
  id: string;
  title: string;
  body: string;
  /** `data-tour` value to spotlight. Absent, or absent from the page, narrates centred. */
  target?: string;
  /**
   * Route pattern this step belongs to, in `chapterForPath` syntax. When the
   * viewer is somewhere else the card says where to go; arriving advances it.
   * Omitted means the step belongs wherever the previous one left off.
   */
  route?: string;
  /** What the viewer does here, shown as the step's call to action. */
  action?: string;
};

export type DemoScenario = {
  id: string;
  title: string;
  /** One line, shown in the scenario picker. */
  blurb: string;
  /** Roughly how long it takes to walk, shown beside the blurb. */
  minutes: number;
  steps: DemoStep[];
};

const DEMO_DOMAIN = 'appsilon.com';

export function isAppsilonEmail(email: string | null | undefined): boolean {
  const parts = (email ?? '').toLowerCase().split('@');
  return parts.length === 2 && parts[1] === DEMO_DOMAIN;
}

/**
 * Whether to offer the demo at all.
 *
 * Normally it is an Appsilon address. `NEXT_PUBLIC_DEMO_MODE` opens it for
 * everyone, which is how `pnpm dev:mock` makes the scenarios walkable against
 * seeded data without holding an Appsilon session. Unset means off, so a
 * deployment that never sets it keeps the domain rule — the flag has to be
 * chosen, never inherited.
 */
export function offersDemo(
  email: string | null | undefined,
  opts: { demoModeEnabled: boolean },
): boolean {
  return opts.demoModeEnabled || isAppsilonEmail(email);
}

/**
 * The concrete URL for a step's route, or `null` when it cannot be built.
 *
 * Parameters are filled from the path the viewer is already on, matched by
 * position, and otherwise from `run` — the real run the scenario picked out of
 * this workspace. With neither, it resolves to `null` and the card narrates
 * where to go rather than guessing a URL that would 404.
 */
export function resolveDemoRoute(
  route: string,
  pathname: string,
  run?: DemoRunCandidate | null,
): string | null {
  const [path, query] = route.split('?');
  const wanted = (path ?? '').split('/').filter((part) => part !== '');
  const current = pathname.split('/').filter((part) => part !== '');

  const fromRun: Record<string, string | undefined> = {
    ':name': run?.definitionName,
    ':runId': run?.id,
  };

  const filled: string[] = [];
  for (const [index, part] of wanted.entries()) {
    if (!part.startsWith(':')) {
      filled.push(part);
      continue;
    }
    // The path the viewer is on wins: if they already opened a workflow, the
    // scenario stays on theirs rather than hopping to the one it chose.
    const resolved = current[index] ?? fromRun[part];
    if (resolved === undefined || resolved === '') return null;
    filled.push(resolved);
  }

  const built = `/${filled.join('/')}`;
  return query === undefined ? built : `${built}?${query}`;
}

/** The little a scenario needs to point at a real run. */
export type DemoRunCandidate = {
  id: string;
  definitionName: string;
  status: string;
  startedAt?: string;
};

/**
 * Rank: 0 is the best run to demonstrate.
 *
 * A completed run is the only one that has the whole story — every step ran,
 * the log is finished and the report exists — so it wins outright. A run
 * waiting on a person comes next, because that pause is itself a thing worth
 * showing. Anything still moving may finish mid-demo, and a failed or
 * cancelled run is the one thing not to open in front of a customer.
 */
function demoRunRank(status: string): number {
  if (status === 'completed') return 0;
  if (status === 'waiting_for_human' || status === 'paused') return 1;
  if (status === 'running' || status === 'in_progress') return 2;
  return 3;
}

/**
 * The run a scenario should open, or `null` when the workspace has none.
 * Ties break on recency, so the same workspace always demonstrates the same
 * run rather than whichever row the query happened to return first.
 */
export function pickDemoRun(runs: readonly DemoRunCandidate[]): DemoRunCandidate | null {
  const ranked = [...runs].sort((a, b) => {
    const byStatus = demoRunRank(a.status) - demoRunRank(b.status);
    if (byStatus !== 0) return byStatus;
    return (b.startedAt ?? '').localeCompare(a.startedAt ?? '');
  });
  return ranked[0] ?? null;
}
