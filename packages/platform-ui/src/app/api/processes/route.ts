import { NextResponse } from 'next/server';
import { createRouteAdapter } from '@/lib/route-adapter';
import { startRun } from '@mediforce/platform-api/handlers';
import { StartRunInputSchema } from '@mediforce/platform-api/contract';
import type { StartRunInput } from '@mediforce/platform-api/contract';

/**
 * POST /api/processes
 *
 * Creates + starts a new workflow run. Response: `201 Created` with the
 * post-creation entity echo `{ run: WorkflowRun }` per ADR-0005 §5.
 * Replaces the pre-Phase-3 `{ instanceId, status }` shape — UI + CLI
 * callers updated in the same PR.
 */
const baseHandler = createRouteAdapter<typeof StartRunInputSchema, StartRunInput>(
  StartRunInputSchema,
  async (req) => (await req.json().catch(() => ({}))) as unknown,
  startRun,
);

export async function POST(req: Parameters<typeof baseHandler>[0]) {
  const res = await baseHandler(req, undefined as never);
  if (res.status === 200) {
    const body = await res.json();
    return NextResponse.json(body, { status: 201 });
  }
  return res;
}
