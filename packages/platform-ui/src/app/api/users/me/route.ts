import { createRouteAdapter } from '@/lib/route-adapter';
import { GetMeInputSchema } from '@mediforce/platform-api/contract';
import { getMe } from '@mediforce/platform-api/handlers';

export const GET = createRouteAdapter(
  GetMeInputSchema,
  (req) => {
    const uid = new URL(req.url).searchParams.get('uid');
    return uid !== null && uid !== '' ? { uid } : {};
  },
  getMe,
);
