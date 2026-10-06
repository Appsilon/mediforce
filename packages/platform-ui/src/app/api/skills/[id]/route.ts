import { createRouteAdapter } from '@/lib/route-adapter';
import {
  DeleteSkillInputSchema,
  GetSkillInputSchema,
  UpdateSkillInputSchema,
  type DeleteSkillInput,
  type GetSkillInput,
  type UpdateSkillInput,
} from '@mediforce/platform-api/contract';
import { deleteSkill, getSkill, updateSkill } from '@mediforce/platform-api/handlers';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const GET = createRouteAdapter<typeof GetSkillInputSchema, GetSkillInput, unknown, RouteContext>(
  GetSkillInputSchema,
  async (req, ctx) => ({
    namespace: new URL(req.url).searchParams.get('namespace') ?? '',
    id: (await ctx.params).id,
  }),
  getSkill,
);

export const PATCH = createRouteAdapter<typeof UpdateSkillInputSchema, UpdateSkillInput, unknown, RouteContext>(
  UpdateSkillInputSchema,
  async (req, ctx) => {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    // The URL names the skill: its namespace and id win over any in the body.
    return {
      ...body,
      namespace: new URL(req.url).searchParams.get('namespace') ?? '',
      id: (await ctx.params).id,
    };
  },
  updateSkill,
);

export const DELETE = createRouteAdapter<typeof DeleteSkillInputSchema, DeleteSkillInput, unknown, RouteContext>(
  DeleteSkillInputSchema,
  async (req, ctx) => ({
    namespace: new URL(req.url).searchParams.get('namespace') ?? '',
    id: (await ctx.params).id,
  }),
  deleteSkill,
);
