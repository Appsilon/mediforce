'use client';

import * as React from 'react';
import { SelectionForm, SelectionConfirmationReadOnly } from './selection-form';
import type { TaskBodyProps } from './task-body-registry';

export function SelectionView({ task, remainingTaskCount }: TaskBodyProps) {
  const isActionable = task.status === 'claimed' || task.status === 'pending';
  const isCompleted = task.status === 'completed';

  if (isActionable) {
    return (
      <SelectionForm
        taskId={task.id}
        options={task.options ?? []}
        remainingTaskCount={remainingTaskCount}
      />
    );
  }
  if (isCompleted && task.completionData) {
    return (
      <SelectionConfirmationReadOnly
        completionData={task.completionData}
        remainingTaskCount={remainingTaskCount}
      />
    );
  }
  return null;
}
