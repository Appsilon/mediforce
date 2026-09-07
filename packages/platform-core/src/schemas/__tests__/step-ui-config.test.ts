import { describe, it, expect } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ColumnSpecSchema,
  TableEditorUiConfigSchema,
  AssignmentTableUiConfigSchema,
  FileUploadUiConfigSchema,
  STEP_UI_CONFIG_SCHEMAS,
  STEP_UI_COMPONENTS,
  isKnownStepUiComponent,
} from '../step-ui-config';

describe('ColumnSpecSchema', () => {
  it('accepts every column kind the table view renders', () => {
    const columns = [
      { kind: 'static', id: 'name', label: 'Name', field: 'label', link: true },
      { kind: 'single-select', id: 'owner', label: 'Owner', options: [{ id: 'a', label: 'A' }], default: 'a' },
      { kind: 'multi-select', id: 'tags', label: 'Tags', options: [{ id: 't', label: 'T' }], default: ['t'] },
      { kind: 'text', id: 'note', label: 'Note', placeholder: 'why…' },
      { kind: 'avatar', id: 'who', label: 'Who', field: 'assignee', size: 24 },
    ];
    for (const column of columns) {
      expect(ColumnSpecSchema.safeParse(column).success).toBe(true);
    }
  });

  it('rejects an unknown kind rather than passing it through', () => {
    expect(ColumnSpecSchema.safeParse({ kind: 'slider', id: 'x', label: 'X' }).success).toBe(false);
  });

  it('requires the options a select renders', () => {
    expect(ColumnSpecSchema.safeParse({ kind: 'single-select', id: 'o', label: 'O' }).success).toBe(false);
  });
});

describe('TableEditorUiConfigSchema', () => {
  it('defaults columns to empty so an unconfigured step still parses', () => {
    const parsed = TableEditorUiConfigSchema.parse({});
    expect(parsed.columns).toEqual([]);
  });

  it('keeps the labels the view falls back on when absent', () => {
    const parsed = TableEditorUiConfigSchema.parse({ submitLabel: 'Assign', emptyMessage: 'Nothing here' });
    expect(parsed.submitLabel).toBe('Assign');
    expect(parsed.emptyMessage).toBe('Nothing here');
  });
});

describe('AssignmentTableUiConfigSchema', () => {
  it('leaves the optional flags undefined so callers apply their own defaults', () => {
    const parsed = AssignmentTableUiConfigSchema.parse({});
    expect(parsed.assignees).toEqual([]);
    expect(parsed.allowSkip).toBeUndefined();
    expect(parsed.noteField).toBeUndefined();
    expect(parsed.priorities).toBeUndefined();
  });

  it('requires an assignee kind, which the view reads without a fallback', () => {
    expect(AssignmentTableUiConfigSchema.safeParse({ assignees: [{ id: 'a', label: 'A' }] }).success).toBe(false);
    expect(
      AssignmentTableUiConfigSchema.safeParse({ assignees: [{ id: 'a', label: 'A', kind: 'human' }] }).success,
    ).toBe(true);
  });
});

describe('FileUploadUiConfigSchema', () => {
  it('accepts the bounds the engine enforces on completion', () => {
    const parsed = FileUploadUiConfigSchema.parse({ acceptedTypes: ['application/pdf'], minFiles: 1, maxFiles: 10 });
    expect(parsed).toEqual({ acceptedTypes: ['application/pdf'], minFiles: 1, maxFiles: 10 });
  });

  it('rejects a maxFiles of zero, which would accept no upload at all', () => {
    expect(FileUploadUiConfigSchema.safeParse({ maxFiles: 0 }).success).toBe(false);
  });
});

describe('the component registry', () => {
  it('names every component the step editor offers', () => {
    expect(STEP_UI_COMPONENTS).toEqual(['file-upload', 'table-editor', 'assignment-table']);
  });

  it('has a schema for each', () => {
    for (const component of STEP_UI_COMPONENTS) {
      expect(STEP_UI_CONFIG_SCHEMAS[component]).toBeDefined();
    }
  });

  it('treats a custom body as unknown rather than erroring', () => {
    expect(isKnownStepUiComponent('table-editor')).toBe(true);
    expect(isKnownStepUiComponent('some-custom-body')).toBe(false);
    expect(isKnownStepUiComponent(undefined)).toBe(false);
  });
});

// The configs shipped packages already carry have to keep parsing, or this
// schema would reject a step that renders correctly today.
describe('the ui configs the shipped packages use', () => {
  const root = resolve(__dirname, '../../../../..');
  const files = globSync('apps/*/src/*.wd.json', { cwd: root }).map((rel) => resolve(root, rel));

  it('finds the shipped packages', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('parses every ui.config against its component schema', () => {
    const failures: string[] = [];
    for (const file of files) {
      const doc = JSON.parse(readFileSync(file, 'utf8')) as {
        steps?: { id?: string; ui?: { component?: string; config?: unknown } }[];
      };
      for (const step of doc.steps ?? []) {
        const component = step.ui?.component;
        if (isKnownStepUiComponent(component) === false) continue;
        const result = STEP_UI_CONFIG_SCHEMAS[component].safeParse(step.ui?.config ?? {});
        if (result.success === false) {
          failures.push(`${file.split('/').slice(-1)[0]} step ${step.id ?? '?'}: ${result.error.issues[0]?.message ?? ''}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
