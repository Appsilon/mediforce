import { createRouteAdapter } from '@/lib/route-adapter';
import { DeleteDockerImageInputSchema } from '@mediforce/platform-api/contract';
import { deleteDockerImage } from '@mediforce/platform-api/handlers';

export const DELETE = createRouteAdapter(
  DeleteDockerImageInputSchema,
  async (req) => {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return { imageId: typeof body.imageId === 'string' ? body.imageId.trim() : '' };
  },
  deleteDockerImage,
);
