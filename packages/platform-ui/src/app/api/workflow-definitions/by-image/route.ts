import { NextResponse } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';
import { resolveCallerIdentity } from '@/lib/api-auth';

function normalizeImage(ref: string): string {
  return ref.includes(':') ? ref : `${ref}:latest`;
}

export async function GET(request: Request): Promise<NextResponse> {
  const { processRepo, namespaceRepo } = getPlatformServices();
  const caller = await resolveCallerIdentity(request, namespaceRepo);
  if (caller instanceof NextResponse) return caller;

  const url = new URL(request.url);
  const imageParam = url.searchParams.get('image');
  if (!imageParam) {
    return NextResponse.json(
      { error: 'Missing required query parameter: image' },
      { status: 400 },
    );
  }

  const needle = normalizeImage(imageParam);
  // Full scan — Firestore can't query nested steps[].agent.image. Denormalize to a top-level dockerImages[] field when scale demands it.
  const { definitions } = await processRepo.listAllWorkflowDefinitions(false);

  const workflows: Array<{
    name: string;
    namespace: string;
    title: string | undefined;
    version: number;
    steps: string[];
  }> = [];

  for (const group of definitions) {
    const latest = group.versions.find((v) => v.version === group.latestVersion);
    if (!latest) continue;

    const ns = latest.namespace;
    if (!caller.isSystemActor) {
      const accessible = caller.namespaces.has(ns) || latest.visibility === 'public';
      if (!accessible) continue;
    }

    const matchingSteps = latest.steps
      .filter((step) => {
        const image = step.agent?.image ?? step.script?.image;
        return typeof image === 'string' && normalizeImage(image) === needle;
      })
      .map((step) => step.id);

    if (matchingSteps.length > 0) {
      workflows.push({
        name: latest.name,
        namespace: ns,
        title: latest.title,
        version: latest.version,
        steps: matchingSteps,
      });
    }
  }

  return NextResponse.json({ workflows });
}
