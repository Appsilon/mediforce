import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

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
    const content = await readFile(resolved, 'utf-8');
    return NextResponse.json({ content, path: resolved });
  } catch {
    return NextResponse.json({ content: '', path: resolved, error: 'File not found' }, { status: 404 });
  }
}
