import { describe, expect, it } from 'vitest';
import { imageCapabilityProbeArgs, parseImageCapabilities } from '../image-capabilities';

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

describe('imageCapabilityProbeArgs', () => {
  const args = imageCapabilityProbeArgs('mediforce-golden-image:latest');
  const script = args.at(-1) ?? '';

  it('asks for one runtime per `command -v`, which is all dash answers', () => {
    expect(script).toBe(
      'for runtime in claude opencode bash python3 Rscript node; do command -v "$runtime" || true; done',
    );
  });

  it('caps the container the probed image supplies the shell for', () => {
    expect(args).toContain('--memory');
    expect(args).toContain('--cpus');
    expect(args).toContain('--pids-limit');
    expect(args.slice(args.indexOf('--network'), args.indexOf('--network') + 2)).toEqual([
      '--network', 'none',
    ]);
  });
});
