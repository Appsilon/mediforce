import { NextResponse } from 'next/server';
import { resolveStepImage } from '@mediforce/agent-runtime';
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
  // Repeatable: a catalog entry accumulates a version per build and the Images
  // view asks about all of them at once, so answering one image at a time would
  // be a full scan of every workflow definition per version.
  const imageParams = url.searchParams.getAll('image').filter((value) => value.length > 0);
  if (imageParams.length === 0) {
    return NextResponse.json(
      { error: 'Missing required query parameter: image' },
      { status: 400 },
    );
  }

  // Normalized needle -> the caller's own spelling, so `images` echoes back
  // what was asked for rather than what matching happened to canonicalise it to.
  const needles = new Map(imageParams.map((image) => [normalizeImage(image), image]));
  // Full scan — Firestore can't query nested steps[].agent.image. Denormalize to a top-level dockerImages[] field when scale demands it.
  const { definitions } = await processRepo.listAllWorkflowDefinitions(false);

  const workflows: Array<{
    name: string;
    namespace: string;
    title: string | undefined;
    version: number;
    steps: string[];
    /** Which of the requested images this workflow uses, in the order asked.
     *  A requested image absent from every row is an unused version. */
    images: string[];
  }> = [];

  for (const group of definitions) {
    const latest = group.versions.find((v) => v.version === group.latestVersion);
    if (!latest) continue;

    const ns = latest.namespace;
    if (!caller.isSystemActor) {
      const accessible = caller.namespaces.has(ns) || latest.visibility === 'public';
      if (!accessible) continue;
    }

    // A build-mode step that omits `image` runs under the tag `deriveBuildTag`
    // mints from its build inputs, so matching on the stored string alone is
    // blind to exactly the `mediforce-built:*` rows that need naming.
    const workflowRepo = latest.externalSkillsRepo;
    const matchingSteps: string[] = [];
    const matchedImages = new Set<string>();
    for (const step of latest.steps) {
      const image =
        resolveStepImage(step.agent, workflowRepo) ?? resolveStepImage(step.script, workflowRepo);
      if (typeof image !== 'string') continue;
      const matched = needles.get(normalizeImage(image));
      if (matched === undefined) continue;
      matchingSteps.push(step.id);
      matchedImages.add(matched);
    }

    if (matchingSteps.length > 0) {
      workflows.push({
        name: latest.name,
        namespace: ns,
        title: latest.title,
        version: latest.version,
        steps: matchingSteps,
        images: imageParams.filter((image) => matchedImages.has(image)),
      });
    }
  }

  return NextResponse.json({ workflows });
}
