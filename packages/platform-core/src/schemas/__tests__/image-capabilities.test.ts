import { describe, expect, it } from 'vitest';
import { parseImageCapabilities } from '../image-capabilities';

describe('parseImageCapabilities', () => {
  it('derives agent capability only from an agent CLI plus bash', () => {
    expect(
      parseImageCapabilities('/usr/local/bin/claude\n/usr/bin/bash\n/usr/local/bin/python3\n'),
    ).toEqual({
      status: 'known',
      agentCapable: true,
      runtimes: ['claude', 'bash', 'python3'],
    });
  });

  it('keeps script-only images known when an agent CLI or bash is absent', () => {
    expect(parseImageCapabilities('/usr/local/bin/opencode\n/usr/bin/node\n')).toEqual({
      status: 'known',
      agentCapable: false,
      runtimes: ['opencode', 'node'],
    });
  });

  it('treats empty and non-zero probe output as a known capability set', () => {
    expect(parseImageCapabilities('')).toEqual({
      status: 'known',
      agentCapable: false,
      runtimes: [],
    });
  });
});
