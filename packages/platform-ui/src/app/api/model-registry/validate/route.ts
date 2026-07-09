import { createRouteAdapter } from '@/lib/route-adapter';
import { validateModels } from '@mediforce/platform-api/handlers';
import {
  ValidateModelsInputSchema,
  type ValidateModelsInput,
} from '@mediforce/platform-api/contract';
import { getPlatformServices } from '@/lib/platform-services';

export const POST = createRouteAdapter<typeof ValidateModelsInputSchema, ValidateModelsInput>(
  ValidateModelsInputSchema,
  async (req) => req.json(),
  (input) => {
    const { modelRegistryRepo } = getPlatformServices();
    return validateModels(input, { modelRegistryRepo });
  },
);
