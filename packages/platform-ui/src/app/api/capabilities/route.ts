import { createRouteAdapter } from '@/lib/route-adapter';
import { getCapabilities } from '@mediforce/platform-api/handlers';
import { GetCapabilitiesInputSchema } from '@mediforce/platform-api/contract';

/**
 * GET /api/capabilities
 *
 * Returns `{ capabilities: Record<string, CapabilityStatus> }` — what this
 * instance can actually run. Deployment-wide and not workspace-scoped; the
 * handler is `@public-handler`, and the response is derived so no env var
 * names or credentials cross the wire.
 */
export const GET = createRouteAdapter(GetCapabilitiesInputSchema, () => ({}), getCapabilities);
