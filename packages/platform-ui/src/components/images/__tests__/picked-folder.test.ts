import { describe, expect, it } from 'vitest';
import { listBuildContextArchive } from '@mediforce/platform-core';
import {
  contextSelection,
  contextTree,
  dockerfileCandidates,
  packPickedFiles,
  readDirectoryHandle,
  readDockerignores,
  readPickedFolder,
  type PickableDirectory,
  selectedFiles,
  summarizeContext,
  toggleContextPath,
  type ContextSelection,
  type PickedFolder,
} from '../picked-folder';

/** A file as `<input webkitdirectory>` hands it over. */
function picked(relativePath: string, content = 'x'): File {
  const file = new File([content], relativePath.split('/').pop() ?? relativePath);
  Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
  return file;
}

function folderOf(files: Record<string, string>): PickedFolder {
  const folder = readPickedFolder(Object.entries(files).map(([path, content]) => picked(`ctx/${path}`, content)));
  if (folder === null) throw new Error('nothing picked');
  return folder;
}

/** `ctx` with a Dockerfile in `container/` and a `.dockerignore` keeping data out. */
async function landingZone(): Promise<{ folder: PickedFolder; selection: ContextSelection }> {
  const folder = folderOf({
    '.dockerignore': 'sample-data\n',
    'container/Dockerfile': 'FROM alpine\nCOPY scripts /s\n',
    'sample-data/study-1/dm.xpt': 'dm-rows',
    'sample-data/study-2/ae.xpt': 'ae-rows',
    'scripts/run.sh': 'echo hi',
    'scripts/lib/util.sh': 'util',
    'README.md': 'readme',
  });
  const selection = contextSelection(folder, await readDockerignores(folder), 'container/Dockerfile');
  return { folder, selection };
}

/** A directory as `showDirectoryPicker` hands it over, in the order given. */
function directoryHandle(name: string, tree: Record<string, string | Record<string, unknown>>): PickableDirectory {
  return {
    kind: 'directory',
    name,
    async *values() {
      for (const [entryName, content] of Object.entries(tree)) {
        yield typeof content === 'string'
          ? { kind: 'file' as const, name: entryName, getFile: async () => new File([content], entryName) }
          : directoryHandle(entryName, content as Record<string, string | Record<string, unknown>>);
      }
    },
  };
}

describe('readDirectoryHandle', () => {
  it('reads every file under the picked directory, with paths from its root', async () => {
    const folder = await readDirectoryHandle(
      directoryHandle('landing-zone', {
        scripts: { 'run.sh': 'echo hi', lib: { 'util.sh': 'util' } },
        container: { Dockerfile: 'FROM alpine' },
        '.dockerignore': '*\n!scripts\n',
      }),
    );

    expect(folder?.name).toBe('landing-zone');
    expect(folder?.files.map((file) => file.path)).toEqual([
      '.dockerignore',
      'container/Dockerfile',
      'scripts/lib/util.sh',
      'scripts/run.sh',
    ]);
    expect(folder?.bytes).toBe(11 + 11 + 4 + 7);
  });

  it('is nothing for an empty directory', async () => {
    expect(await readDirectoryHandle(directoryHandle('empty', { nested: {} }))).toBeNull();
  });
});

describe('readPickedFolder', () => {
  it('reads paths from the picked folder root, not from its parent', () => {
    const folder = readPickedFolder([
      picked('my-agent/scripts/run.sh', 'echo hi'),
      picked('my-agent/Dockerfile', 'FROM alpine'),
    ]);

    expect(folder?.name).toBe('my-agent');
    expect(folder?.files.map((file) => file.path)).toEqual(['Dockerfile', 'scripts/run.sh']);
    expect(folder?.bytes).toBe(18);
  });

  it('is nothing when nothing was picked', () => {
    expect(readPickedFolder([])).toBeNull();
  });
});

describe('dockerfileCandidates', () => {
  it('offers every Dockerfile, the root one first', () => {
    const folder = readPickedFolder([
      picked('ctx/container/Dockerfile.gpu'),
      picked('ctx/app.dockerfile'),
      picked('ctx/Dockerfile'),
      picked('ctx/README.md'),
    ]);

    expect(folder === null ? [] : dockerfileCandidates(folder)).toEqual([
      'Dockerfile',
      'app.dockerfile',
      'container/Dockerfile.gpu',
    ]);
  });

  it('does not offer the ignore file that sits beside a Dockerfile', () => {
    const folder = folderOf({ 'container/Dockerfile': 'FROM alpine', 'container/Dockerfile.dockerignore': 'x' });

    expect(dockerfileCandidates(folder)).toEqual(['container/Dockerfile']);
  });
});

