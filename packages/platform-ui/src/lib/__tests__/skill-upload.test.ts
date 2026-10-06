import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { UNZIP_MAX_BYTES, diffSkillFiles, readSkillUpload, skillFilesFromUpload, unzip } from '../skill-upload';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface ZipEntry {
  path: string;
  data: Uint8Array;
  method: number;
  flags?: number;
  /** The uncompressed size the headers claim, when it should not be the true one. */
  declaredSize?: number;
}

/** A minimal zip: one local header + data per entry, a central directory, and
 *  its end record. CRCs are left at zero; the reader does not check them. */
function zip(entries: ZipEntry[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    const body = entry.method === 8 ? deflateRawSync(entry.data) : Buffer.from(entry.data);
    const size = entry.declaredSize ?? entry.data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(entry.flags ?? 0, 6);
    local.writeUInt16LE(entry.method, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(entry.flags ?? 0, 8);
    central.writeUInt16LE(entry.method, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

describe('unzip', () => {
  it('reads stored and deflated entries, and leaves directory entries out', async () => {
    const archive = zip([
      { path: 'csv-profiler/', data: new Uint8Array(), method: 0 },
      { path: 'csv-profiler/SKILL.md', data: bytes('---\nname: csv-profiler\n---\n'), method: 8 },
      { path: 'csv-profiler/references/notes.md', data: bytes('notes'), method: 0 },
    ]);
    const entries = await unzip(archive);
    expect(entries.map((entry) => entry.path)).toEqual(['csv-profiler/SKILL.md', 'csv-profiler/references/notes.md']);
    expect(new TextDecoder().decode(entries[0]?.bytes)).toBe('---\nname: csv-profiler\n---\n');
    expect(new TextDecoder().decode(entries[1]?.bytes)).toBe('notes');
  });

  it('refuses bytes that are not a zip', async () => {
    await expect(unzip(bytes('not a zip'))).rejects.toThrow(/not a zip/);
  });

  it('refuses an encrypted entry', async () => {
    const archive = zip([{ path: 'SKILL.md', data: bytes('skill'), method: 0, flags: 1 }]);
    await expect(unzip(archive)).rejects.toThrow(/SKILL\.md is encrypted/);
  });

  it('refuses a Zip64 entry', async () => {
    const archive = zip([{ path: 'SKILL.md', data: bytes('skill'), method: 0, declaredSize: 0xffffffff }]);
    await expect(unzip(archive)).rejects.toThrow(/Zip64/);
  });

  it('refuses a compression method other than stored or deflated', async () => {
    const archive = zip([{ path: 'SKILL.md', data: bytes('skill'), method: 12 }]);
    await expect(unzip(archive)).rejects.toThrow(/compression method 12/);
  });

  it('refuses an archive that declares more than it may unpack to, before inflating any of it', async () => {
    const archive = zip([
      { path: 'SKILL.md', data: bytes('skill'), method: 8 },
      { path: 'big.bin', data: bytes('x'), method: 8, declaredSize: UNZIP_MAX_BYTES },
    ]);
    await expect(unzip(archive)).rejects.toThrow(/unpacks to more than 16 MB/);
  });

  it('stops inflating an entry that outgrows the size it declared', async () => {
    const archive = zip([{ path: 'bomb.txt', data: new Uint8Array(1024 * 1024), method: 8, declaredSize: 10 }]);
    await expect(unzip(archive)).rejects.toThrow(/unpacks to more than/);
  });

  it('leaves hidden entries out without reading them', async () => {
    const archive = zip([
      { path: 'my-skill/SKILL.md', data: bytes('skill'), method: 0 },
      // Would be refused if it were read.
      { path: '__MACOSX/my-skill/._SKILL.md', data: bytes('meta'), method: 12 },
    ]);
    expect((await unzip(archive)).map((entry) => entry.path)).toEqual(['my-skill/SKILL.md']);
  });
});

describe('skillFilesFromUpload', () => {
  it('strips the one folder a skill is wrapped in', () => {
    const upload = skillFilesFromUpload([
      { path: 'my-skill/SKILL.md', bytes: bytes('skill') },
      { path: 'my-skill/references/a.md', bytes: bytes('a') },
    ]);
    expect(upload.files.map((file) => file.path)).toEqual(['SKILL.md', 'references/a.md']);
  });

  it('keeps a top-level folder when SKILL.md already sits at the root', () => {
    const upload = skillFilesFromUpload([
      { path: 'SKILL.md', bytes: bytes('skill') },
      { path: 'references/a.md', bytes: bytes('a') },
    ]);
    expect(upload.files.map((file) => file.path)).toEqual(['SKILL.md', 'references/a.md']);
  });

  it('lists non-text files as skipped by name instead of storing them', () => {
    const upload = skillFilesFromUpload([
      { path: 'my-skill/SKILL.md', bytes: bytes('skill') },
      { path: 'my-skill/assets/logo.png', bytes: PNG },
    ]);
    expect(upload.files.map((file) => file.path)).toEqual(['SKILL.md']);
    expect(upload.skipped).toEqual(['assets/logo.png']);
  });

  it('drops hidden entries such as .DS_Store and __MACOSX, as the CLI does', () => {
    const upload = skillFilesFromUpload([
      { path: 'my-skill/SKILL.md', bytes: bytes('skill') },
      { path: 'my-skill/.DS_Store', bytes: PNG },
      { path: '__MACOSX/my-skill/._SKILL.md', bytes: PNG },
      { path: 'my-skill/.git/HEAD', bytes: bytes('ref') },
    ]);
    expect(upload.files.map((file) => file.path)).toEqual(['SKILL.md']);
    expect(upload.skipped).toEqual([]);
  });

  it('puts SKILL.md first and sorts the rest by path', () => {
    const upload = skillFilesFromUpload([
      { path: 'scripts/run.py', bytes: bytes('') },
      { path: 'references/b.md', bytes: bytes('') },
      { path: 'SKILL.md', bytes: bytes('') },
    ]);
    expect(upload.files.map((file) => file.path)).toEqual(['SKILL.md', 'references/b.md', 'scripts/run.py']);
  });
});

describe('readSkillUpload', () => {
  it('unpacks a single .zip and strips the folder it wraps the skill in', async () => {
    const archive = zip([
      { path: 'csv-profiler/SKILL.md', data: bytes('skill'), method: 8 },
      { path: 'csv-profiler/scripts/profile.py', data: bytes('print()'), method: 8 },
    ]);
    const upload = await readSkillUpload([{ path: 'csv-profiler.zip', bytes: archive }]);
    expect(upload.files).toEqual([
      { path: 'SKILL.md', contents: 'skill' },
      { path: 'scripts/profile.py', contents: 'print()' },
    ]);
  });

  it('takes anything else as the files of a folder', async () => {
    const upload = await readSkillUpload([{ path: 'my-skill/SKILL.md', bytes: bytes('skill') }]);
    expect(upload.files).toEqual([{ path: 'SKILL.md', contents: 'skill' }]);
  });
});

describe('diffSkillFiles', () => {
  it('names the files an upload adds, changes and removes', () => {
    const diff = diffSkillFiles(
      [
        { path: 'SKILL.md', contents: 'old' },
        { path: 'references/kept.md', contents: 'same' },
        { path: 'references/gone.md', contents: 'x' },
      ],
      [
        { path: 'SKILL.md', contents: 'new' },
        { path: 'references/kept.md', contents: 'same' },
        { path: 'scripts/new.py', contents: 'y' },
      ],
    );
    expect(diff).toEqual({ added: ['scripts/new.py'], changed: ['SKILL.md'], removed: ['references/gone.md'] });
  });
});
