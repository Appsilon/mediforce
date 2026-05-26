import * as React from 'react';
import type { HumanTask } from '@mediforce/platform-core';
import { FileUploadView } from './file-upload-view';
import { SelectionView } from './selection-view';
import { ParamsView } from './params-view';
import { VerdictView } from './verdict-view';
import { AssignmentTableView } from './assignment-table-view';
import { TableEditorView } from './table-editor-view';

export interface TaskBodyProps {
  task: HumanTask;
  remainingTaskCount?: number;
}

export interface TaskBodyEntry {
  Component: React.ComponentType<TaskBodyProps>;
  hidesContextPanel?: boolean;
}

const REGISTRY: Record<string, TaskBodyEntry> = {
  'file-upload': { Component: FileUploadView, hidesContextPanel: true },
  'assignment-table': { Component: AssignmentTableView, hidesContextPanel: true },
  'table-editor': { Component: TableEditorView, hidesContextPanel: true },
};

export function resolveTaskBody(task: HumanTask): TaskBodyEntry {
  if (task.ui?.component !== undefined) {
    const entry = REGISTRY[task.ui.component];
    if (entry !== undefined) return entry;
  }
  if (Array.isArray(task.options) && task.options.length > 0) {
    return { Component: SelectionView };
  }
  if (Array.isArray(task.params) && task.params.length > 0) {
    return { Component: ParamsView };
  }
  return { Component: VerdictView };
}
