import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const CONTAINER_WORKER_URL = process.env.CONTAINER_WORKER_URL ?? 'http://container-worker:3001';

function isLocalAgentMode(): boolean {
  return process.env.ALLOW_LOCAL_AGENTS === 'true' && !process.env.REDIS_URL;
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => null);
  const imageId = typeof body?.imageId === 'string' ? body.imageId.trim() : '';

  if (imageId.length === 0) {
    return NextResponse.json({ error: 'Missing imageId in request body' }, { status: 400 });
  }

  try {
    if (isLocalAgentMode()) {
      const result = await execFileAsync('docker', ['rmi', imageId]);
      return NextResponse.json({ deleted: imageId, output: result.stdout.trim() });
    }

    const res = await fetch(`${CONTAINER_WORKER_URL}/images/${encodeURIComponent(imageId)}`, {
      method: 'DELETE',
    });

    if (!res.ok) {
      const text = await res.text().catch(() => 'Unknown error');
      return NextResponse.json({ error: text }, { status: res.status });
    }

    return NextResponse.json({ deleted: imageId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
