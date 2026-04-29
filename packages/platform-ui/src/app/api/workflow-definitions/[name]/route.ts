import { NextResponse, type NextRequest } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';
import { getCallerNamespaces } from '../auth.js';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
): Promise<NextResponse> {
  const { name } = await params;
  const versionParam = request.nextUrl.searchParams.get('version');

  const { processRepo, namespaceRepo } = getPlatformServices();
  const callerNs = await getCallerNamespaces(request, namespaceRepo);
  if (callerNs instanceof NextResponse) return callerNs;

  let version: number;
  if (versionParam !== null) {
    version = Number(versionParam);
    if (!Number.isInteger(version) || version < 1) {
      return NextResponse.json(
        { error: `Invalid version: ${versionParam}` },
        { status: 400 },
      );
    }
  } else {
    version = await processRepo.getLatestWorkflowVersion(name);
    if (version === 0) {
      return NextResponse.json(
        { error: `Workflow '${name}' not found` },
        { status: 404 },
      );
    }
  }

  const definition = await processRepo.getWorkflowDefinition(name, version);
  if (definition === null) {
    return NextResponse.json(
      { error: `Workflow '${name}' v${version} not found` },
      { status: 404 },
    );
  }

  if (callerNs !== null && !callerNs.has(definition.namespace)) {
    return NextResponse.json(
      { error: `Workflow '${name}' not found` },
      { status: 404 },
    );
  }

  return NextResponse.json({ definition });
}
