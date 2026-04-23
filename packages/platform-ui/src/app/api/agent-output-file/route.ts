import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { getAdminAuth } from '@mediforce/platform-infra';

/**
 * Serves agent output files from allowed directories.
 * Requires both `path` and `instanceId` query parameters.
 * The path is validated against instance-specific prefixes to prevent
 * cross-tenant access — only files belonging to the given instance can
 * be served.
 */

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  try {
    await getAdminAuth().verifyIdToken(token);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const filePath = request.nextUrl.searchParams.get('path');
  if (!filePath) {
    return NextResponse.json({ error: 'Missing path parameter' }, { status: 400 });
  }

  const instanceId = request.nextUrl.searchParams.get('instanceId');
  if (!instanceId) {
    return NextResponse.json({ error: 'Missing instanceId parameter' }, { status: 400 });
  }

  const resolved = resolve(filePath);

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

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename.replace(/"/g, '\\"')}"; filename*=UTF-8''${encodedFilename}`,
      },
    });
  } catch {
    return NextResponse.json({ content: '', path: resolved, error: 'File not found' }, { status: 404 });
  }
}
