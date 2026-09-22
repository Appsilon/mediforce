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
