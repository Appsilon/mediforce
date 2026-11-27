import { createRouteAdapter } from '@/lib/route-adapter';
import { PruneDockerImagesInputSchema } from '@mediforce/platform-api/contract';
import { pruneDockerImages } from '@mediforce/platform-api/handlers';

export const POST = createRouteAdapter(
  PruneDockerImagesInputSchema,
  async (req) => req.json().catch(() => ({})),
  pruneDockerImages,
);
