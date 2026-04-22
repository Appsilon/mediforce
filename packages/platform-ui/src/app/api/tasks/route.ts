import { NextRequest, NextResponse } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';

/**
 * GET /api/tasks
 *
 * Query params:
 *   instanceId  — filter tasks by process instance
 *   role        — filter tasks by assigned role (e.g. 'reviewer')
 *   status      — filter by status: 'pending' | 'claimed' | 'completed' | 'cancelled'
 *
 * At least one filter is required.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);
    const instanceId = searchParams.get('instanceId');
    const role = searchParams.get('role');
    const status = searchParams.get('status');

    const { humanTaskRepo } = getPlatformServices();

    if (instanceId) {
      const tasks = await humanTaskRepo.getByInstanceId(instanceId);
      const filtered = status
        ? tasks.filter((t) => t.status === status)
        : tasks;
      return NextResponse.json({ tasks: filtered });
    }

    if (role) {
      // getByRole returns pending + claimed tasks
      const tasks = await humanTaskRepo.getByRole(role);
      const filtered = status
        ? tasks.filter((t) => t.status === status)
        : tasks;
      return NextResponse.json({ tasks: filtered });
    }

    return NextResponse.json(
      { error: 'At least one filter required: instanceId or role' },
      { status: 400 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
