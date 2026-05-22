'use client';

import * as React from 'react';
import { ParamsForm, ParamsConfirmationReadOnly } from './params-form';
import type { TaskBodyProps } from './task-body-registry';

export function ParamsView({ task, remainingTaskCount }: TaskBodyProps) {
  const isActionable = task.status === 'claimed' || task.status === 'pending';
  const isCompleted = task.status === 'completed';

  if (isActionable) {
    return (
      <ParamsForm
        taskId={task.id}
        params={task.params ?? []}
        remainingTaskCount={remainingTaskCount}
      />
    );
  }
  if (isCompleted && task.completionData) {
    return (
      <ParamsConfirmationReadOnly
        completionData={task.completionData}
        params={task.params ?? []}
      />
    );
  }
  return null;
}
