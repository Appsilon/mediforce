import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { packBuildContextArchive } from '@mediforce/platform-core';

// Only `docker` is faked: the archive is really extracted by the system `tar`,
// into a real temp dir, because that is the half of the path that can go wrong.
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  execFileSync: vi.fn(),
}));

import { execFileSync } from 'node:child_process';
import { buildImageFromUpload, BuildContextTooLargeError, ImageTagTakenError } from './docker-image-builder';

const execFileSyncMock = vi.mocked(execFileSync);
const encoder = new TextEncoder();

/** What the build saw on disk, captured while the context still exists. */
interface BuildObservation {
  args: string[];
  dockerfileExists: boolean;
  scriptExecutable: boolean;
}

let observed: BuildObservation | null;
/** Every `docker` call after the build, in order. */
let dockerCalls: string[][];
/** Tags the fake daemon already has. */
let daemonTags: Set<string>;

function noSuchImage(image: string): Error {
  return Object.assign(new Error('Command failed'), { stderr: `Error: No such image: ${image}` });
}

beforeEach(() => {
  vi.clearAllMocks();
  observed = null;
  dockerCalls = [];
  daemonTags = new Set();
  execFileSyncMock.mockImplementation((_command, rawArgs) => {
    const args = rawArgs as string[];
    if (args[0] !== 'build') {
      dockerCalls.push(args);
      const image = args.at(-1) as string;
      if (args[1] === 'inspect' && daemonTags.has(image) === false) throw noSuchImage(image);
      return Buffer.from('');
    }
    const context = args.at(-1) as string;
    observed = {
      args,
      dockerfileExists: existsSync(args[args.indexOf('-f') + 1] as string),
      scriptExecutable:
        ((statSync(`${context}/scripts/run.sh`, { throwIfNoEntry: false })?.mode ?? 0) & 0o100) !== 0,
    };
    return Buffer.from('');
  });
});

function contextArchive(): Readable {
  return Readable.from([
    Buffer.from(
      packBuildContextArchive([
        { kind: 'file', path: 'container/Dockerfile', content: encoder.encode('FROM alpine\nCOPY scripts /s\n') },
        { kind: 'file', path: 'scripts/run.sh', content: encoder.encode('echo hi\n'), executable: true },
      ]),
    ),
  ]);
}

function label(args: string[], key: string): string | undefined {
  return args.find((arg) => arg.startsWith(`${key}=`))?.slice(key.length + 1);
}

describe('buildImageFromUpload', () => {
  it('builds the extracted directory, with the Dockerfile read from the context root', async () => {
    await buildImageFromUpload(
      { image: 'acme/agent:v1', dockerfile: 'container/Dockerfile', namespace: 'acme' },
      contextArchive(),
    );

    expect(observed).not.toBeNull();
    const { args } = observed as BuildObservation;
    expect(args.slice(0, 2)).toEqual(['build', '-t']);
    expect(args[args.indexOf('-f') + 1]).toBe(`${args.at(-1)}/container/Dockerfile`);
    expect(observed?.dockerfileExists).toBe(true);
    // A tar carries the executable bit a COPYd entrypoint needs.
    expect(observed?.scriptExecutable).toBe(true);
  });

  it('builds under a throwaway tag and moves it onto the requested one only once built', async () => {
    await buildImageFromUpload(
      { image: 'acme/agent:v1', dockerfile: 'container/Dockerfile', namespace: 'acme' },
      contextArchive(),
    );

    const staging = (observed as BuildObservation).args[2] as string;
    expect(staging).toMatch(/^mediforce-upload-staging:/);
    expect(dockerCalls).toEqual([
      ['image', 'inspect', '--format', '{{.Id}}', 'acme/agent:v1'],
      ['tag', staging, 'acme/agent:v1'],
      ['image', 'rm', staging],
    ]);
  });

  it('refuses a tag another upload took while this one was building, and leaves it alone', async () => {
    daemonTags.add('acme/agent:v1');

    await expect(
      buildImageFromUpload(
        { image: 'acme/agent:v1', dockerfile: 'container/Dockerfile', namespace: 'acme' },
        contextArchive(),
      ),
    ).rejects.toThrow(ImageTagTakenError);

    const staging = (observed as BuildObservation).args[2] as string;
    expect(dockerCalls.some((args) => args[0] === 'tag')).toBe(false);
    expect(dockerCalls.at(-1)).toEqual(['image', 'rm', staging]);
  });

  it('labels the namespace and blanks every build label it could inherit', async () => {
    await buildImageFromUpload(
      { image: 'acme/agent:v1', dockerfile: 'container/Dockerfile', namespace: 'acme' },
      contextArchive(),
    );

    const { args } = observed as BuildObservation;
    expect(label(args, 'mediforce.build.namespace')).toBe('acme');
    expect(label(args, 'mediforce.build.repo')).toBe('');
    expect(label(args, 'mediforce.build.commit')).toBe('');
  });

  it('removes the extracted context once the build is done, and when it fails', async () => {
    await buildImageFromUpload(
      { image: 'acme/agent:v1', dockerfile: 'container/Dockerfile', namespace: 'acme' },
      contextArchive(),
    );
    const firstContext = (observed as BuildObservation).args.at(-1) as string;
    expect(existsSync(firstContext)).toBe(false);

    execFileSyncMock.mockImplementationOnce((_command, rawArgs) => {
      observed = { args: rawArgs as string[], dockerfileExists: true, scriptExecutable: true };
      throw new Error('ERROR: failed to solve');
    });
    await expect(
      buildImageFromUpload(
        { image: 'acme/agent:v2', dockerfile: 'container/Dockerfile', namespace: 'acme' },
        contextArchive(),
      ),
    ).rejects.toThrow('failed to solve');
    expect(existsSync((observed as BuildObservation).args.at(-1) as string)).toBe(false);
  });

  it('refuses a Dockerfile symlinked out of the context, before building', async () => {
    const archive = Readable.from([
      Buffer.from(packBuildContextArchive([{ kind: 'symlink', path: 'Dockerfile', target: '/etc/hosts' }])),
    ]);

    await expect(
      buildImageFromUpload({ image: 'acme/agent:v1', dockerfile: '', namespace: 'acme' }, archive),
    ).rejects.toThrow(/outside/);
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  it('reports an archive tar cannot read, without building', async () => {
    await expect(
      buildImageFromUpload(
        { image: 'acme/agent:v1', dockerfile: '', namespace: 'acme' },
        Readable.from([Buffer.from('not an archive at all'.repeat(40))]),
      ),
    ).rejects.toThrow(/build context/);
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  it('stops reading an archive over the size limit, without building', async () => {
    await expect(
      buildImageFromUpload({ image: 'acme/agent:v1', dockerfile: 'container/Dockerfile', namespace: 'acme' }, contextArchive(), 1024),
    ).rejects.toThrow(BuildContextTooLargeError);
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });
});
