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
 * `:handle` and any other parameter are filled from the path the viewer is
 * already on, matched by position. A scenario cannot invent a workflow name or
 * a run id, so a step that needs one the viewer has not opened yet resolves to
 * `null` and the card narrates where to go instead of guessing a URL.
 */
export function resolveDemoRoute(route: string, pathname: string): string | null {
  const [path, query] = route.split('?');
  const wanted = (path ?? '').split('/').filter((part) => part !== '');
  const current = pathname.split('/').filter((part) => part !== '');

  const filled: string[] = [];
  for (const [index, part] of wanted.entries()) {
    if (!part.startsWith(':')) {
      filled.push(part);
      continue;
    }
    const fromCurrent = current[index];
    if (fromCurrent === undefined || fromCurrent === '') return null;
    filled.push(fromCurrent);
  }

  const built = `/${filled.join('/')}`;
  return query === undefined ? built : `${built}?${query}`;
}
