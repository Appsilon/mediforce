import { createRouteAdapter } from '@/lib/route-adapter';
import {
  CheckImageCommandInputSchema,
  type CheckImageCommandInput,
} from '@mediforce/platform-api/contract';
import { checkImageCommand } from '@mediforce/platform-api/handlers';

export const GET = createRouteAdapter<
  typeof CheckImageCommandInputSchema,
  CheckImageCommandInput
>(
  CheckImageCommandInputSchema,
  (req) => {
    const params = new URL(req.url).searchParams;
    return {
      namespace: params.get('namespace') ?? '',
      image: params.get('image') ?? '',
      command: params.get('command') ?? '',
    };
  },
  checkImageCommand,
);
