import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  HOW_TO_CREATE_WORKFLOW_DOC,
  WORKFLOW_CAPABILITIES_DOC,
  WORKFLOW_AUTHORING_GOLDEN_RULES_DOC,
} from '../embedded-workflow-docs.generated';

// __tests__ -> _lib -> workflow-assistant -> handlers -> src -> platform-api -> packages -> repo root
const REPO_ROOT = resolve(__dirname, '../../../../../../..');

const CASES: Array<[string, string]> = [
  ['docs/how-to-create-workflow.md', HOW_TO_CREATE_WORKFLOW_DOC],
  ['docs/workflow-capabilities.md', WORKFLOW_CAPABILITIES_DOC],
  ['docs/workflow-authoring-golden-rules.md', WORKFLOW_AUTHORING_GOLDEN_RULES_DOC],
];

describe('embedded workflow docs are in sync with source', () => {
  it.each(CASES)('%s matches its committed generated copy', (relPath, embedded) => {
    const source = readFileSync(resolve(REPO_ROOT, relPath), 'utf8');
    expect(embedded, `${relPath} changed — run \`pnpm gen:assistant-docs\` to regenerate`).toBe(source);
  });
});
