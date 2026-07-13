import { routes } from '@/lib/routes';

/**
 * Top-level list sections that exist identically in every workspace, keyed to
 * the centralized route builder (`routes`) — the single source of truth for
 * app URLs. When a user is on one of these *list* routes, switching workspace
 * should land on the equivalent list in the target workspace rather than the
 * workspace root.
 */
const SECTION_ROUTES: Record<string, (handle: string) => string> = {
  runs: routes.runs,
  agents: routes.agents,
  tools: routes.tools,
  tasks: routes.tasks,
  monitoring: routes.monitoring,
};

/**
 * Build the href the namespace switcher should navigate to when leaving
 * `currentHandle` for `targetHandle`.
 *
 * Preserves the current top-level section when the user is on a stable list
 * route (`/runs`, `/agents`, `/tools`, `/tasks`, `/monitoring`) — those lists
 * exist in every workspace, so the equivalent view is the right landing.
 * Falls back to the workspace root `/{targetHandle}` for everything else:
 * resource-detail routes (a specific workflow name or run id) and the home
 * page itself. A resource id from one workspace won't resolve in another, so
 * root is the safe landing there.
 */
export function workspaceSwitchHref(
  pathname: string,
  currentHandle: string,
  targetHandle: string,
): string {
  const prefix = currentHandle !== '' ? `/${currentHandle}` : '';
  const rest = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname;
  const segments = rest.split('/').filter(Boolean);
  const [section] = segments;
  const buildSectionRoute = SECTION_ROUTES[section ?? ''];
  const isStableList = segments.length === 1 && buildSectionRoute !== undefined;
  return isStableList ? buildSectionRoute(targetHandle) : routes.home(targetHandle);
}
