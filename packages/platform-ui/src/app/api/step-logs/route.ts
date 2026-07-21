import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolveSessionUid } from '@/lib/api-auth';

const LOGS_DIR = `${tmpdir()}/mediforce-step-logs`;

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Defense-in-depth: verify the NextAuth session explicitly even though the
  // proxy already gates /api/* routes. This keeps the file-serving path
  // protected even if the proxy is ever narrowed.
  if ((await resolveSessionUid(request)) === null) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const filename = request.nextUrl.searchParams.get('file');
  if (!filename) {
    return NextResponse.json({ error: 'Missing file parameter' }, { status: 400 });
  }

  // Security: only allow reading from the known logs directory, no path traversal
  if (filename.includes('..') || filename.includes('/')) {
    return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
  }

  const filePath = `${LOGS_DIR}/${filename}`;

  try {
    const content = await readFile(filePath, 'utf-8');
    return NextResponse.json({ content, path: filePath });
  } catch {
    return NextResponse.json({ content: '', path: filePath });
  }
}
