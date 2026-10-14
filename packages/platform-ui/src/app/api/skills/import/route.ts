import { createRouteAdapter } from '@/lib/route-adapter';
import { ImportSkillsInputSchema } from '@mediforce/platform-api/contract';
import { importSkills } from '@mediforce/platform-api/handlers';

export const POST = createRouteAdapter(
  ImportSkillsInputSchema,
  async (req) => {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return { ...body, namespace: req.nextUrl.searchParams.get('namespace') ?? '' };
  },
  importSkills,
);
