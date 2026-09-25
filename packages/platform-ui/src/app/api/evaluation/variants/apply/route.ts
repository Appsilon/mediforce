import { createRouteAdapter } from '@/lib/route-adapter';
import { applyVariantToStep } from '@mediforce/platform-api/handlers';
import { ApplyStepVariantInputSchema } from '@mediforce/platform-api/contract';

/**
 * POST /api/evaluation/variants/apply — Applies a challenger of an Eval Run, or
 * a patch, to the Step by saving a new Workflow Definition version. Needs the
 * workflow's `edit` verb.
 */
export const POST = createRouteAdapter(
  ApplyStepVariantInputSchema,
  async (req) => req.json().catch(() => ({})),
  applyVariantToStep,
  { successStatus: 201 },
);
