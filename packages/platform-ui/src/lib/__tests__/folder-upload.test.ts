import { describe, it, expect } from 'vitest';
import { entriesFromDrop, entriesFromFiles, uploadPathFor } from '../folder-upload';

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

function pickedFile(name: string, contents: string, webkitRelativePath = ''): File {
  const file = new File([contents], name);
  Object.defineProperty(file, 'webkitRelativePath', { value: webkitRelativePath });
  return file;
}

type Node = { name: string; contents: string } | { name: string; children: Node[]; batchSize?: number };

function toEntry(node: Node, parent: string): FileSystemEntry {
  const fullPath = `${parent}/${node.name}`;
  if ('children' in node) {
    const kids = node.children.map((child) => toEntry(child, fullPath));
    const batchSize = node.batchSize ?? kids.length;
    return {
      isFile: false,
      isDirectory: true,
      name: node.name,
      fullPath,
      createReader: () => {
        let at = 0;
        return {
          readEntries: (resolve: (entries: FileSystemEntry[]) => void) => {
            const batch = kids.slice(at, at + batchSize);
            at += batch.length;
            resolve(batch);
          },
        };
      },
    } as unknown as FileSystemEntry;
  }
  return {
    isFile: true,
    isDirectory: false,
    name: node.name,
    fullPath,
    file: (resolve: (file: File) => void) => resolve(new File([node.contents], node.name)),
  } as unknown as FileSystemEntry;
}

function dropOf(...roots: Node[]): DataTransferItemList {
  return roots.map((root) => ({ webkitGetAsEntry: () => toEntry(root, '') })) as unknown as DataTransferItemList;
}

describe('entriesFromFiles', () => {
  it('uses the file name for a single picked file', async () => {
    const entries = await entriesFromFiles([pickedFile('poll.py', 'print(1)')]);
    expect(entries.map((entry) => entry.path)).toEqual(['poll.py']);
    expect(text(entries[0].bytes)).toBe('print(1)');
  });

  it('keeps each file of a picked folder at its place in the folder', async () => {
    const entries = await entriesFromFiles([
      pickedFile('SKILL.md', 'a', 'skills/validator/SKILL.md'),
      pickedFile('Dockerfile', 'b', 'skills/Dockerfile'),
    ]);
    expect(entries.map((entry) => entry.path)).toEqual(['skills/validator/SKILL.md', 'skills/Dockerfile']);
  });
});

describe('entriesFromDrop', () => {
  it('walks a dropped folder, nested folders included', async () => {
    const entries = await entriesFromDrop(dropOf({
      name: 'skills',
      children: [
        { name: 'Dockerfile', contents: 'FROM x' },
        { name: 'validator', children: [{ name: 'SKILL.md', contents: '# v' }] },
      ],
    }));
    expect(entries.map((entry) => [entry.path, text(entry.bytes)])).toEqual([
      ['skills/Dockerfile', 'FROM x'],
      ['skills/validator/SKILL.md', '# v'],
    ]);
  });

  it('reads a directory that lists its children in several batches', async () => {
    const children = Array.from({ length: 5 }, (_, index) => ({ name: `f${String(index)}.md`, contents: String(index) }));
    const entries = await entriesFromDrop(dropOf({ name: 'docs', children, batchSize: 2 }));
    expect(entries.map((entry) => entry.path)).toEqual(children.map((child) => `docs/${child.name}`));
  });

  it('reads loose dropped files and skips items that are not files', async () => {
    const items = [
      { webkitGetAsEntry: () => toEntry({ name: 'poll.py', contents: 'x' }, '') },
      { webkitGetAsEntry: () => null },
    ] as unknown as DataTransferItemList;
    expect((await entriesFromDrop(items)).map((entry) => entry.path)).toEqual(['poll.py']);
  });
});

describe('uploadPathFor', () => {
  it('leaves a loose file where it is', () => {
    expect(uploadPathFor('poll.py')).toBe('poll.py');
  });

  it('drops the leading folder name and keeps the structure below it', () => {
    // Uploading a `skills/` directory has to arrive as `validator/SKILL.md`
    // under it, not flattened and not one level deeper than picked.
    expect(uploadPathFor('my-workflow/skills/validator/SKILL.md')).toBe('skills/validator/SKILL.md');
  });
});
