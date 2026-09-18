import { describe, it, expect, vi, beforeEach } from 'vitest';
import { imagesPullCommand } from '../commands/images';
import { captureOutput, jsonResponse } from './test-helpers';

const BASE_ENV = { MEDIFORCE_API_KEY: 'k' };

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('images pull', () => {
  it('posts the reference, tag and entry fields, and says where the image landed', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ imageTag: 'ghcr.io/acme/agent:v1', entryId: 'agent-1234abcd' }));
    const output = captureOutput();

    const code = await imagesPullCommand({
      argv: [
        '--namespace', 'alpha',
        '--reference', 'ghcr.io/acme/agent',
        '--tag', 'v1',
        '--intent', 'Maps raw EDC exports to SDTM domains',
        '--base-url', 'http://test:9000',
      ],
      env: BASE_ENV,
      output,
    });

    expect(code, output.stderrLines.join('\n')).toBe(0);
    expect(output.stdoutLines.join('\n')).toContain('Pulled ghcr.io/acme/agent:v1 for entry agent-1234abcd');
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).toBe('http://test:9000/api/image-catalog/pull?namespace=alpha');
    expect(JSON.parse(String(init?.body))).toEqual({
      reference: 'ghcr.io/acme/agent',
      tag: 'v1',
      intent: 'Maps raw EDC exports to SDTM domains',
    });
  });

  it('leaves the tag to the platform when none is given', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ imageTag: 'rocker/r-ver:latest', entryId: 'r-ver-1234abcd' }));
    const output = captureOutput();

    const code = await imagesPullCommand({
      argv: ['--namespace', 'alpha', '--reference', 'rocker/r-ver', '--base-url', 'http://test:9000'],
      env: BASE_ENV,
      output,
    });

    expect(code, output.stderrLines.join('\n')).toBe(0);
    expect(output.stdoutLines.join('\n')).toContain('Pulling rocker/r-ver:latest');
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toEqual({ reference: 'rocker/r-ver' });
  });
});