describe('contextSelection', () => {
  it('leaves out what the .dockerignore excludes, and always sends the Dockerfile and the ignore file', async () => {
    const { folder, selection } = await landingZone();

    expect(selectedFiles(folder, selection).map((file) => file.path)).toEqual([
      '.dockerignore',
      'container/Dockerfile',
      'README.md',
      'scripts/lib/util.sh',
      'scripts/run.sh',
    ]);
    expect(selection.ignoreFile).toBe('.dockerignore');
  });

  it('reads the ignore file beside the Dockerfile over the root one', async () => {
    const folder = folderOf({
      '.dockerignore': 'sample-data\n',
      'container/Dockerfile': 'FROM alpine',
      'container/Dockerfile.dockerignore': 'README.md\n',
      'sample-data/dm.xpt': 'dm',
      'README.md': 'readme',
    });

    const selection = contextSelection(folder, await readDockerignores(folder), 'container/Dockerfile');

    expect(selection.ignoreFile).toBe('container/Dockerfile.dockerignore');
    expect(selectedFiles(folder, selection).map((file) => file.path)).toContain('sample-data/dm.xpt');
    expect(selectedFiles(folder, selection).map((file) => file.path)).not.toContain('README.md');
  });

  it('sends everything when the folder has no ignore file', async () => {
    const folder = folderOf({ Dockerfile: 'FROM alpine', 'data/dm.xpt': 'dm' });

    const selection = contextSelection(folder, await readDockerignores(folder), 'Dockerfile');

    expect(selection.ignoreFile).toBeNull();
    expect(selectedFiles(folder, selection)).toHaveLength(2);
  });
});

describe('toggleContextPath', () => {
  it('unchecks every file under a directory, then checks them again', async () => {
    const { folder, selection } = await landingZone();

    const unchecked = toggleContextPath(folder, selection, 'scripts');
    expect([...unchecked].sort()).toEqual(['scripts/lib/util.sh', 'scripts/run.sh']);

    const rechecked = toggleContextPath(folder, { ...selection, unchecked }, 'scripts');
    expect(rechecked.size).toBe(0);
  });

  it('checks a partly unchecked directory whole rather than unchecking the rest', async () => {
    const { folder, selection } = await landingZone();
    const partly = { ...selection, unchecked: new Set(['scripts/run.sh']) };

    expect(toggleContextPath(folder, partly, 'scripts').size).toBe(0);
  });

  it('never touches what the ignore file excludes or what is always sent', async () => {
    const { folder, selection } = await landingZone();

    expect(toggleContextPath(folder, selection, 'sample-data').size).toBe(0);
    expect(toggleContextPath(folder, selection, 'container').size).toBe(0);
    expect(toggleContextPath(folder, selection, '').has('container/Dockerfile')).toBe(false);
  });
});

describe('summarizeContext', () => {
  it('counts what each directory holds and what of it is uploaded', async () => {
    const { folder, selection } = await landingZone();

    const summaries = summarizeContext(folder, { ...selection, unchecked: new Set(['scripts/run.sh']) });

    expect(summaries.get('')).toMatchObject({ files: 7, selectedFiles: 4, ignoredFiles: 2, uncheckedFiles: 1 });
    expect(summaries.get('sample-data')).toMatchObject({ files: 2, selectedFiles: 0, toggleable: 0 });
    expect(summaries.get('scripts')).toMatchObject({ files: 2, selectedFiles: 1, toggleable: 2 });
    expect(summaries.get('scripts')?.selectedBytes).toBe(4);
  });
});

describe('contextTree', () => {
  it('nests the files by directory, directories first', async () => {
    const { folder } = await landingZone();

    const tree = contextTree(folder);

    expect(tree.map((node) => node.path)).toEqual([
      'container',
      'sample-data',
      'scripts',
      '.dockerignore',
      'README.md',
    ]);
    const scripts = tree.find((node) => node.path === 'scripts');
    expect(scripts?.children?.map((node) => node.path)).toEqual(['scripts/lib', 'scripts/run.sh']);
    expect(scripts?.size).toBe('echo hi'.length + 'util'.length);
  });
});

describe('packPickedFiles', () => {
  it('packs the files given, at their path from the folder root', async () => {
    const { folder, selection } = await landingZone();

    const entries = listBuildContextArchive(await packPickedFiles(selectedFiles(folder, selection)));

    expect(entries.map((entry) => entry.path)).not.toContain('sample-data/study-1/dm.xpt');
    expect(entries.map((entry) => entry.path)).toContain('scripts/run.sh');
  });
});
