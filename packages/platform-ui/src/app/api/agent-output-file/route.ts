import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { getAdminAuth } from '@mediforce/platform-infra';

/**
 * Serves agent output files from allowed directories.
 * Accepts an absolute `path` query parameter and validates it against known safe prefixes.
 */

const ALLOWED_PREFIXES = [
  // Agent working directories (macOS resolves /var → /private/var)
  `${tmpdir()}/mediforce-agent-`,
  `/private/var/folders/`,
  `/var/folders/`,
  // System temp (macOS: /tmp → /private/tmp)
  `/tmp/`,
  `/private/tmp/`,
  // Platform-UI tmp directory for generated outputs
  resolve(process.cwd(), 'tmp') + '/',
];

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

  // Security: block path traversal
  if (filePath.includes('..')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  const resolved = resolve(filePath);
  const isAllowed = ALLOWED_PREFIXES.some((prefix) => resolved.startsWith(prefix));
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
