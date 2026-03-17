import type { LucideIcon } from 'lucide-react';
import { Eye, FileText, CheckSquare, Upload, CircleDot } from 'lucide-react';
import type { HumanTask } from '@mediforce/platform-core';
import { formatStepName } from './task-utils';

const ACTION_TYPES = ['review', 'input', 'choose', 'upload', 'action'] as const;
type ActionType = (typeof ACTION_TYPES)[number];

interface ActionTypeInfo {
  type: ActionType;
  label: string;
  icon: LucideIcon;
  colorClass: string;
}

const ACTION_TYPE_MAP: Record<ActionType, Omit<ActionTypeInfo, 'type'>> = {
  review: { label: 'Review', icon: Eye, colorClass: 'text-purple-500' },
  input: { label: 'Input needed', icon: FileText, colorClass: 'text-blue-500' },
  choose: { label: 'Choose', icon: CheckSquare, colorClass: 'text-green-500' },
  upload: { label: 'Upload', icon: Upload, colorClass: 'text-orange-500' },
  action: { label: 'Action needed', icon: CircleDot, colorClass: 'text-gray-500' },
};

function deriveActionType(task: HumanTask): ActionType {
  if (task.creationReason === 'agent_review_l3') return 'review';
  if (task.params !== undefined && task.params.length > 0) return 'input';
  if (task.selection !== undefined) return 'choose';
  if (task.ui?.component === 'file-upload') return 'upload';
  return 'action';
}

export function getActionType(task: HumanTask): ActionTypeInfo {
  const type = deriveActionType(task);
  return { type, ...ACTION_TYPE_MAP[type] };
}

export function getTaskLabel(task: HumanTask): string {
  const { label } = getActionType(task);
  const context = formatStepName(task.stepId);
  return `${label}: ${context}`;
}
