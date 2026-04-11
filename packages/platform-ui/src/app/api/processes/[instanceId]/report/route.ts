import { NextRequest, NextResponse } from 'next/server';
import { getPlatformServices, validateApiKey } from '@/lib/platform-services';
import { assembleReport } from '@/lib/report/assemble-report';
import { renderMarkdown } from '@/lib/report/render-markdown';
import { renderHtml } from '@/lib/report/render-html';

/**
 * GET /api/processes/:instanceId/report
 *
 * Returns a full run report. Works for any run status (running, paused, failed, completed).
 *
 * Query params:
 *   format=json (default) — structured report data
 *   format=markdown       — human-readable markdown
 *   format=html           — standalone HTML file (self-contained, no external deps)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
): Promise<NextResponse> {
  if (!validateApiKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { instanceId } = await params;
    const format = req.nextUrl.searchParams.get('format') ?? 'json';
    const services = getPlatformServices();
    const report = await assembleReport(instanceId, services);

    if (format === 'markdown') {
      const md = renderMarkdown(report);
      return new NextResponse(md, {
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': `inline; filename="${report.definitionName}-report.md"`,
        },
      });
    }

    if (format === 'html') {
      const html = renderHtml(report);
      return new NextResponse(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': `inline; filename="${report.definitionName}-report.html"`,
        },
      });
    }

    // Default: JSON
    return NextResponse.json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status = message.includes('not found') ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
