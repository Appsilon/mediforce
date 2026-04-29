import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { getAdminAuth } from '@mediforce/platform-infra';

/**
 * Serves agent output files from allowed directories.
 *
 * Two query modes are supported, both authenticated via Firebase ID token:
 *
 *   1. Explicit path:   `?path=<absolute>&instanceId=<id>`
 *      The path must start with one of the instance-specific allowed
 *      prefixes. Returns the file as an `attachment` (download).
 *
 *   2. Deliverable lookup: `?instanceId=<id>&stepId=<id>&kind=presentation`
 *      The server composes the path
 *      `<tmpdir()>/mediforce-deliverables/<instanceId>/<stepId>-presentation.html`
 *      using the convention written by `BaseContainerAgentPlugin`. Useful
 *      for the UI which doesn't know `tmpdir()`. Returns the file inline
 *      (`Content-Disposition: inline`) so it can be embedded as iframe
 *      srcdoc via fetch+text.
 *
 * Both modes validate the resolved path against instance-specific prefixes
 * to prevent cross-tenant access.
 */

type DeliverableKind = 'presentation';

const DELIVERABLE_FILENAME: Record<DeliverableKind, (stepId: string) => string> = {
  presentation: (stepId) => `${stepId}-presentation.html`,
};

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  try {
    await getAdminAuth().verifyIdToken(token);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const instanceId = params.get('instanceId');
  if (!instanceId) {
    return NextResponse.json({ error: 'Missing instanceId parameter' }, { status: 400 });
  }

  const stepId = params.get('stepId');
  const kindRaw = params.get('kind');
  const explicitPath = params.get('path');

  // Determine the path and disposition (download vs inline) based on mode.
  let resolved: string;
  let disposition: 'attachment' | 'inline';

  if (stepId !== null && kindRaw !== null) {
    if (kindRaw !== 'presentation') {
      return NextResponse.json(
        { error: `Unsupported kind: ${kindRaw}` },
        { status: 400 },
      );
    }
    const filename = DELIVERABLE_FILENAME[kindRaw as DeliverableKind](stepId);
    resolved = join(tmpdir(), 'mediforce-deliverables', instanceId, filename);
    disposition = 'inline';
  } else if (explicitPath !== null) {
    resolved = resolve(explicitPath);
    disposition = 'attachment';
  } else {
    return NextResponse.json(
      { error: 'Missing path or stepId+kind parameters' },
      { status: 400 },
    );
  }

  const instanceAllowedPrefixes = [
    `${tmpdir()}/mediforce-deliverables/${instanceId}/`,
    `${tmpdir()}/mediforce-agent-${instanceId}-`,
    resolve(process.cwd(), 'tmp') + '/',
  ];

  const isAllowed = instanceAllowedPrefixes.some((prefix) => resolved.startsWith(prefix));
  if (!isAllowed) {
    return NextResponse.json({ error: 'Path not in allowed directory' }, { status: 403 });
  }

  try {
    const buffer = await readFile(resolved);
    const ext = resolved.split('.').pop()?.toLowerCase() ?? '';
    const contentTypeMap: Record<string, string> = {
      html: 'text/html; charset=utf-8',
      htm: 'text/html; charset=utf-8',
      pdf: 'application/pdf',
      csv: 'text/csv; charset=utf-8',
      md: 'text/markdown; charset=utf-8',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
    const contentType = contentTypeMap[ext] ?? 'application/octet-stream';
    const filename = resolved.split('/').pop() ?? 'download';
    // RFC 6266: use filename* with percent-encoding for full Unicode and special-char safety.
    const encodedFilename = encodeURIComponent(filename);

    const contentDisposition =
      disposition === 'inline'
        ? 'inline'
        : `attachment; filename="${filename.replace(/"/g, '\\"')}"; filename*=UTF-8''${encodedFilename}`;

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': contentDisposition,
      },
    });
  } catch {
    return NextResponse.json({ content: '', path: resolved, error: 'File not found' }, { status: 404 });
  }
}
