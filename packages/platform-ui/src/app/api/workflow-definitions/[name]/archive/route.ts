import { NextResponse, type NextRequest } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';
import { getCallerNamespaces } from '../../auth.js';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
): Promise<NextResponse> {
  const { name } = await params;

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

  try {
    await processRepo.setProcessArchived(name, archived);
    return NextResponse.json({ success: true, name, archived });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
