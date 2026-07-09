import { createRouteAdapter } from '@/lib/route-adapter';
import { getDockerInfo } from '@mediforce/platform-api/handlers';
import {
  GetDockerInfoInputSchema,
  type GetDockerInfoInput,
} from '@mediforce/platform-api/contract';

/**
 * GET /api/system/docker-info
 *
 * Public to every authenticated user — used by the workflow editor,
 * start-run flow, processes-problems panel, and admin infrastructure
 * page. Single-tenant deployments today; namespaces split teams inside
 * one tenant, not separate organisations.
 */
export const GET = createRouteAdapter<typeof GetDockerInfoInputSchema, GetDockerInfoInput>(
  GetDockerInfoInputSchema,
  () => ({}),
  getDockerInfo,
);
