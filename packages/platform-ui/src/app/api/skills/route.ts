import { createRouteAdapter } from '@/lib/route-adapter';
import {
  CreateSkillInputSchema,
  ListSkillsInputSchema,
  type CreateSkillInput,
  type ListSkillsInput,
} from '@mediforce/platform-api/contract';
import { createSkill, listSkills } from '@mediforce/platform-api/handlers';

export const GET = createRouteAdapter<typeof ListSkillsInputSchema, ListSkillsInput>(
  ListSkillsInputSchema,
  (req) => ({
    namespace: new URL(req.url).searchParams.get('namespace') ?? '',
  }),
  listSkills,
);

export const POST = createRouteAdapter<typeof CreateSkillInputSchema, CreateSkillInput>(
  CreateSkillInputSchema,
  async (req) => {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      ...body,
      namespace: new URL(req.url).searchParams.get('namespace') ?? '',
    };
  },
  createSkill,
  { successStatus: 201 },
);
