'use client';

import * as React from 'react';
import { VerdictForm, VerdictConfirmationReadOnly } from './verdict-form';
import type { TaskBodyProps } from './task-body-registry';

export function VerdictView({ task, remainingTaskCount }: TaskBodyProps) {
  const isActionable = task.status === 'claimed' || task.status === 'pending';
  const isCompleted = task.status === 'completed';

  if (isActionable) {
    return (
      <VerdictForm taskId={task.id} disabled={false} remainingTaskCount={remainingTaskCount} verdicts={task.verdicts} />
    );
  }
  if (isCompleted && task.completionData) {
    return (
      <VerdictConfirmationReadOnly
        completionData={task.completionData}
        verdicts={task.verdicts}
        remainingTaskCount={remainingTaskCount}
      />
    );
  }
  return null;
}
