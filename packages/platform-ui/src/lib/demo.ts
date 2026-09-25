/**
 * Demo scenarios: the showcase counterpart to the guide in `tour.ts`.
 *
 * Where a guide chapter explains the page you are already on, a scenario walks
 * one job across several pages — and the viewer does the clicking. A step says
 * where it happens; arriving there is what advances it.
 */

import { matchesRoute, type TourStep } from './tour';

/** A scenario step is a tour step that also knows where it happens. */
export type DemoStep = TourStep;

/** A step's route without its query — the part `matchesRoute` understands. */
export function routePattern(step: Pick<DemoStep, 'route'>): string | null {
  return step.route?.split('?')[0] ?? null;
}

/** The names a step's route still needs filled, e.g. `[':name', ':runId']`. */
export function routeParams(step: Pick<DemoStep, 'route'>): string[] {
  return (routePattern(step) ?? '')
    .split('/')
    .filter((part) => part.startsWith(':'));
}

export type DemoScenario = {
  id: string;
  title: string;
  /** Shown under the title in the scenario picker. */
  blurb: string;
  /** Rough walking time, shown beside the blurb. */
  minutes: number;
  steps: DemoStep[];
};

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
  // `:name` and `:runId` name one run between them, so they are filled from one
  // source or neither. Taking the workflow from the path and the run id from a
  // workspace-wide pick produced `/ns/workflows/foo/runs/<a-run-of-bar>`.
  const needsRunId = route.includes(':runId');
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
    const resolved = needsRunId && part in fromRun
      ? fromRun[part]
      : current[index] ?? fromRun[part];
    if (resolved === undefined || resolved === '') return null;
    filled.push(resolved);
  }

  const built = `/${filled.join('/')}`;
  return query === undefined ? built : `${built}?${query}`;
}

export type DemoRunCandidate = {
  id: string;
  definitionName: string;
  status: string;
  startedAt?: string;
};

/**
 * Lower is better to demonstrate. Completed wins outright — it is the only
 * status with the whole story, log finished and report written. A run waiting
 * on a person comes next because that pause is worth showing; anything still
 * moving may finish mid-demo; a failed run is what not to open in front of a
 * customer.
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

/**
 * What a running scenario should do about where the viewer currently is.
 *
 * One rule rather than four interacting ones, so two of them can never
 * disagree about the same pathname.
 */
export type DemoRouteAction =
  | { kind: 'stay' }
  | { kind: 'advance'; index: number }
  | { kind: 'navigate'; url: string }
  /** No URL can be built — the viewer has to go somewhere first. */
  | { kind: 'unreachable'; needs: string };

export function nextRouteAction(input: {
  steps: readonly DemoStep[];
  index: number;
  pathname: string;
  currentUrl: string;
  run: DemoRunCandidate | null;
}): DemoRouteAction {
  const { steps, index, pathname, currentUrl, run } = input;
  const covers = (step: DemoStep | undefined): boolean => {
    const pattern = step === undefined ? null : routePattern(step);
    return pattern !== null && matchesRoute(pattern, pathname);
  };

  // The viewer walking to a later step's page is how they advance, and it wins
  // over navigation so the two can never fight over the same pathname.
  const arrivedAt = steps.findIndex((step, at) => at > index && covers(step));
  if (arrivedAt !== -1 && !covers(steps[index])) return { kind: 'advance', index: arrivedAt };

  const step = steps[index];
  if (step?.route === undefined) return { kind: 'stay' };
  const url = resolveDemoRoute(step.route, pathname, run);
  if (url === null) return { kind: 'unreachable', needs: unreachableReason(step) };
  if (url === currentUrl) return { kind: 'stay' };
  return { kind: 'navigate', url };
}

/**
 * What the viewer has to do before a step can be reached. A run id can only
 * come from a run, so an empty workspace is told that rather than shown a
 * spotlight with nothing under it.
 */
function unreachableReason(step: TourStep): string {
  const params = routeParams(step);
  if (params.includes(':runId')) return 'This step needs a run. Start one, then come back.';
  if (params.includes(':name')) return 'This step needs a workflow. Open one, then come back.';
  return 'This step is on a page that is not open yet.';
}

/** Where a scenario should open for a viewer already standing somewhere. */
export function startingIndex(steps: readonly DemoStep[], pathname: string): number {
  const here = steps.findIndex((step) => {
    const pattern = routePattern(step);
    return pattern !== null && matchesRoute(pattern, pathname);
  });
  return here === -1 ? 0 : here;
}
