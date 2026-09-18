import { describe, it, expect, vi, beforeEach } from 'vitest';
import { imagesCreateCommand, imagesPublishCommand } from '../commands/images';
import { captureOutput, jsonResponse } from './test-helpers';

const BASE_ENV = { MEDIFORCE_API_KEY: 'k' };

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('images publish', () => {
  it('publishes the version it names under the reference, and says where it landed', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ imageTag: 'alpha/intake:v1', entryId: 'intake-1234abcd' }));
    const output = captureOutput();

    const code = await imagesPublishCommand({
      argv: [
        'intake-aaaabbbb',
        '--namespace', 'alpha',
        '--version', 'mediforce-artifacts:0123456789ab',
        '--reference', 'alpha/intake',
        '--tag', 'v1',
        '--intent', 'Intake checks, kept after the workflow moves on',
        '--base-url', 'http://test:9000',
      ],
      env: BASE_ENV,
      output,
    });

    expect(code, output.stderrLines.join('\n')).toBe(0);
    expect(output.stdoutLines.join('\n')).toContain('alpha/intake:v1');
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).toBe('http://test:9000/api/image-catalog/intake-aaaabbbb/publish?namespace=alpha');
    expect(JSON.parse(String(init?.body))).toEqual({
      imageTag: 'mediforce-artifacts:0123456789ab',
      reference: 'alpha/intake',
      tag: 'v1',
      intent: 'Intake checks, kept after the workflow moves on',
    });
  });
});

describe('images create --workflow', () => {
  it('catalogues a Dockerfile a workflow carries', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        entry: {
          id: 'intake-1234abcd',
          name: 'Intake',
          intent: 'Intake checks',
          source: { kind: 'carried', workflow: 'intake', dockerfile: 'container/Dockerfile' },
          capabilities: {},
          origin: 'catalogued',
          versions: [],
          availability: 'absent',
          baseEntryId: null,
        },
      }),
    );
    const output = captureOutput();

    const code = await imagesCreateCommand({
      argv: [
        '--namespace', 'alpha',
        '--name', 'Intake',
        '--intent', 'Intake checks',
        '--workflow', 'intake',
        '--dockerfile', 'container/Dockerfile',
        '--base-url', 'http://test:9000',
      ],
      env: BASE_ENV,
      output,
    });

    expect(code, output.stderrLines.join('\n')).toBe(0);
    const [, init] = fetchSpy.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body)).source).toEqual({
      kind: 'carried',
      workflow: 'intake',
      dockerfile: 'container/Dockerfile',
    });
  });

  it('refuses a workflow with no Dockerfile to key on', async () => {
    const output = captureOutput();

    const code = await imagesCreateCommand({
      argv: ['--namespace', 'alpha', '--name', 'Intake', '--intent', 'Intake checks', '--workflow', 'intake'],
      env: BASE_ENV,
      output,
    });

    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toContain('--dockerfile');
  });
});
