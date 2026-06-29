import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { describe, it, expect } from 'vitest';
import { WorkflowStepSchema } from '../workflow-definition.js';

/**
 * Guards the workflow-authoring docs against silent drift. Every claim these
 * docs make about the codebase — relative links, the executor/type enums, the
 * `mediforce` CLI commands, and the ADRs — is re-derived from source here, so a
 * rename or removal breaks CI instead of leaving a stale doc.
 */

const repoRoot = resolve(__dirname, '../../../../..');

const DOC_PATHS = [
  'docs/how-to-create-workflow.md',
  'docs/workflow-authoring-golden-rules.md',
];

const docs = DOC_PATHS.map(rel => {
  const abs = resolve(repoRoot, rel);
  return { rel, abs, text: readFileSync(abs, 'utf-8') };
});

/** GitHub-style heading slug, e.g. "Import from git" -> "import-from-git". */
function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}

function headingSlugs(markdown: string): Set<string> {
  const slugs = new Set<string>();
  for (const match of markdown.matchAll(/^#{1,6}\s+(.*)$/gm)) {
    slugs.add(slugify(match[1]));
  }
  return slugs;
}

/** All ```fenced``` and `inline` code spans concatenated — where commands live.
 *  Fenced blocks are removed before scanning inline spans so the triple
 *  backticks of a fence cannot mis-pair with single backticks elsewhere. */
function codeText(markdown: string): string {
  const fenced = markdown.match(/```[\s\S]*?```/g) ?? [];
  const inline = markdown.replace(/```[\s\S]*?```/g, '').match(/`[^`\n]+`/g) ?? [];
  return [...fenced, ...inline].join('\n');
}

describe('workflow-authoring docs', () => {
  it('found the docs', () => {
    expect(docs.length).toBe(DOC_PATHS.length);
    for (const doc of docs) {
      expect(doc.text.length, `${doc.rel} is empty`).toBeGreaterThan(0);
    }
  });

  describe.each(docs)('$rel', ({ abs, text }) => {
    it('every relative link resolves to a real file (and anchor)', () => {
      for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
        const target = match[1].trim();
        if (/^(https?:|mailto:)/.test(target)) {
          continue;
        }
        const [filePart, anchor] = target.split('#');
        const resolved = filePart === '' ? abs : resolve(dirname(abs), filePart);
        expect(existsSync(resolved), `dead link: ${target}`).toBe(true);

        if (anchor !== undefined && anchor !== '' && resolved.endsWith('.md')) {
          const slugs = headingSlugs(readFileSync(resolved, 'utf-8'));
          expect(slugs.has(anchor), `dead anchor: ${target}`).toBe(true);
        }
      }
    });
  });
});

describe('workflow-authoring docs — executor/type tables match the schema', () => {
  const executorOptions = WorkflowStepSchema.shape.executor.options;
  const typeOptions = WorkflowStepSchema.shape.type.removeDefault().options;

  /** First-column backtick tokens of the markdown table whose header is `label`. */
  function tableColumn(markdown: string, label: string): string[] {
    const lines = markdown.split('\n');
    const headerIndex = lines.findIndex(line =>
      new RegExp(`^\\|\\s*${label}\\s*\\|`).test(line),
    );
    if (headerIndex === -1) {
      return [];
    }
    const tokens: string[] = [];
    // Skip the header and the `|---|---|` separator row.
    for (let i = headerIndex + 2; i < lines.length; i += 1) {
      if (!lines[i].startsWith('|')) {
        break;
      }
      const firstCell = lines[i].split('|')[1] ?? '';
      const token = firstCell.match(/`([^`]+)`/);
      if (token) {
        tokens.push(token[1]);
      }
    }
    return tokens;
  }

  // The tables live in the golden-rules doc.
  const goldenRules = docs.find(d => d.rel.endsWith('workflow-authoring-golden-rules.md'))!;

  it('Executor table lists exactly the schema enum', () => {
    const documented = tableColumn(goldenRules.text, 'Executor');
    expect(new Set(documented)).toEqual(new Set(executorOptions));
  });

  it('Type table lists exactly the schema enum', () => {
    const documented = tableColumn(goldenRules.text, 'Type');
    expect(new Set(documented)).toEqual(new Set(typeOptions));
  });
});

describe('workflow-authoring docs — CLI commands exist', () => {
  const commandsDir = resolve(repoRoot, 'packages/cli/src/commands');

  const knownCommands = new Set<string>();
  for (const file of readdirSync(commandsDir)) {
    if (!file.endsWith('.ts')) {
      continue;
    }
    const source = readFileSync(resolve(commandsDir, file), 'utf-8');
    for (const match of source.matchAll(/name:\s*'(mediforce [^']+)'/g)) {
      knownCommands.add(match[1]);
    }
  }

  it('discovered the CLI command registry', () => {
    expect(knownCommands.size).toBeGreaterThan(0);
    expect(knownCommands.has('mediforce workflow validate')).toBe(true);
  });

  describe.each(docs)('$rel', ({ text }) => {
    it('every referenced `mediforce <group> <verb>` is a real command', () => {
      const referenced = new Set<string>();
      for (const match of codeText(text).matchAll(/\bmediforce\s+([a-z][a-z-]*)\s+([a-z][a-z-]*)/g)) {
        referenced.add(`mediforce ${match[1]} ${match[2]}`);
      }
      for (const command of referenced) {
        expect(knownCommands.has(command), `unknown CLI command: ${command}`).toBe(true);
      }
    });
  });
});

describe('workflow-authoring docs — ADR references exist', () => {
  const adrDir = resolve(repoRoot, 'docs/adr');
  const adrFiles = readdirSync(adrDir);

  describe.each(docs)('$rel', ({ text }) => {
    it('every ADR-NNNN reference has a matching file', () => {
      for (const match of text.matchAll(/ADR-(\d{4})/g)) {
        const prefix = `${match[1]}-`;
        expect(
          adrFiles.some(f => f.startsWith(prefix)),
          `no ADR file for ${match[0]}`,
        ).toBe(true);
      }
    });

    it('every adr/<file>.md link points at a real ADR', () => {
      for (const match of text.matchAll(/adr\/([\w-]+\.md)/g)) {
        expect(existsSync(resolve(adrDir, match[1])), `dead ADR link: adr/${match[1]}`).toBe(true);
      }
    });
  });
});
