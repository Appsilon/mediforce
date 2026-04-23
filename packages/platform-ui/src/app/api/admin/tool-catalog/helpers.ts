import { NextResponse } from 'next/server';
import type { FirestoreNamespaceRepository } from '@mediforce/platform-infra';

/** Returns the namespace handle on success, or a NextResponse to return to
 *  the client on failure (400 missing param, 404 namespace not found). */
export async function resolveNamespaceFromQuery(
  request: Request,
  namespaceRepo: FirestoreNamespaceRepository,
): Promise<string | NextResponse> {
  const handle = new URL(request.url).searchParams.get('namespace');
  if (handle === null || handle.length === 0) {
    return NextResponse.json(
      { error: 'Missing required query parameter: namespace' },
      { status: 400 },
    );
  }
  const namespace = await namespaceRepo.getNamespace(handle);
  if (namespace === null) {
    return NextResponse.json(
      { error: `Namespace "${handle}" does not exist.` },
      { status: 404 },
    );
  }
  return handle;
}

/** Derives a deterministic catalog id from a command string: take the
 *  basename, lowercase, map non-alphanumeric runs to '-'. */
export function slugifyCommand(command: string): string {
  const basename = command.split('/').pop() ?? command;
  return basename
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
