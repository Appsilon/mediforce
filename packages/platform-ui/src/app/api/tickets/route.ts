import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminAuth } from '@mediforce/platform-infra';

const TICKET_TYPES = ['bug', 'idea', 'question'] as const;
type TicketType = (typeof TICKET_TYPES)[number];

const TICKET_LABELS: Record<TicketType, string> = {
  bug: 'bug',
  idea: 'enhancement',
  question: 'question',
};

const TicketBodySchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(20_000).default(''),
  type: z.enum(TICKET_TYPES),
  context: z
    .array(z.object({ label: z.string().min(1).max(80), value: z.string().min(1).max(500) }))
    .max(10)
    .default([]),
  filedBy: z.string().min(1).max(200),
});

function buildIssueBody(params: {
  description: string;
  context: ReadonlyArray<{ label: string; value: string }>;
  filedBy: string;
}): string {
  const lines: string[] = [];
  lines.push(params.description.trim());
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(`**Filed by:** ${params.filedBy}`);
  if (params.context.length > 0) {
    lines.push('');
    lines.push('<details><summary>Context</summary>');
    lines.push('');
    for (const chip of params.context) {
      lines.push(`- **${chip.label}:** ${chip.value}`);
    }
    lines.push('');
    lines.push('</details>');
  }
  return lines.join('\n');
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const adminAuth = getAdminAuth();

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (token === '') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await adminAuth.verifyIdToken(token);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = TicketBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 });
  }

  const { title, description, type, context, filedBy } = parsed.data;

  const githubToken = process.env.GITHUB_TOKEN ?? '';
  const repo = process.env.GITHUB_REPO ?? 'appsilon/mediforce';
  if (githubToken === '') {
    return NextResponse.json(
      { error: 'Ticket creation is not configured on the server (missing GITHUB_TOKEN).' },
      { status: 503 },
    );
  }

  const issueBody = buildIssueBody({ description, context, filedBy });

  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title,
        body: issueBody,
        labels: [TICKET_LABELS[type]],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[tickets] GitHub API error:', response.status, errorText);
      return NextResponse.json(
        { error: `GitHub API returned ${response.status}` },
        { status: 502 },
      );
    }

    const data = (await response.json()) as { number: number; html_url: string };
    return NextResponse.json({ number: data.number, url: data.html_url }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[tickets] Unexpected error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
