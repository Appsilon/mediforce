import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DockerSpawnRequest } from '../docker-spawn-strategy';
import { GEPA_JOB_IMAGE, runGepaJob, type GepaJobInput } from '../gepa-job';

const spawned: Array<{ request: DockerSpawnRequest; input: GepaJobInput }> = [];

vi.mock('../docker-spawn-strategy', () => ({
  getDockerSpawnStrategy: () => ({
    spawn: async (request: DockerSpawnRequest) => {
      const input = JSON.parse(await readFile(join(request.outputDir, 'input.json'), 'utf-8')) as GepaJobInput;
      spawned.push({ request, input });
      await writeFile(join(request.outputDir, 'result.json'), JSON.stringify({
        candidates: [{ prompt: 'Grade each AE by CTCAE v5.', reflectedOn: 1 }],
        usage: [{ promptTokens: 900, completionTokens: 120 }],
        error: null,
      }));
      return { stdout: '', stderr: '', exitCode: 0, signal: null };
    },
  }),
}));

const input: GepaJobInput = {
  reflectionModel: 'anthropic/claude-sonnet-4',
  currentPrompt: 'Grade each AE.',
  candidates: 2,
  maxOutputTokens: 2000,
  records: [
    {
      Inputs: { events: [{ term: 'Sepsis', outcome: 'fatal' }] },
      'Generated Outputs': { grades: [{ term: 'Sepsis', grade: 4 }] },
      Feedback: 'FAIL grade-5-for-death (critical): a fatal outcome is CTCAE grade 5.',
    },
    {
      Inputs: { events: [{ term: 'Nausea', outcome: 'recovered' }] },
      'Generated Outputs': { grades: [{ term: 'Nausea', grade: 1 }] },
      Feedback: 'PASS grade-5-for-death (critical)',
    },
  ],
};

function gepaInstalled(): boolean {
  try {
    execFileSync('python3', ['-c', 'import gepa']);
    return true;
  } catch {
    return false;
  }
}

describe('runGepaJob (container)', () => {
  let previousAllowLocal: string | undefined;

  beforeEach(() => {
    spawned.length = 0;
    previousAllowLocal = process.env.ALLOW_LOCAL_AGENTS;
    delete process.env.ALLOW_LOCAL_AGENTS;
  });

  afterEach(() => {
    if (previousAllowLocal !== undefined) process.env.ALLOW_LOCAL_AGENTS = previousAllowLocal;
  });

  it('runs the job in the GEPA image with the key and its input, network on', async () => {
    const outcome = await runGepaJob({ input, apiKey: 'sk-or-test', timeoutMs: 30_000, label: 'opt-1' });

    expect(outcome).toEqual({
      candidates: [{ prompt: 'Grade each AE by CTCAE v5.', reflectedOn: 1 }],
      usage: [{ promptTokens: 900, completionTokens: 120 }],
      error: null,
    });
    const [{ request, input: written }] = spawned as [typeof spawned[number]];
    expect(written).toEqual(input);
    expect(request.dockerArgs).toContain(GEPA_JOB_IMAGE);
    expect(request.dockerArgs).toContain('OPENROUTER_API_KEY=sk-or-test');
    expect(request.dockerArgs).not.toContain('none');
    expect(request.dockerArgs.slice(-3)).toEqual(['python3', '/output/gepa_job.py', '/output']);
  });
});

// Local mode runs the real script with the real `gepa` package against a fake
// OpenRouter; it needs `pip install gepa` on the host's python3.
describe.skipIf(gepaInstalled() === false)('runGepaJob (local mode, real gepa)', () => {
  let server: Server;
  const received: Array<{ model: string; prompt: string }> = [];
  let failNext = false;
  let previousAllowLocal: string | undefined;
  let previousBaseUrl: string | undefined;

  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { model: string; messages: Array<{ content: string }> };
      received.push({ model: body.model, prompt: body.messages[0]!.content });
      res.setHeader('Content-Type', 'application/json');
      if (failNext) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: 'upstream down' }));
        return;
      }
      res.end(JSON.stringify({
        choices: [{ message: { content: `Here it is:\n\`\`\`\nCandidate ${received.length}: a fatal outcome is CTCAE grade 5.\n\`\`\`` } }],
        usage: { prompt_tokens: 1000, completion_tokens: 50 },
      }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    received.length = 0;
    failNext = false;
    previousAllowLocal = process.env.ALLOW_LOCAL_AGENTS;
    previousBaseUrl = process.env.OPENROUTER_BASE_URL;
    process.env.ALLOW_LOCAL_AGENTS = 'true';
    process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  });

  afterEach(() => {
    if (previousAllowLocal === undefined) delete process.env.ALLOW_LOCAL_AGENTS;
    else process.env.ALLOW_LOCAL_AGENTS = previousAllowLocal;
    if (previousBaseUrl === undefined) delete process.env.OPENROUTER_BASE_URL;
    else process.env.OPENROUTER_BASE_URL = previousBaseUrl;
  });

  it('proposes one instruction per candidate from GEPA\'s reflection prompt, with the tokens spent', async () => {
    const outcome = await runGepaJob({ input, apiKey: 'sk-or-test', timeoutMs: 60_000, label: 'opt-local' });

    expect(outcome).toEqual({
      candidates: [
        { prompt: 'Candidate 1: a fatal outcome is CTCAE grade 5.', reflectedOn: 2 },
        { prompt: 'Candidate 2: a fatal outcome is CTCAE grade 5.', reflectedOn: 2 },
      ],
      usage: [{ promptTokens: 1000, completionTokens: 50 }, { promptTokens: 1000, completionTokens: 50 }],
      error: null,
    });
    expect(received).toHaveLength(2);
    expect(received[0]!.model).toBe('anthropic/claude-sonnet-4');
    expect(received[0]!.prompt).toContain('Grade each AE.');
    expect(received[0]!.prompt).toContain('a fatal outcome is CTCAE grade 5.');
    expect(received[0]!.prompt).toContain('## Feedback');
  });

  it('keeps what a failed job proposed and spent, with the error', async () => {
    failNext = true;
    const outcome = await runGepaJob({ input, apiKey: 'sk-or-test', timeoutMs: 60_000, label: 'opt-fail' });

    expect(outcome.candidates).toEqual([]);
    expect(outcome.error).toContain('HTTP 500');
  });
});
