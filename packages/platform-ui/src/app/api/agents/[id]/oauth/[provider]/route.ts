import { NextResponse } from 'next/server';
import type { OAuthProviderConfig } from '@mediforce/platform-core';
import { getPlatformServices } from '@/lib/platform-services';
import {
  requireFirebaseUid,
  requireNamespaceFromQuery,
  requireNamespaceMembership,
} from '../_shared/auth';

/** DELETE /api/agents/:id/oauth/:provider?namespace=X&serverName=Y&revokeAtProvider=Z
 *
 *  Two revocation flavors (Q9 = 9c):
 *   - revokeAtProvider=false (default): drops the token locally only. The
 *     provider-side grant remains — user can revoke it in GitHub/Google UI
 *     if they want to. Appropriate when users disconnect because they no
 *     longer want the platform to use the access, but keep their grant.
 *   - revokeAtProvider=true: additionally POSTs to provider.revokeUrl.
 *     Provider failure is non-blocking — we still delete the local token
 *     and return 200. The destructive semantics belong in the UI's confirm
 *     copy.
 */

async function revokeAtProvider(
  provider: OAuthProviderConfig,
  accessToken: string,
): Promise<void> {
  if (provider.revokeUrl === undefined) return;
  const body = new URLSearchParams({ token: accessToken });
  try {
    await fetch(provider.revokeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });
  } catch {
    // Fire-and-forget: local delete always proceeds even on network failure.
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; provider: string }> },
): Promise<NextResponse> {
  const { id: agentId, provider: providerSlug } = await params;

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

  const url = new URL(request.url);
  const serverName = url.searchParams.get('serverName') ?? '';
  const revokeFlag = url.searchParams.get('revokeAtProvider') === 'true';

  if (serverName === '') {
    return NextResponse.json(
      { error: 'Missing required query parameter: serverName' },
      { status: 400 },
    );
  }

  if (revokeFlag) {
    const [token, provider] = await Promise.all([
      services.agentOAuthTokenRepo.get(namespace, agentId, serverName),
      services.oauthProviderRepo.get(namespace, providerSlug),
    ]);
    if (token !== null && provider !== null) {
      await revokeAtProvider(provider, token.accessToken);
    }
  }

  await services.agentOAuthTokenRepo.delete(namespace, agentId, serverName);
  return NextResponse.json({ success: true });
}
