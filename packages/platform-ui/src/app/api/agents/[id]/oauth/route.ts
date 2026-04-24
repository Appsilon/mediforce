import { NextResponse } from 'next/server';
import { PublicAgentOAuthTokenSchema } from '@mediforce/platform-core';
import { getPlatformServices } from '@/lib/platform-services';
import {
  requireFirebaseUid,
  requireNamespaceFromQuery,
  requireNamespaceMembership,
} from './_shared/auth';

/** GET /api/agents/:id/oauth?namespace=X
 *
 *  Returns the "connected" status for every server on this agent that has
 *  a persisted OAuth token. Access and refresh tokens are stripped — this
 *  shape is safe to display in the agent editor.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: agentId } = await params;

  const uidOrResponse = await requireFirebaseUid(request);
  if (uidOrResponse instanceof NextResponse) return uidOrResponse;
  const uid = uidOrResponse;

  const namespaceOrResponse = await requireNamespaceFromQuery(request);
  if (namespaceOrResponse instanceof NextResponse) return namespaceOrResponse;
  const namespace = namespaceOrResponse;

  const services = getPlatformServices();
  const membershipFailure = await requireNamespaceMembership({
    namespaceRepo: services.namespaceRepo,
    namespace,
    uid,
  });
  if (membershipFailure !== undefined) return membershipFailure;

  const entries = await services.agentOAuthTokenRepo.listByAgent(namespace, agentId);

  const tokens = entries.map((entry) => {
    const publicSlice = PublicAgentOAuthTokenSchema.parse({
      provider: entry.provider,
      expiresAt: entry.expiresAt,
      scope: entry.scope,
      providerUserId: entry.providerUserId,
      accountLogin: entry.accountLogin,
      connectedAt: entry.connectedAt,
      connectedBy: entry.connectedBy,
    });
    return { ...publicSlice, serverName: entry.serverName };
  });

  return NextResponse.json({ tokens });
}
