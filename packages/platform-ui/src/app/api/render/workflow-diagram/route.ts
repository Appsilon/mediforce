import { NextRequest, NextResponse } from 'next/server';
import {
  RenderWorkflowDiagramInputSchema,
  renderWorkflowDiagram,
} from '@mediforce/platform-api/handlers';

/**
 * POST /api/render/workflow-diagram
 *
 * Accepts a WorkflowDefinition-like JSON body and returns an HTML diagram.
 * No auth required — the input is the caller's own data, no server state accessed.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = RenderWorkflowDiagramInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const html = renderWorkflowDiagram(parsed.data);
  return NextResponse.json({ html });
}
