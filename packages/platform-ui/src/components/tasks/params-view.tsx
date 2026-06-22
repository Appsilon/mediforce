'use client';

import * as React from 'react';
import { ParamsForm } from './params-form';
import type { TaskBodyProps } from './task-body-registry';

export function ParamsView({ task, remainingTaskCount }: TaskBodyProps) {
  if (task.status !== 'claimed' && task.status !== 'pending') return null;

  return <ParamsForm taskId={task.id} params={task.params ?? []} remainingTaskCount={remainingTaskCount} />;
}
