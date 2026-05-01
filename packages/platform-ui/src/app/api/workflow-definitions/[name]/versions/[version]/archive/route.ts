import { NextResponse, type NextRequest } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';
import { getCallerNamespaces } from '../../../../auth.js';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string; version: string }> },
): Promise<NextResponse> {
  const { name, version: versionStr } = await params;
  const version = Number(versionStr);
  if (!Number.isInteger(version) || version < 1) {
    return NextResponse.json(
      { error: `Invalid version: ${versionStr}` },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const archived = (body as { archived?: unknown })?.archived;
  if (typeof archived !== 'boolean') {
    return NextResponse.json(
      { error: '`archived` (boolean) is required in request body' },
      { status: 400 },
    );
  }

  const { processRepo, namespaceRepo } = getPlatformServices();
  const callerNs = await getCallerNamespaces(request, namespaceRepo);
  if (callerNs instanceof NextResponse) return callerNs;

  // Skip getWorkflowDefinition() — it uses safeParse and returns null for
  // schema-invalid versions, which are exactly the ones we want to archive.
  // setVersionArchived checks doc existence directly in Firestore.
  try {
    await processRepo.setVersionArchived(name, version, archived);
    return NextResponse.json({ success: true, name, version, archived });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status = message.includes('not found') ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
