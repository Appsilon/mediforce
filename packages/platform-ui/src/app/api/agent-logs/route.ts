import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { getAdminAuth } from '@mediforce/platform-infra';

const LOGS_DIR = `${tmpdir()}/mediforce-agent-logs`;

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Defense-in-depth: verify the Firebase ID token explicitly even though
  // middleware already enforces Authorization on /api/* routes. This ensures
  // the file-serving path is protected even if middleware is ever narrowed.
  const authHeader = request.headers.get('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  try {
    await getAdminAuth().verifyIdToken(token);
  } catch {
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
