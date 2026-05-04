import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth } from '@mediforce/platform-infra';
import { getPlatformServices } from '@/lib/platform-services';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const CONTAINER_WORKER_URL = process.env.CONTAINER_WORKER_URL ?? 'http://container-worker:3001';

function isLocalAgentMode(): boolean {
  return process.env.ALLOW_LOCAL_AGENTS === 'true' && !process.env.REDIS_URL;
}

async function requireSystemAdmin(req: NextRequest): Promise<NextResponse | null> {
  const adminKey = process.env.PLATFORM_ADMIN_API_KEY;
  const providedKey = req.headers.get('X-Api-Key');
  if (
    typeof adminKey === 'string'
    && adminKey !== ''
    && providedKey !== null
    && providedKey === adminKey
  ) {
    return null;
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (token === '') {
    return NextResponse.json({ error: 'Unauthorized — admin role required' }, { status: 401 });
  }

  let callerUid: string;
  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    callerUid = decoded.uid;
  } catch {
    return NextResponse.json({ error: 'Unauthorized — invalid token' }, { status: 401 });
  }

  const services = getPlatformServices();
  const userNamespaces = await services.namespaceRepo.getUserNamespaces(callerUid);
  const adminChecks = await Promise.all(
    userNamespaces.map(async (ns) => {
      const member = await services.namespaceRepo.getMember(ns.handle, callerUid);
      return member !== null && (member.role === 'owner' || member.role === 'admin');
    }),
  );

  if (!adminChecks.some(Boolean)) {
    return NextResponse.json({ error: 'Forbidden — admin role required' }, { status: 403 });
  }

  return null;
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const authError = await requireSystemAdmin(req);
  if (authError !== null) return authError;

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

    const workerHeaders: Record<string, string> = {};
    const workerSecret = process.env.CONTAINER_WORKER_SECRET;
    if (typeof workerSecret === 'string' && workerSecret !== '') {
      workerHeaders['X-Worker-Secret'] = workerSecret;
    }

    const res = await fetch(`${CONTAINER_WORKER_URL}/images/${encodeURIComponent(imageId)}`, {
      method: 'DELETE',
      headers: workerHeaders,
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
