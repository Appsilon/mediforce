import { describe, expect, it } from 'vitest';
import {
  ImageCommandNameSchema,
  imageCommandProbeArgs,
  parseImageCommandCheck,
} from '../image-command-check';

describe('ImageCommandNameSchema', () => {
  it.each(['uvx', 'npx', 'python3', 'biomcp-server', 'node.exe', 'my_tool+'])(
    'accepts the bare command name %s',
    (name) => {
      expect(ImageCommandNameSchema.safeParse(name).success).toBe(true);
    },
  );

  it.each(['', '-rf', '--help', 'uvx serve', '/usr/bin/uvx', 'a;b', '$(id)', 'a`b`', 'a\nb', 'a'.repeat(129)])(
    'refuses %j: a path, a flag or shell syntax is not a command name',
    (name) => {
      expect(ImageCommandNameSchema.safeParse(name).success).toBe(false);
    },
  );
});

describe('imageCommandProbeArgs', () => {
  it('hands the command to the shell as a positional argument, never inside the script', () => {
    const args = imageCommandProbeArgs('mediforce-golden-image:latest', 'uvx');

    expect(args.slice(-2)).toEqual(['sh', 'uvx']);
    expect(args[args.indexOf('-c') + 1]).not.toContain('uvx');
    expect(args).toContain('--network');
    expect(args).toContain('none');
    expect(args.indexOf('mediforce-golden-image:latest')).toBeLessThan(args.indexOf('-c'));
  });
});

describe('parseImageCommandCheck', () => {
  it('reports the resolved path of a command the image carries', () => {
    expect(parseImageCommandCheck('/usr/local/bin/uvx\n')).toEqual({
      status: 'known',
      available: true,
      path: '/usr/local/bin/uvx',
    });
  });

  it('reports a missing command as a known absence, not as unknown', () => {
    expect(parseImageCommandCheck('__missing__\n')).toEqual({ status: 'known', available: false });
  });

  it('does not count a shell built-in as available: an MCP server is spawned without a shell', () => {
    expect(parseImageCommandCheck('cd\n')).toEqual({ status: 'known', available: false });
    expect(parseImageCommandCheck('.\n')).toEqual({ status: 'known', available: false });
  });

  it('treats an empty answer as unknown: the probe itself could not run', () => {
    expect(parseImageCommandCheck('')).toEqual({ status: 'unknown' });
  });
});
