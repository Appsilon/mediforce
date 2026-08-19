import { createRouteAdapter } from '@/lib/route-adapter';
import { getCapabilities } from '@mediforce/platform-api/handlers';
import { GetCapabilitiesInputSchema } from '@mediforce/platform-api/contract';

/**
 * GET /api/capabilities
 *
 * Returns the capability statuses this deployment can answer for. Not
 * workspace-scoped — every authenticated caller gets the same answer — and the
 * response is derived, so no env var names or credentials cross the wire.
 */
export const GET = createRouteAdapter(GetCapabilitiesInputSchema, () => ({}), getCapabilities);
